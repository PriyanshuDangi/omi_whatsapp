import { describe, it, expect } from 'vitest';
import { formatMemoryRecap } from '../src/services/formatter.js';
import { makeMemory } from './fixtures/memory.js';

describe('formatMemoryRecap', () => {
  it('formats a full memory with all fields', () => {
    const recap = formatMemoryRecap(makeMemory());

    expect(recap).toContain('📋 *Team Standup*');
    expect(recap).toContain('📝 Discussed sprint progress');
    expect(recap).toContain('✅ *Action Items:*');
    expect(recap).toContain('• Fix the login bug');
    expect(recap).toContain('☑️ Review PR #42');
    expect(recap).toContain('🏷️ Category: work');
    expect(recap).toContain('🕐 Duration: 30 min');
  });

  it('returns empty string for discarded memory', () => {
    expect(formatMemoryRecap(makeMemory({ discarded: true }))).toBe('');
  });

  it('returns empty string when title is missing', () => {
    expect(formatMemoryRecap(makeMemory({ structured: { title: '', overview: 'x', emoji: '', category: '', action_items: [], events: [] } }))).toBe('');
  });

  it('uses fallback emoji when none provided', () => {
    const recap = formatMemoryRecap(makeMemory({ structured: { title: 'No Emoji', overview: '', emoji: '', category: '', action_items: [], events: [] } }));
    expect(recap).toContain('📋 *No Emoji*');
  });

  it('omits action items section when empty', () => {
    const recap = formatMemoryRecap(makeMemory({
      structured: { title: 'Quick Chat', overview: 'Short talk.', emoji: '💬', category: 'personal', action_items: [], events: [] },
    }));
    expect(recap).not.toContain('Action Items');
    expect(recap).toContain('💬 *Quick Chat*');
  });

  it('omits overview when missing', () => {
    const recap = formatMemoryRecap(makeMemory({
      structured: { title: 'Minimal', overview: '', emoji: '📋', category: '', action_items: [], events: [] },
    }));
    expect(recap).not.toContain('📝');
  });

  it('omits category when missing', () => {
    const recap = formatMemoryRecap(makeMemory({
      structured: { title: 'No Cat', overview: '', emoji: '📋', category: '', action_items: [], events: [] },
    }));
    expect(recap).not.toContain('🏷️');
  });

  it('formats duration < 1 min', () => {
    const recap = formatMemoryRecap(makeMemory({
      started_at: '2025-06-15T14:00:00Z',
      finished_at: '2025-06-15T14:00:20Z',
    }));
    expect(recap).toContain('<1 min');
  });

  it('formats duration as exact hours', () => {
    const recap = formatMemoryRecap(makeMemory({
      started_at: '2025-06-15T12:00:00Z',
      finished_at: '2025-06-15T14:00:00Z',
    }));
    expect(recap).toContain('2h');
    expect(recap).not.toContain('2h 0m');
  });

  it('formats duration as hours + minutes', () => {
    const recap = formatMemoryRecap(makeMemory({
      started_at: '2025-06-15T12:00:00Z',
      finished_at: '2025-06-15T14:15:00Z',
    }));
    expect(recap).toContain('2h 15m');
  });

  it('shows all completed action items with checkmark', () => {
    const recap = formatMemoryRecap(makeMemory({
      structured: {
        title: 'Done',
        overview: '',
        emoji: '✅',
        category: '',
        action_items: [
          { description: 'Task A', completed: true },
          { description: 'Task B', completed: true },
        ],
        events: [],
      },
    }));
    expect(recap).toContain('☑️ Task A');
    expect(recap).toContain('☑️ Task B');
    expect(recap).not.toContain('• Task');
  });
});
