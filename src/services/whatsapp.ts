/**
 * WhatsApp service — manages Baileys connections, QR codes, contacts, and messaging.
 * One session per uid, stored in an in-memory Map.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type Contact,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import type { WhatsAppSession, SessionEventCallback, SessionEvent } from '../types/whatsapp.js';

// Active sessions keyed by uid
const sessions = new Map<string, WhatsAppSession>();

// Retry state per uid — tracks consecutive failures for backoff
const retryState = new Map<string, { attempts: number; timer?: ReturnType<typeof setTimeout> }>();

const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

// Status codes where reconnecting is pointless
const NON_RETRIABLE_CODES = new Set([
  DisconnectReason.loggedOut, // 401 — user explicitly logged out
  405,                         // WhatsApp server-side rejection (registration blocked)
]);

// Contacts keyed by uid → jid → Contact
const contactStore = new Map<string, Map<string, Contact>>();

/** Path to the contacts cache file for a uid. */
function contactsCachePath(uid: string): string {
  return path.join('sessions', uid, 'contacts.json');
}

/** Save contacts to disk so they survive restarts. */
function persistContacts(uid: string): void {
  const store = contactStore.get(uid);
  if (!store || store.size === 0) return;
  try {
    const data = Object.fromEntries(store);
    fs.writeFileSync(contactsCachePath(uid), JSON.stringify(data), 'utf-8');
    logger.debug({ uid, count: store.size }, 'Persisted contacts to disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to persist contacts to disk');
  }
}

/** Load contacts from disk cache. */
function loadCachedContacts(uid: string): void {
  const filePath = contactsCachePath(uid);
  if (!fs.existsSync(filePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const store = contactStore.get(uid) ?? new Map<string, Contact>();
    for (const [jid, contact] of Object.entries(data)) {
      store.set(jid, contact as Contact);
    }
    contactStore.set(uid, store);
    logger.debug({ uid, count: store.size }, 'Loaded cached contacts from disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to load cached contacts from disk');
  }
}

// SSE listeners keyed by uid (multiple browsers can listen)
const listeners = new Map<string, Set<SessionEventCallback>>();

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Baileys internal logger — errors only to keep pm2 logs clean
const baileysLogger = pino({ level: 'error' });

/** Emit a session event to all registered SSE listeners for this uid */
function emit(uid: string, event: SessionEvent): void {
  const cbs = listeners.get(uid);
  if (cbs) {
    for (const cb of cbs) {
      cb(event);
    }
  }
}

/** Register an SSE listener for session events. Returns an unsubscribe function. */
export function subscribe(uid: string, cb: SessionEventCallback): () => void {
  if (!listeners.has(uid)) {
    listeners.set(uid, new Set());
  }
  listeners.get(uid)!.add(cb);

  // If already connected, notify immediately
  const session = sessions.get(uid);
  if (session?.connected) {
    cb({ type: 'connected' });
  } else if (session?.qr) {
    cb({ type: 'qr', data: session.qr });
  }

  return () => {
    listeners.get(uid)?.delete(cb);
  };
}

/**
 * Wraps useMultiFileAuthState to automatically delete pre-key files after
 * they've been uploaded to WhatsApp. Baileys never cleans these up itself,
 * so without this they accumulate indefinitely (100+ files per session).
 */
async function useMultiFileAuthStateWithCleanup(
  folder: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const { state, saveCreds } = await useMultiFileAuthState(folder);

  const originalSet = state.keys.set.bind(state.keys);
  state.keys.set = (data) => {
    originalSet(data);

    // After pre-keys are written, clean up keys below firstUnuploadedPreKeyId —
    // those have already been uploaded to WhatsApp and will never be used again.
    const firstUnuploaded = state.creds.firstUnuploadedPreKeyId ?? 0;
    if (firstUnuploaded > 1) {
      // Run cleanup asynchronously so it doesn't block the auth flow
      setImmediate(() => {
        try {
          const files = fs.readdirSync(folder);
          for (const file of files) {
            const match = file.match(/^pre-key-(\d+)\.json$/);
            if (match) {
              const keyId = parseInt(match[1]!, 10);
              if (keyId < firstUnuploaded) {
                fs.unlinkSync(path.join(folder, file));
              }
            }
          }
        } catch {
          // Non-fatal — next cleanup cycle will catch leftovers
        }
      });
    }
  };

  return { state, saveCreds };
}

/** Initialize (or re-initialize) a Baileys session for the given uid. */
export async function initSession(uid: string): Promise<void> {
  // If already connected, skip
  const existing = sessions.get(uid);
  if (existing?.connected) {
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthStateWithCleanup(`sessions/${uid}`);

  const socket = makeWASocket({
    auth: state,
    logger: baileysLogger as any,
    printQRInTerminal: false,
    // Pinned version — WhatsApp rejects outdated protocol versions with 405.
    // See: https://github.com/WhiskeySockets/Baileys/issues/2370
    // TODO: remove once Baileys ships a release with the updated default
    version: [2, 3000, 1033893291],
    browser: ['Omi WhatsApp', 'Chrome', '1.0.0'],

    // Performance: skip heavy work that delays QR generation.
    // We only need contacts (synced via messaging-history.set), not full chat history.
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
    generateHighQualityLinkPreview: false,
    connectTimeoutMs: 10_000,
    defaultQueryTimeoutMs: 15_000,
  });

  const session: WhatsAppSession = {
    socket,
    connected: false,
    qr: undefined,
    userJid: undefined,
  };

  sessions.set(uid, session);

  // Initialize contact store for this uid — load from disk cache first
  if (!contactStore.has(uid)) {
    contactStore.set(uid, new Map());
  }
  loadCachedContacts(uid);

  // Handle connection updates (QR codes, connection state)
  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.qr = qr;
      session.connected = false;
      emit(uid, { type: 'qr', data: qr });
      logger.info({ uid }, 'New QR code generated');
    }

    if (connection === 'open') {
      session.connected = true;
      session.qr = undefined;
      session.userJid = socket.user?.id;
      retryState.delete(uid);
      emit(uid, { type: 'connected' });
      logger.info({ uid, jid: session.userJid }, 'WhatsApp connected');
    }

    if (connection === 'close') {
      session.connected = false;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;

      if (NON_RETRIABLE_CODES.has(statusCode!)) {
        const reason = statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'server_rejected';
        emit(uid, { type: 'disconnected', reason });
        logger.warn({ uid, statusCode }, 'WhatsApp disconnected — not retriable, giving up');
        sessions.delete(uid);
        retryState.delete(uid);
        return;
      }

      emit(uid, { type: 'disconnected', reason: 'connection_closed' });

      const state = retryState.get(uid) ?? { attempts: 0 };
      state.attempts += 1;
      retryState.set(uid, state);

      if (state.attempts > MAX_RECONNECT_ATTEMPTS) {
        logger.error({ uid, statusCode, attempts: state.attempts },
          'WhatsApp reconnect limit reached — giving up');
        sessions.delete(uid);
        retryState.delete(uid);
        return;
      }

      const delayMs = Math.min(BASE_BACKOFF_MS * 2 ** (state.attempts - 1), MAX_BACKOFF_MS);
      logger.info({ uid, statusCode, attempt: state.attempts, delayMs },
        'Reconnecting with backoff...');

      state.timer = setTimeout(() => {
        initSession(uid).catch((err) => {
          logger.error({ uid, err }, 'Failed to reconnect');
        });
      }, delayMs);
    }
  });

  // Persist credentials on update
  socket.ev.on('creds.update', saveCreds);

  // Collect contacts from messaging history sync
  socket.ev.on('messaging-history.set', ({ contacts }) => {
    const store = contactStore.get(uid)!;
    for (const contact of contacts) {
      store.set(contact.id, contact);
    }
    logger.debug({ uid, synced: contacts.length, total: store.size }, 'Contacts synced from history');
    persistContacts(uid);
  });

  // Collect contacts as they arrive
  socket.ev.on('contacts.upsert', (contacts) => {
    const store = contactStore.get(uid)!;
    for (const contact of contacts) {
      store.set(contact.id, contact);
    }
    logger.debug({ uid, upserted: contacts.length, total: store.size }, 'Contacts upserted');
    persistContacts(uid);
  });

  // Update contacts
  socket.ev.on('contacts.update', (updates) => {
    const store = contactStore.get(uid)!;
    for (const update of updates) {
      const existing = store.get(update.id!);
      if (existing) {
        store.set(update.id!, { ...existing, ...update } as Contact);
      }
    }
  });
}

