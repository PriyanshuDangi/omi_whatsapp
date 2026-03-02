/**
 * WhatsApp service — manages Baileys connections, QR codes, contacts, and messaging.
 * One session per uid, stored in an in-memory Map.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  proto,
  type Contact,
  type Chat,
  type WAMessage,
  type WAMessageKey,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import { logger, baileysLogger } from '../utils/logger.js';
import type { WhatsAppSession, SessionEventCallback, SessionEvent } from '../types/whatsapp.js';
import { loadSavedContacts } from './saved-contacts.js';

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

// ---------------------------------------------------------------------------
// Contact store — keyed by uid → phone JID → Contact
// ---------------------------------------------------------------------------

/** Canonical contact store: always keyed by phone-number JID (@s.whatsapp.net). */
const contactStore = new Map<string, Map<string, Contact>>();

/**
 * Bidirectional LID ↔ JID map per uid.
 * WhatsApp's newer multi-device protocol assigns each contact an opaque
 * "Linked ID" (LID). Many events (contacts.update, messages) reference
 * contacts by LID instead of phone JID. We maintain a mapping so we can
 * resolve LIDs back to phone JIDs for storage and matching.
 */
const lidToJid = new Map<string, Map<string, string>>();

function contactsCachePath(uid: string): string {
  return path.join('sessions', uid, 'contacts.json');
}

/** Persist the contact store and LID map to disk. */
function persistContacts(uid: string): void {
  const store = contactStore.get(uid);
  if (!store || store.size === 0) return;
  try {
    const contacts = Object.fromEntries(store);
    const lidMap = Object.fromEntries(lidToJid.get(uid) ?? new Map());
    const payload = { contacts, lidMap };
    fs.writeFileSync(contactsCachePath(uid), JSON.stringify(payload), 'utf-8');
    logger.info({ uid, count: store.size }, 'Persisted contacts to disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to persist contacts to disk');
  }
}

/** Load contacts and LID map from disk cache. */
function loadCachedContacts(uid: string): void {
  const filePath = contactsCachePath(uid);
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Support both old format (flat {jid: Contact}) and new {contacts, lidMap}
    const contactData = raw.contacts ?? raw;
    const lidMapData: Record<string, string> = raw.lidMap ?? {};

    const store = contactStore.get(uid) ?? new Map<string, Contact>();
    for (const [jid, contact] of Object.entries(contactData)) {
      store.set(jid, contact as Contact);
    }
    contactStore.set(uid, store);

    const lmap = lidToJid.get(uid) ?? new Map<string, string>();
    for (const [lid, jid] of Object.entries(lidMapData)) {
      lmap.set(lid, jid);
    }
    lidToJid.set(uid, lmap);

    logger.debug({ uid, contacts: store.size, lidMappings: lmap.size }, 'Loaded cached contacts from disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to load cached contacts from disk');
  }
}

/** Register a LID ↔ JID mapping. */
function registerLidMapping(uid: string, lid: string, jid: string): void {
  const lmap = lidToJid.get(uid) ?? new Map<string, string>();
  lmap.set(lid, jid);
  lidToJid.set(uid, lmap);
}

/** Resolve a LID to a phone-number JID, or return the input if it's already a JID. */
function resolveToJid(uid: string, id: string): string | undefined {
  if (id.endsWith('@s.whatsapp.net')) return id;
  if (id.endsWith('@lid')) return lidToJid.get(uid)?.get(id);
  return undefined;
}

/**
 * Upsert a contact into the store, merging with any existing entry.
 * Handles LID→JID resolution: if the contact has a LID key but we know
 * the corresponding JID, we store it under the JID instead.
 */
