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
 * Supported separators between name and content: "saying", "asking", "telling", "tell him/her/them", "that", ":"
 *
 * Supported patterns:
 *   - "send message to {name} saying/asking/: {content}"
 *   - "send a message to {name} saying/asking/: {content}"
 *   - "message {name} saying/asking/: {content}"
 *   - "text {name} saying/asking/: {content}"
 *   - "whatsapp {name} saying/asking/: {content}"
 *
 * Each regex captures two groups: (1) name, (2) content.
 */
const SEP = '(?:saying|asking|telling|tell(?:\\s+(?:him|her|them))?|that|:)';
const COMMAND_PATTERNS: RegExp[] = [
  new RegExp(`send\\s+(?:a\\s+)?message\\s+to\\s+(.+?)\\s*${SEP}\\s*(.+)`, 'i'),
  new RegExp(`^message\\s+(.+?)\\s*${SEP}\\s*(.+)`, 'i'),
  new RegExp(`^text\\s+(.+?)\\s*${SEP}\\s*(.+)`, 'i'),
  new RegExp(`^whatsapp\\s+(.+?)\\s*${SEP}\\s*(.+)`, 'i'),
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
