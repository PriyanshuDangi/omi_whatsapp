/**
 * Saved contacts service — user-managed contacts that take priority over
 * Baileys-synced contacts for name matching.
 *
 * Stored at `sessions/{uid}/saved-contacts.json` with the same Contact-compatible
 * shape used by the Baileys contact store, plus metadata fields.
 */

import fs from 'fs';
import path from 'path';
import type { Contact } from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';

export type ContactSource = 'manual' | 'import';

export interface SavedContact extends Contact {
  addedAt: string;
  updatedAt?: string;
  source?: ContactSource;
}

export interface ImportStats {
  upserted: number;
  skipped: number;
  invalid: number;
  manualPreserved: number;
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
      // Backward compat: default missing source to "manual"
      if (!contact.source) contact.source = 'manual';
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
export function saveContact(uid: string, name: string, jid: string, source: ContactSource = 'manual'): SavedContact {
  if (!savedContactStore.has(uid)) {
    savedContactStore.set(uid, new Map());
  }
  const store = savedContactStore.get(uid)!;

  const existing = store.get(jid);

  // Manual contacts are never overwritten by imports
  if (existing?.source === 'manual' && source === 'import') {
    return existing;
  }

  const now = new Date().toISOString();

  const contact: SavedContact = {
    id: jid,
    name,
    source,
    addedAt: existing?.addedAt ?? now,
    ...(existing ? { updatedAt: now } : {}),
  };

  store.set(jid, contact);
  persistSavedContacts(uid);

  logger.info({ uid, jid, name, source }, existing ? 'Saved contact updated' : 'Saved contact added');
  return contact;
}

/**
 * Normalize a phone string to digits-only.
 * Strips +, spaces, hyphens, parentheses. Returns empty string if invalid.
 */
function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Bulk-import contacts from a phone picker or similar source.
 * Does NOT verify numbers on WhatsApp — saves them directly.
 * Manual contacts are never overwritten by imports.
 */
export function importContacts(uid: string, contacts: Array<{ name: string; phone: string }>): ImportStats {
  if (!savedContactStore.has(uid)) {
    savedContactStore.set(uid, new Map());
  }
  const store = savedContactStore.get(uid)!;
  const now = new Date().toISOString();

  const stats: ImportStats = { upserted: 0, skipped: 0, invalid: 0, manualPreserved: 0 };

  for (const entry of contacts) {
    const name = entry.name?.trim();
    const digits = normalizePhone(entry.phone ?? '');

    if (!name || !digits || digits.length < 7) {
      stats.invalid++;
      continue;
    }

    const jid = `${digits}@s.whatsapp.net`;
    const existing = store.get(jid);

    if (existing?.source === 'manual') {
      stats.manualPreserved++;
      stats.skipped++;
      continue;
    }

    if (existing && existing.source === 'import' && existing.name === name) {
      stats.skipped++;
      continue;
    }

    store.set(jid, {
      id: jid,
      name,
      source: 'import',
      addedAt: existing?.addedAt ?? now,
      ...(existing ? { updatedAt: now } : {}),
    });
    stats.upserted++;
  }

  // Persist once after all inserts
  persistSavedContacts(uid);

  return stats;
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