/** Get the session for a uid, or undefined if not initialized. */
export function getSession(uid: string): WhatsAppSession | undefined {
  return sessions.get(uid);
}

/** Check if a uid has a connected WhatsApp session. */
export function isConnected(uid: string): boolean {
  return sessions.get(uid)?.connected === true;
}

/** Get the latest QR code string for a uid. */
export function getQR(uid: string): string | undefined {
  return sessions.get(uid)?.qr;
}

/** Send a message to the user's own WhatsApp chat (self-message / "Message Yourself"). */
export async function sendSelfMessage(uid: string, text: string): Promise<void> {
  const session = sessions.get(uid);
  if (!session?.connected || !session.userJid) {
    throw new Error(`WhatsApp not connected for uid: ${uid}`);
  }

  // Normalize JID for self-messaging: ensure it ends with @s.whatsapp.net
  const selfJid = session.userJid.replace(/:.*@/, '@');
  await session.socket.sendMessage(selfJid, { text });
  logger.info({ uid }, 'Self-message sent');
}

/** Send a message to any WhatsApp contact by JID. */
export async function sendMessage(uid: string, jid: string, text: string): Promise<void> {
  const session = sessions.get(uid);
  if (!session?.connected) {
    throw new Error(`WhatsApp not connected for uid: ${uid}`);
  }

  await session.socket.sendMessage(jid, { text });
  logger.info({ uid, jid }, 'Message sent');
}

/** Get all known contacts for a uid. */
export function getContacts(uid: string): Map<string, Contact> {
  return contactStore.get(uid) ?? new Map();
}

/** Check if contacts have been synced for a uid. */
export function hasContacts(uid: string): boolean {
  const store = contactStore.get(uid);
  return !!store && store.size > 0;
}

/** Wait for contacts to sync, retrying a few times. */
export async function waitForContacts(uid: string, retries = 10, delayMs = 2000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (hasContacts(uid)) return true;
    logger.debug({ uid, attempt: i + 1, retries }, 'Waiting for contacts to sync');
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return hasContacts(uid);
}
