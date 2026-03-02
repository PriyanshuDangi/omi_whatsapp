/**
 * Saved contacts service — user-managed contacts that take priority over
 * Baileys-synced contacts for name matching.
 *
 * Stored at `sessions/{uid}/saved-contacts.json` with the same Contact-compatible
 * shape used by the Baileys contact store, plus an `addedAt` timestamp.
 */

import fs from 'fs';
import path from 'path';
import type { Contact } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';

export interface SavedContact extends Contact {
  addedAt: string;
  updatedAt?: string;
}

const savedContactStore = new Map<string, Map<string, SavedContact>>();

export function savedContactsPath(uid: string): string {
  return path.join('sessions', uid, 'saved-contacts.json');
}

/** Load saved contacts from disk into the in-memory store. */
export function loadSavedContacts(uid: string): void {
  const filePath = savedContactsPath(uid);
  if (!fs.existsSync(filePath)) return;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const contactData: Record<string, SavedContact> = raw.contacts ?? {};

    const store = savedContactStore.get(uid) ?? new Map<string, SavedContact>();
    for (const [jid, contact] of Object.entries(contactData)) {
      store.set(jid, contact);
    }
    savedContactStore.set(uid, store);

    logger.debug({ uid, count: store.size }, 'Loaded saved contacts from disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to load saved contacts from disk');
  }
}

/** Persist the saved contact store to disk. */
function persistSavedContacts(uid: string): void {
  const store = savedContactStore.get(uid);
  if (!store) return;

  try {
    const sessionDir = path.join('sessions', uid);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const contacts = Object.fromEntries(store);
    fs.writeFileSync(savedContactsPath(uid), JSON.stringify({ contacts }, null, 2), 'utf-8');
    logger.info({ uid, count: store.size }, 'Persisted saved contacts to disk');
  } catch (err) {
    logger.error({ uid, err }, 'Failed to persist saved contacts to disk');
  }
}

/** Get all saved contacts for a uid. */
export function getSavedContacts(uid: string): Map<string, SavedContact> {
  return savedContactStore.get(uid) ?? new Map();
}

/** Save (upsert) a contact. Uses the canonical JID as key. */
export function saveContact(uid: string, name: string, jid: string): SavedContact {
  if (!savedContactStore.has(uid)) {
    savedContactStore.set(uid, new Map());
  }
  const store = savedContactStore.get(uid)!;

  const existing = store.get(jid);
  const now = new Date().toISOString();

  const contact: SavedContact = {
    id: jid,
    name,
    addedAt: existing?.addedAt ?? now,
    ...(existing ? { updatedAt: now } : {}),
  };

  store.set(jid, contact);
  persistSavedContacts(uid);

  logger.info({ uid, jid, name }, existing ? 'Saved contact updated' : 'Saved contact added');
  return contact;
}

/** Delete a saved contact by JID. Returns true if the contact existed. */
export function deleteContact(uid: string, jid: string): boolean {
  const store = savedContactStore.get(uid);
  if (!store) return false;

  const deleted = store.delete(jid);
  if (deleted) {
    persistSavedContacts(uid);
    logger.info({ uid, jid }, 'Saved contact deleted');
  }
  return deleted;
}
