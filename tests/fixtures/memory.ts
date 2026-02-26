import type { OmiMemory } from '../../src/types/omi.js';

const DEFAULTS: OmiMemory = {
  id: 'test-memory-001',
  created_at: '2025-06-15T14:30:00Z',
  started_at: '2025-06-15T14:00:00Z',
  finished_at: '2025-06-15T14:30:00Z',
  discarded: false,
  structured: {
    title: 'Team Standup',
    overview: 'Discussed sprint progress and blockers.',
    emoji: '📋',
    category: 'work',
    action_items: [
      { description: 'Fix the login bug', completed: false },
      { description: 'Review PR #42', completed: true },
    ],
    events: [],
  },
  transcript_segments: [
    {
      text: 'Good morning, let us start.',
      speaker: 'SPEAKER_0',
      speaker_id: 0,
      is_user: true,
      start: 0,
      end: 3,
    },
  ],
  apps_response: [],
};

/** Build an OmiMemory with sensible defaults, overridden by `overrides`. */
export function makeMemory(overrides: Partial<OmiMemory> = {}): OmiMemory {
  return {
    ...DEFAULTS,
    ...overrides,
    structured: {
      ...DEFAULTS.structured,
      ...(overrides.structured ?? {}),
    },
  };
}
