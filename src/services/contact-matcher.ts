/**
 * Contact matcher — fuzzy match a spoken name to a WhatsApp contact.
 * Matching priority: exact > starts-with > contains.
 */

import type { Contact } from '@whiskeysockets/baileys';

export interface MatchedContact {
  jid: string;
  displayName: string;
}

/**
 * Get all name variants for a contact (lowercased).
 * Checks: name (saved name), notify (contact's own name), verifiedName.
 */
function getNameVariants(contact: Contact): string[] {
  const variants: string[] = [];
  if (contact.name) variants.push(contact.name.toLowerCase());
  if (contact.notify) variants.push(contact.notify.toLowerCase());
  if (contact.verifiedName) variants.push(contact.verifiedName.toLowerCase());
  return variants;
}

/** Get the best display name for a contact. */
function getDisplayName(contact: Contact): string {
  return contact.name || contact.notify || contact.verifiedName || contact.id;
}

/**
 * Find a WhatsApp contact by name. Uses tiered matching:
 *   1. Exact match (full name equals query)
 *   2. First-name match (first word of contact name equals query)
 *   3. Starts-with match
 *   4. Contains match
 *
 * Skips group JIDs and status broadcasts.
 */
export function findContact(
  contacts: Map<string, Contact>,
  name: string
): MatchedContact | null {
  const query = name.toLowerCase().trim();
  if (!query) return null;

  let exactMatch: MatchedContact | null = null;
  let firstNameMatch: MatchedContact | null = null;
  let startsWithMatch: MatchedContact | null = null;
  let containsMatch: MatchedContact | null = null;

  for (const [jid, contact] of contacts) {
    // Skip groups (@g.us) and status broadcasts
    if (jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
    // Skip contacts with LID-only JIDs that aren't proper phone numbers
    if (!jid.includes('@s.whatsapp.net') && !contact.phoneNumber) continue;

    const variants = getNameVariants(contact);
    const displayName = getDisplayName(contact);

    for (const variant of variants) {
      if (variant === query) {
        exactMatch = { jid, displayName };
        break;
      }

      // Match first name (e.g., "john" matches "John Doe")
      const firstName = variant.split(/\s+/)[0];
      if (firstName === query && !firstNameMatch) {
        firstNameMatch = { jid, displayName };
      }

      if (variant.startsWith(query) && !startsWithMatch) {
        startsWithMatch = { jid, displayName };
      }

      if (variant.includes(query) && !containsMatch) {
        containsMatch = { jid, displayName };
      }
    }

    // Short-circuit on exact match
    if (exactMatch) return exactMatch;
  }

  // Return best available match in priority order
  return firstNameMatch || startsWithMatch || containsMatch;
}
