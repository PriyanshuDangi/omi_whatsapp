/**
 * Contact matcher — fuzzy match a spoken name to a WhatsApp contact.
 *
 * Scoring tiers (highest wins):
 *   100  exact match
 *    85  first-name match
 *    70  token-overlap (Jaccard, scaled)
 *    60  starts-with
 *    40  contains
 *    20  edit-distance fuzzy (Levenshtein, scaled)
 */

import type { Contact } from '@whiskeysockets/baileys';
import { distance } from 'fastest-levenshtein';
import type { SavedContact } from './saved-contacts.js';

export interface MatchedContact {
  jid: string;
  displayName: string;
}

const SCORE_EXACT = 100;
const SCORE_FIRST_NAME = 85;
const SCORE_TOKEN_OVERLAP = 70;
const SCORE_STARTS_WITH = 60;
const SCORE_CONTAINS = 40;
const SCORE_FUZZY = 20;

/**
 * Strip diacritics, punctuation, and collapse whitespace so that
 * "José O'Brien" and "jose obrien" compare as equal.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

/** Extract normalized name variants from a Baileys contact. */
function getNameVariants(contact: Contact): string[] {
  const variants: string[] = [];
  if (contact.name) variants.push(normalize(contact.name));
  if (contact.notify) variants.push(normalize(contact.notify));
  if (contact.verifiedName) variants.push(normalize(contact.verifiedName));
  return variants;
}

function getDisplayName(contact: Contact): string {
  return contact.name || contact.notify || contact.verifiedName || contact.id;
}

/**
 * Jaccard similarity on word tokens: |intersection| / |union|.
 * Returns 0–1. Only meaningful when both sides have >1 token.
 */
function tokenOverlap(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  if (setA.size <= 1 && setB.size <= 1) return 0;

  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Score a single variant against the query. Returns the highest applicable
 * tier score (only one tier fires per variant).
 */
function scoreVariant(query: string, queryTokens: Set<string>, variant: string): number {
  if (variant === query) return SCORE_EXACT;

  const firstName = variant.split(/\s+/)[0];
  if (firstName === query) return SCORE_FIRST_NAME;

  const overlap = tokenOverlap(query, variant);
  if (overlap >= 0.5) return SCORE_TOKEN_OVERLAP * overlap;

  if (variant.startsWith(query)) return SCORE_STARTS_WITH;
  if (variant.includes(query)) return SCORE_CONTAINS;

  // Fuzzy: allow at most 1 edit per 4 chars (minimum 1)
  const maxDist = Math.max(1, Math.floor(query.length / 4));
  const dist = distance(query, variant);
  if (dist <= maxDist) {
    return SCORE_FUZZY * (1 - dist / query.length);
  }

  // Also try fuzzy against just the first name of the variant
  const firstNameDist = distance(query, firstName);
  if (firstNameDist <= maxDist) {
    return SCORE_FUZZY * (1 - firstNameDist / query.length);
  }

  return 0;
}

/**
 * Score a contact map and return the best match found.
 * Shared by both saved-contact and Baileys-contact passes.
 * When two contacts tie on score, manual source wins over import.
 */
function findBestInMap(
  contactMap: Map<string, Contact>,
  query: string,
  queryTokens: Set<string>,
  currentBestScore: number,
  currentBestMatch: MatchedContact | null,
  currentBestSource?: string,
): { score: number; match: MatchedContact | null; source?: string } {
  let bestScore = currentBestScore;
  let bestMatch = currentBestMatch;
  let bestSource = currentBestSource;

  for (const [jid, contact] of contactMap) {
    if (!jid.endsWith('@s.whatsapp.net')) continue;

    const variants = getNameVariants(contact);
    const displayName = getDisplayName(contact);
    const contactSource = (contact as SavedContact).source;

    for (const variant of variants) {
      const score = scoreVariant(query, queryTokens, variant);
      const isBetter = score > bestScore
        || (score === bestScore && contactSource === 'manual' && bestSource === 'import');

      if (isBetter) {
        bestScore = score;
        bestMatch = { jid, displayName };
        bestSource = contactSource;
      }
      if (bestScore >= SCORE_EXACT) return { score: bestScore, match: bestMatch, source: bestSource };
    }
  }

  return { score: bestScore, match: bestMatch, source: bestSource };
}

/**
 * Find a WhatsApp contact by name. Saved contacts (user-managed) are checked
 * first and take priority — a strong match (>= first-name tier) short-circuits
 * without scanning Baileys contacts.
 */
export function findContact(
  contacts: Map<string, Contact>,
  name: string,
  savedContacts?: Map<string, SavedContact>,
): MatchedContact | null {
  const query = normalize(name);
  if (!query) return null;

  const queryTokens = new Set(query.split(/\s+/));

  // First pass: saved contacts get priority
  if (savedContacts && savedContacts.size > 0) {
    const saved = findBestInMap(savedContacts, query, queryTokens, 0, null, undefined);
    if (saved.match && saved.score >= SCORE_FIRST_NAME) {
      return saved.match;
    }

    // If saved contacts had a weaker match, carry it as the baseline
    const { match } = findBestInMap(contacts, query, queryTokens, saved.score, saved.match, saved.source);
    return match;
  }

  // No saved contacts — scan Baileys contacts only
  const { match } = findBestInMap(contacts, query, queryTokens, 0, null, undefined);
  return match;
}
