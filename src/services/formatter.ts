/**
 * Message formatter — converts an Omi memory payload into a clean WhatsApp recap message.
 * No LLM needed: uses the structured data Omi already provides.
 */

import type { OmiMemory } from '../types/omi.js';

const MAX_OVERVIEW_LENGTH = 500;

/** Compute a human-readable duration string from two ISO timestamps. */
function formatDuration(startedAt: string, finishedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(finishedAt).getTime();
  const diffMs = end - start;

  if (isNaN(diffMs) || diffMs < 0) {
    return 'Unknown';
  }

  const totalMinutes = Math.round(diffMs / 60_000);
  if (totalMinutes < 1) return '<1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Format a date string for display (e.g. "Mon, Jan 15 2024 at 3:45 PM"). */
function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return 'Unknown date';

  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Truncate text to maxLength, appending "..." if truncated. */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '...';
}

/**
 * Build a formatted WhatsApp recap message from an Omi memory.
 * Returns an empty string if the memory should be skipped (discarded or missing structured data).
 */
export function formatMemoryRecap(memory: OmiMemory): string {
  // Skip discarded memories or those without structured data
  if (memory.discarded) return '';
  if (!memory.structured || !memory.structured.title) return '';

  const { structured, started_at, finished_at, created_at } = memory;
  const emoji = structured.emoji || '📋';

  const lines: string[] = [];

  // Title
  lines.push(`${emoji} *${structured.title}*`);
  lines.push('');

  // Overview
  if (structured.overview) {
    lines.push(`📝 ${truncate(structured.overview, MAX_OVERVIEW_LENGTH)}`);
    lines.push('');
  }

  // Action items (omit section entirely if empty)
  if (structured.action_items && structured.action_items.length > 0) {
    lines.push('✅ *Action Items:*');
    for (const item of structured.action_items) {
      const check = item.completed ? '☑️' : '•';
      lines.push(`${check} ${item.description}`);
    }
    lines.push('');
  }

  // Metadata footer
  if (structured.category) {
    lines.push(`🏷️ Category: ${structured.category}`);
  }

  if (started_at && finished_at) {
    lines.push(`🕐 Duration: ${formatDuration(started_at, finished_at)}`);
  }

  if (created_at) {
    lines.push(`📅 ${formatDate(created_at)}`);
  }

  return lines.join('\n');
}
