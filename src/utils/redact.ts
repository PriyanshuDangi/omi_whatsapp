/**
 * Log redaction — replaces message/text content fields with length placeholders.
 * Contact names, phone numbers, and all other metadata are left untouched.
 */

const TEXT_FIELDS = new Set(['message', 'summary']);

/**
 * Shallow-clone a request/response body, replacing known message-content
 * fields with safe length-only placeholders. Non-object values pass through unchanged.
 */
export function redactBody(body: unknown): unknown {
  if (body === null || body === undefined || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body;

  const redacted: Record<string, unknown> = { ...(body as Record<string, unknown>) };

  for (const key of Object.keys(redacted)) {
    const val = redacted[key];

    if (TEXT_FIELDS.has(key) && typeof val === 'string') {
      redacted[key] = `*** length: ${val.length} ***`;
    } else if (key === 'transcript_segments' && Array.isArray(val)) {
      redacted[key] = `*** segments: ${val.length} ***`;
    } else if (key === 'structured' && typeof val === 'object' && val !== null) {
      redacted[key] = '*** redacted ***';
    }
  }

  return redacted;
}
