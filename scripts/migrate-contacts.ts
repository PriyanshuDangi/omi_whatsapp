/**
 * Migrate contacts.json from the old flat format to the new { contacts, lidMap } format.
 *
 * Old format:  { "jid-or-lid": Contact, ... }
 * New format:  { contacts: { "jid": Contact, ... }, lidMap: { "lid": "jid", ... } }
 *
 * What this does:
 *   1. Reads each session's contacts.json
 *   2. Builds a LID→JID mapping from contacts that have a `lid` field
 *   3. Merges LID-keyed contacts into their JID counterpart (if mapping exists)
 *   4. Drops LID-only orphans with no name/notify (they're useless for matching)
 *   5. Writes the new format back (backs up the original first)
 *
 * Usage:  npx tsx scripts/migrate-contacts.ts
 */

import fs from 'fs';
import path from 'path';

const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

interface RawContact {
  id: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  lid?: string;
  [key: string]: unknown;
}

function migrate(sessionDir: string): void {
  const contactsPath = path.join(sessionDir, 'contacts.json');
  if (!fs.existsSync(contactsPath)) return;

  const uid = path.basename(sessionDir);
  const raw = JSON.parse(fs.readFileSync(contactsPath, 'utf-8'));

  // Already migrated?
  if (raw.contacts && raw.lidMap) {
    console.log(`  [skip] ${uid} — already in new format`);
    return;
  }

  const oldContacts: Record<string, RawContact> = raw;

  // Phase 1: Build LID→JID mapping from JID-keyed entries that carry a lid field
  const lidMap: Record<string, string> = {};
  for (const [key, contact] of Object.entries(oldContacts)) {
    if (key.endsWith('@s.whatsapp.net') && contact.lid) {
      lidMap[contact.lid] = key;
    }
  }

  // Phase 2: Merge all entries into JID-keyed contacts
  const newContacts: Record<string, RawContact> = {};
  let merged = 0;
  let dropped = 0;

  for (const [key, contact] of Object.entries(oldContacts)) {
    if (key.endsWith('@s.whatsapp.net')) {
      // Already a JID entry — keep it, remove the lid field from the stored contact
      const clean = { ...contact };
      delete clean.lid;
      newContacts[key] = clean;
    } else if (key.endsWith('@lid')) {
      const jid = lidMap[key];
      if (jid) {
        // Merge LID contact data into the JID entry
        const existing = newContacts[jid] ?? oldContacts[jid] ?? { id: jid };
        const mergedContact: RawContact = { ...existing, id: jid };

        // Only overwrite name/notify if the LID entry has one and existing doesn't
        if (contact.name && !mergedContact.name) mergedContact.name = contact.name;
        if (contact.notify && !mergedContact.notify) mergedContact.notify = contact.notify;
        if (contact.verifiedName && !mergedContact.verifiedName) mergedContact.verifiedName = contact.verifiedName;

        delete mergedContact.lid;
        newContacts[jid] = mergedContact;
        merged++;
      } else if (contact.name || contact.notify) {
        // LID-only but has a useful name — keep it keyed by LID as a fallback
        newContacts[key] = contact;
      } else {
        dropped++;
      }
    }
  }

  // Back up the original
  const backupPath = contactsPath + '.bak';
  fs.copyFileSync(contactsPath, backupPath);

  // Write new format
  const payload = { contacts: newContacts, lidMap };
  fs.writeFileSync(contactsPath, JSON.stringify(payload), 'utf-8');

  const stats = {
    uid,
    oldEntries: Object.keys(oldContacts).length,
    newEntries: Object.keys(newContacts).length,
    lidMappings: Object.keys(lidMap).length,
    mergedFromLid: merged,
    droppedOrphans: dropped,
  };
  console.log(`  [done] ${uid}:`, stats);
}

// Main
console.log('Migrating contacts.json files...\n');

if (!fs.existsSync(SESSIONS_DIR)) {
  console.log('No sessions directory found. Nothing to migrate.');
  process.exit(0);
}

const sessions = fs.readdirSync(SESSIONS_DIR).filter((d) => {
  return fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory();
});

if (sessions.length === 0) {
  console.log('No session directories found. Nothing to migrate.');
  process.exit(0);
}

for (const session of sessions) {
  migrate(path.join(SESSIONS_DIR, session));
}

console.log('\nDone. Original files backed up as contacts.json.bak');
