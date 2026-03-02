import { describe, it, expect } from 'vitest';
import { findContact } from '../src/services/contact-matcher.js';
import { makeContacts } from './fixtures/contacts.js';

describe('findContact', () => {
  const contacts = makeContacts();

  it('exact match on name', () => {
    const result = findContact(contacts, 'John Smith');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
    expect(result!.displayName).toBe('John Smith');
  });

  it('exact match on notify name', () => {
    const result = findContact(contacts, 'Johnny');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
  });

  it('exact match on verifiedName', () => {
    const result = findContact(contacts, 'Alice Wonderland');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543212@s.whatsapp.net');
  });

  it('first-name match', () => {
    const result = findContact(contacts, 'John');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
  });

  it('case insensitive match', () => {
    const result = findContact(contacts, 'john smith');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
  });

  it('diacritic stripping — "jose" matches "José García"', () => {
    const result = findContact(contacts, 'jose');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543211@s.whatsapp.net');
  });

  it('matches single-word name exactly', () => {
    const result = findContact(contacts, 'Mom');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543213@s.whatsapp.net');
  });

  it('starts-with matching', () => {
    const result = findContact(contacts, 'Rob');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543214@s.whatsapp.net');
  });

  it('contains matching — "Alice" appears in "Alice Wonderland"', () => {
    const result = findContact(contacts, 'Alice');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543212@s.whatsapp.net');
  });

  it('fuzzy match — small typo', () => {
    const result = findContact(contacts, 'Johny');
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
  });

  it('skips group JIDs', () => {
    const result = findContact(contacts, 'Family Group');
    expect(result).toBeNull();
  });

  it('skips status broadcast', () => {
    const result = findContact(contacts, 'Status');
    expect(result).toBeNull();
  });

  it('returns null for empty query', () => {
    expect(findContact(contacts, '')).toBeNull();
  });

  it('returns null for no match', () => {
    expect(findContact(contacts, 'Zxyqwerty')).toBeNull();
  });

  it('returns null for empty contacts map', () => {
    expect(findContact(new Map(), 'John')).toBeNull();
  });

  it('prioritizes a strong match from saved contacts', () => {
    const saved = new Map([
      ['14155551234@s.whatsapp.net', {
        id: '14155551234@s.whatsapp.net',
        name: 'Alex',
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    ]);

    const result = findContact(contacts, 'Alex', saved as any);
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('14155551234@s.whatsapp.net');
  });

  it('falls back to WhatsApp contacts when saved match is weak', () => {
    const saved = new Map([
      ['14155550000@s.whatsapp.net', {
        id: '14155550000@s.whatsapp.net',
        name: 'Zed Person',
        addedAt: '2026-01-01T00:00:00.000Z',
      }],
    ]);

    const result = findContact(contacts, 'John Smith', saved as any);
    expect(result).not.toBeNull();
    expect(result!.jid).toBe('919876543210@s.whatsapp.net');
  });
});
