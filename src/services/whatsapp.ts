/**
 * WhatsApp service — manages Baileys connections, QR codes, contacts, and messaging.
 * One session per uid, stored in an in-memory Map.
 */

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type Contact,
} from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import pino from 'pino';
import type { WhatsAppSession, SessionEventCallback, SessionEvent } from '../types/whatsapp.js';

// Active sessions keyed by uid
const sessions = new Map<string, WhatsAppSession>();

// Contacts keyed by uid → jid → Contact
const contactStore = new Map<string, Map<string, Contact>>();

// SSE listeners keyed by uid (multiple browsers can listen)
const listeners = new Map<string, Set<SessionEventCallback>>();

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

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

/** Initialize (or re-initialize) a Baileys session for the given uid. */
export async function initSession(uid: string): Promise<void> {
  // If already connected, skip
  const existing = sessions.get(uid);
  if (existing?.connected) {
    return;
  }

  const { state, saveCreds } = await useMultiFileAuthState(`sessions/${uid}`);

  const socket = makeWASocket({
    auth: state,
    logger: logger as any,
    printQRInTerminal: false,
    browser: ['Omi WhatsApp', 'Chrome', '1.0.0'],
  });

  const session: WhatsAppSession = {
    socket,
    connected: false,
    qr: undefined,
    userJid: undefined,
  };

  sessions.set(uid, session);

  // Initialize contact store for this uid if not present
  if (!contactStore.has(uid)) {
    contactStore.set(uid, new Map());
  }

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
      emit(uid, { type: 'connected' });
      logger.info({ uid, jid: session.userJid }, 'WhatsApp connected');
    }

    if (connection === 'close') {
      session.connected = false;
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      emit(uid, { type: 'disconnected', reason: loggedOut ? 'logged_out' : 'connection_closed' });
      logger.warn({ uid, statusCode, loggedOut }, 'WhatsApp disconnected');

      if (!loggedOut) {
        // Reconnect automatically unless user logged out
        logger.info({ uid }, 'Reconnecting...');
        initSession(uid).catch((err) => {
          logger.error({ uid, err }, 'Failed to reconnect');
        });
      } else {
        sessions.delete(uid);
      }
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
    logger.info({ uid, count: contacts.length }, 'Contacts synced from history');
  });

  // Collect contacts as they arrive
  socket.ev.on('contacts.upsert', (contacts) => {
    const store = contactStore.get(uid)!;
    for (const contact of contacts) {
      store.set(contact.id, contact);
    }
    logger.debug({ uid, count: contacts.length }, 'Contacts upserted');
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
