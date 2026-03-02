import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...(actual.default as Record<string, unknown>),
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue('{"contacts":{}}'),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
  };
});

const {
  savedContactsPath,
  loadSavedContacts,
  getSavedContacts,
  saveContact,
  deleteContact,
} = await import('../src/services/saved-contacts.js');

describe('saved-contacts service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds saved contacts path from uid', () => {
    expect(savedContactsPath('user-1')).toBe('sessions/user-1/saved-contacts.json');
  });

  it('returns empty map when user has no saved contacts', () => {
    expect(getSavedContacts('never-seen')).toEqual(new Map());
  });

  it('saves a contact and persists it', async () => {
    const fs = (await import('fs')).default;

    const contact = saveContact('user-save', 'Mom', '14155551234@s.whatsapp.net');

    expect(contact).toMatchObject({
      id: '14155551234@s.whatsapp.net',
      name: 'Mom',
    });
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(getSavedContacts('user-save').size).toBe(1);
  });

  it('updating an existing contact keeps addedAt and sets updatedAt', () => {
    const first = saveContact('user-update', 'Mom', '14155551234@s.whatsapp.net');
    const second = saveContact('user-update', 'Mother', '14155551234@s.whatsapp.net');

    expect(second.addedAt).toBe(first.addedAt);
    expect(second.updatedAt).toBeDefined();
    expect(second.name).toBe('Mother');
  });

  it('loads contacts from disk when file exists', async () => {
    const fs = (await import('fs')).default;
    vi.mocked(fs.existsSync).mockReturnValueOnce(true);
    vi.mocked(fs.readFileSync).mockReturnValueOnce(JSON.stringify({
      contacts: {
        '14155550000@s.whatsapp.net': {
          id: '14155550000@s.whatsapp.net',
          name: 'Alice',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    }) as any);

    loadSavedContacts('user-load');

    const loaded = getSavedContacts('user-load');
    expect(loaded.size).toBe(1);
    expect(loaded.get('14155550000@s.whatsapp.net')?.name).toBe('Alice');
  });

  it('deleteContact returns false when contact is missing', () => {
    expect(deleteContact('unknown-user', '1@s.whatsapp.net')).toBe(false);
  });

  it('deleteContact removes existing contact and persists', async () => {
    const fs = (await import('fs')).default;
    saveContact('user-delete', 'Bob', '14155551111@s.whatsapp.net');

    const deleted = deleteContact('user-delete', '14155551111@s.whatsapp.net');

    expect(deleted).toBe(true);
    expect(getSavedContacts('user-delete').size).toBe(0);
    expect(fs.writeFileSync).toHaveBeenCalled();
  });
});
