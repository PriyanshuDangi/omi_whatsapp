/**
 * Command parser — detects voice command patterns in transcript text.
 * Matches phrases like "send message to John: I'll have the doc ready".
 */

export interface ParsedCommand {
  name: string;
  content: string;
}

/**
 * Regex patterns for voice command detection (case-insensitive).
 *
 * Supported patterns:
 *   - "send message to {name}: {content}"
 *   - "send message to {name} saying {content}"
 *   - "send a message to {name}: {content}"
 *   - "message {name}: {content}"
 *   - "text {name}: {content}"
 *   - "whatsapp {name}: {content}"
 *
 * Each regex captures two groups: (1) name, (2) content.
 */
const COMMAND_PATTERNS: RegExp[] = [
  /send\s+(?:a\s+)?message\s+to\s+(.+?)\s*(?:saying|:)\s*(.+)/i,
  /^message\s+(.+?)\s*(?:saying|:)\s*(.+)/i,
  /^text\s+(.+?)\s*(?:saying|:)\s*(.+)/i,
  /^whatsapp\s+(.+?)\s*(?:saying|:)\s*(.+)/i,
];

/**
 * Parse a text string for a voice command.
 * Returns the extracted name and message content, or null if no command detected.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  for (const pattern of COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const name = match[1].trim();
      const content = match[2].trim();

      if (!name || !content) continue;

      return { name, content };
    }
  }

  return null;
}
