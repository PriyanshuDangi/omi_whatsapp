/**
 * Input sanitization utilities.
 * Prevents path traversal and injection via user-supplied parameters.
 */

/** Only alphanumeric, underscore, and hyphen are allowed in uid values. */
const UID_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Validate that a uid contains only safe characters. */
export function sanitizeUid(uid: string): boolean {
  return UID_REGEX.test(uid);
}
