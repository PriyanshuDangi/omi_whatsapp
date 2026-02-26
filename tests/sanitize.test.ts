import { describe, it, expect } from 'vitest';
import { sanitizeUid } from '../src/utils/sanitize.js';

describe('sanitizeUid', () => {
  it.each([
    'abc123',
    'xltSjA9GUvdZIXEZfczAZcvwNDJ2',
    'user-with-hyphens',
    'user_with_underscores',
    'MiXeD_CaSe-123',
    'a',
  ])('accepts valid uid: %s', (uid) => {
    expect(sanitizeUid(uid)).toBe(true);
  });

  it.each([
    ['path traversal', '../../../etc/passwd'],
    ['dot', 'has.dot'],
    ['slash', 'has/slash'],
    ['backslash', 'has\\slash'],
    ['space', 'has space'],
    ['special chars', 'uid@!$'],
    ['empty string', ''],
    ['unicode', 'uid✨'],
    ['newline', 'uid\ninjection'],
  ])('rejects invalid uid (%s): %s', (_label, uid) => {
    expect(sanitizeUid(uid)).toBe(false);
  });
});