function upsertContact(uid: string, contact: Contact): void {
  const store = contactStore.get(uid)!;

  // If contact carries a lid field, register the mapping
  if (contact.id.endsWith('@s.whatsapp.net') && (contact as any).lid) {
    registerLidMapping(uid, (contact as any).lid, contact.id);
  }

  // Resolve the storage key to a phone-number JID
  let jid = resolveToJid(uid, contact.id);

  if (!jid) {
    // Unknown LID with no JID mapping — can't do anything useful yet.
    // Store minimally so we can merge later if the mapping appears.
    return;
  }

  const existing = store.get(jid);
  const merged: Contact = { ...existing, ...contact, id: jid };

  // Prefer phonebook name (name) over profile name (notify)
  if (existing?.name && !contact.name) {
    merged.name = existing.name;
  }

  store.set(jid, merged);
}

// SSE listeners keyed by uid (multiple browsers can listen)
const listeners = new Map<string, Set<SessionEventCallback>>();


/** Emit a session event to all registered SSE listeners for this uid */
function emit(uid: string, event: SessionEvent): void {
  const cbs = listeners.get(uid);
  if (cbs) {
    for (const cb of cbs) {
      cb(event);
    }
  }
}

/**
 * Archive non-sensitive session artifacts before deleting auth state.
 * We keep contacts for debugging/audit and store only creds.me in metadata.
 */
function archiveSessionData(uid: string, reason: string): void {
  const sessionDir = path.join('sessions', uid);
  if (!fs.existsSync(sessionDir)) return;

  const contactsPath = path.join(sessionDir, 'contacts.json');
  if (!fs.existsSync(contactsPath)) return;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveDir = path.join('sessions-archive', uid, timestamp);
    const credsPath = path.join(sessionDir, 'creds.json');
    let me: unknown = null;

    if (fs.existsSync(credsPath)) {
      try {
        const credsRaw = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
        me = credsRaw?.me ?? null;
      } catch (err) {
        logger.warn({ uid, reason, err }, 'Failed to parse creds.json for archive metadata');
      }
    }

    fs.mkdirSync(archiveDir, { recursive: true });
    fs.copyFileSync(contactsPath, path.join(archiveDir, 'contacts.json'));

    const savedContactsPath = path.join(sessionDir, 'saved-contacts.json');
    if (fs.existsSync(savedContactsPath)) {
      fs.copyFileSync(savedContactsPath, path.join(archiveDir, 'saved-contacts.json'));
    }

    fs.writeFileSync(
      path.join(archiveDir, 'meta.json'),
      JSON.stringify({ uid, reason, archivedAt: new Date().toISOString(), me }, null, 2),
      'utf-8',
    );
    logger.info({ uid, reason, archiveDir }, 'Archived session data before cleanup');
  } catch (err) {
    logger.error({ uid, reason, err }, 'Failed to archive contacts before session cleanup');
  }
}

