import type { Contact } from '@whiskeysockets/baileys';
import contactsJson from './sessions/test-user/contacts.json' with { type: 'json' };

/** Build a Map<string, Contact> from the fixture JSON. */
export function makeContacts(): Map<string, Contact> {
  const map = new Map<string, Contact>();
  for (const [jid, data] of Object.entries(contactsJson)) {
    map.set(jid, data as Contact);
  }
  return map;
}