/** Remove persisted auth directory for a uid so next init starts with fresh credentials. */
function clearSessionAuth(uid: string, reason: string): void {
  const sessionDir = path.join('sessions', uid);
  if (!fs.existsSync(sessionDir)) return;

  archiveSessionData(uid, reason);

  // Preserve saved-contacts.json across session resets — it's user-managed data
  const savedContactsPath = path.join(sessionDir, 'saved-contacts.json');
  let savedContactsBackup: string | null = null;
  if (fs.existsSync(savedContactsPath)) {
    savedContactsBackup = fs.readFileSync(savedContactsPath, 'utf-8');
  }

  fs.rmSync(sessionDir, { recursive: true, force: true });

  if (savedContactsBackup) {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(savedContactsPath, savedContactsBackup, 'utf-8');
    logger.debug({ uid }, 'Restored saved-contacts.json after session cleanup');
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

    // Pre-key cleanup disabled by request: keep all pre-key files on disk.
    // const firstUnuploaded = state.creds.firstUnuploadedPreKeyId ?? 0;
    // if (firstUnuploaded > 1) {
    //   // Run cleanup asynchronously so it doesn't block the auth flow
    //   setImmediate(() => {
    //     try {
    //       const files = fs.readdirSync(folder);
    //       for (const file of files) {
    //         const match = file.match(/^pre-key-(\d+)\.json$/);
    //         if (match) {
    //           const keyId = parseInt(match[1]!, 10);
    //           if (keyId < firstUnuploaded) {
    //             fs.unlinkSync(path.join(folder, file));
    //           }
    //         }
    //       }
    //     } catch {
    //       // Non-fatal — next cleanup cycle will catch leftovers
    //     }
    //   });
    // }
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

    syncFullHistory: false,
    shouldSyncHistoryMessage: (msg) => {
      const type = msg.syncType;
      const { HistorySyncType } = proto.HistorySync;
      return type === HistorySyncType.PUSH_NAME
        || type === HistorySyncType.INITIAL_BOOTSTRAP
        || type === HistorySyncType.RECENT
        || type === HistorySyncType.NON_BLOCKING_DATA;
    },
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
  loadSavedContacts(uid);

  // Handle connection updates (QR codes, connection state)
  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      session.qr = qr;
      session.connected = false;
      emit(uid, { type: 'qr', data: qr });
      logger.debug({ uid }, 'New QR code generated');
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
        // Logged-out credentials are invalid. Clear local auth so user can relink via QR.
        if (reason === 'logged_out') {
          clearSessionAuth(uid, 'logged_out');
        }
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
      logger.debug({ uid, statusCode, attempt: state.attempts, delayMs },
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

  // Collect contacts, chats, and messages from history sync.
  socket.ev.on('messaging-history.set', ({ contacts, chats, messages, syncType }) => {
    logger.info({ uid, contacts: contacts.length, chats: chats.length, messages: messages.length, syncType }, 'History sync received');

    for (const contact of contacts) {
      upsertContact(uid, contact);
    }

    // Enrich from chat metadata and message push names (async to not block)
    setImmediate(() => {
      enrichContactsFromChats(uid, chats);
      enrichContactsFromMessages(uid, messages);
      persistContacts(uid);
    });
  });

  // contacts.upsert — main source of phonebook names
  socket.ev.on('contacts.upsert', (contacts) => {

    for (const contact of contacts) {
      upsertContact(uid, contact);
    }
    logger.info({ uid, upserted: contacts.length, total: contactStore.get(uid)!.size }, 'Contacts upserted');
    persistContacts(uid);
  });

  // contacts.update — incremental updates, often LID-keyed
  socket.ev.on('contacts.update', (updates) => {

    let changed = false;
    for (const update of updates) {
      if (!update.id) continue;
      upsertContact(uid, update as Contact);
      changed = true;
    }
    if (changed) {
      persistContacts(uid);
    }
  });

  // messages.upsert — live messages can reveal new numbers and push names.
  socket.ev.on('messages.upsert', ({ messages }) => {

    const changed = enrichContactsFromMessages(uid, messages, true);
    if (changed > 0) {
      persistContacts(uid);
    }
  });
}

// ---------------------------------------------------------------------------
// Contact enrichment from chats and messages
// ---------------------------------------------------------------------------

/**
 * Extract user-saved contact names from chat metadata.
 * Chat.name / Chat.displayName often contain the phonebook name.
 */
function enrichContactsFromChats(uid: string, chats: Chat[]): void {
  const store = contactStore.get(uid)!;
  let enriched = 0;
  for (const chat of chats) {
    const id = chat.id;
    if (!id || id.endsWith('@g.us') || id === 'status@broadcast') continue;

    const chatName = chat.name || (chat as any).displayName;
    if (!chatName) continue;

    const jid = resolveToJid(uid, id);
    if (!jid) continue;

    const existing = store.get(jid);
    if (existing?.name) continue;

    upsertContact(uid, { id, name: chatName } as Contact);
    enriched++;
  }

  if (enriched > 0) {
    logger.info({ uid, enriched }, 'Contacts enriched from chat metadata');
  }
}

/**
 * Extract contact names from message pushName fields.
 * pushName is the sender's self-chosen WhatsApp name — useful as a fallback.
 */
function enrichContactsFromMessages(uid: string, messages: WAMessage[], includeBareNumbers = false): number {
  const store = contactStore.get(uid)!;
  let enriched = 0;
  for (const msg of messages) {
    const id = msg.key?.participant || msg.key?.remoteJid;
    if (!id || id.endsWith('@g.us') || id === 'status@broadcast') continue;

    const jid = resolveToJid(uid, id);
    if (!jid) continue;

    const existing = store.get(jid);
    if (!existing && includeBareNumbers) {
      // Keep a minimal entry for newly seen numbers even before names arrive.
      upsertContact(uid, { id } as Contact);
      enriched++;
    }

    const pushName = msg.pushName;
    if (!pushName) continue;

    const latest = store.get(jid);
    if (latest?.notify) continue;

    upsertContact(uid, { id, notify: pushName } as Contact);
    enriched++;
  }

  if (enriched > 0) {
    logger.info({ uid, enriched }, 'Contacts enriched from message push names');
  }
  return enriched;
}

// ---------------------------------------------------------------------------
// On-demand history sync
// ---------------------------------------------------------------------------

/**
 * Request on-demand history sync from the main device.
 * Fetches older messages beyond the initial sync. Results arrive via
 * the `messaging-history.set` event asynchronously.
 */
export async function requestHistorySync(uid: string, count = 50): Promise<void> {
  const session = sessions.get(uid);
  if (!session?.connected) {
    throw new Error(`WhatsApp not connected for uid: ${uid}`);
  }

  const store = contactStore.get(uid);
  if (!store || store.size === 0) {
    throw new Error('No contacts synced yet — initial sync may still be in progress');
  }

  // Find the oldest message key/timestamp we have from the contact store's
  // associated chats. We need a reference point for fetchMessageHistory.
  // Use a sentinel oldest key — Baileys will fetch from the beginning.
  const oldestMsgKey: WAMessageKey = {
    remoteJid: '0@s.whatsapp.net',
    id: '',
    fromMe: false,
  };
  const oldestMsgTimestamp = 0;

  await session.socket.fetchMessageHistory(count, oldestMsgKey, oldestMsgTimestamp);
  logger.info({ uid, count }, 'On-demand history sync requested');
}

/**
 * Explicitly log out and fully clean up a WhatsApp session.
 * Idempotent — safe to call even if the session is already gone.
 */
export async function logoutSession(uid: string): Promise<void> {
  // Clear any pending reconnect timer
  const retry = retryState.get(uid);
  if (retry?.timer) clearTimeout(retry.timer);
  retryState.delete(uid);

  const session = sessions.get(uid);
  if (session) {
    try {
      await session.socket.logout();
    } catch (err) {
      logger.warn({ uid, err }, 'Error during socket.logout (may already be disconnected)');
    }
    sessions.delete(uid);
  }

  contactStore.delete(uid);
  emit(uid, { type: 'disconnected', reason: 'logged_out' });

  // Remove persisted auth so next setup starts a fresh QR link
  clearSessionAuth(uid, 'logout');

  logger.info({ uid }, 'WhatsApp session logged out and cleaned up');
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
    logger.info({ uid, attempt: i + 1, retries }, 'Waiting for contacts to sync');
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return hasContacts(uid);
}

/**
 * Check whether a phone number is registered on WhatsApp.
 * Returns the canonical JID assigned by WhatsApp if the number exists.
 */
export async function checkWhatsAppNumber(uid: string, phone: string): Promise<{ exists: boolean; jid?: string }> {
  const session = sessions.get(uid);
  if (!session?.connected) {
    throw new Error(`WhatsApp not connected for uid: ${uid}`);
  }

  const stripped = phone.replace(/[^0-9]/g, '');
  const results = await session.socket.onWhatsApp(stripped);

  if (results && results.length > 0 && results[0].exists) {
    return { exists: true, jid: results[0].jid };
  }
  return { exists: false };
}
