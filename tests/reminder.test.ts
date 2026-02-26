import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock whatsapp service ─────────────────────────────────────────────────────
const mockSendSelfMessage = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockIsConnected = vi.fn().mockReturnValue(true);

vi.mock('../src/services/whatsapp.js', () => ({
  sendSelfMessage: mockSendSelfMessage,
  sendMessage: mockSendMessage,
  isConnected: mockIsConnected,
}));

// ── Mock fs ───────────────────────────────────────────────────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...(actual.default as Record<string, unknown>),
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn().mockReturnValue('[]'),
      mkdirSync: vi.fn(),
    },
  };
});

const { scheduleReminder, startReminderTick } = await import(
  '../src/services/reminder.js'
);

describe('Reminder service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scheduleReminder returns incrementing IDs', () => {
    const id1 = scheduleReminder('u1', 'msg1', 5, 'self', 'yourself');
    const id2 = scheduleReminder('u1', 'msg2', 10, 'self', 'yourself');

    expect(id1).toMatch(/^r_\d+$/);
    expect(id2).toMatch(/^r_\d+$/);
    const n1 = parseInt(id1.replace('r_', ''), 10);
    const n2 = parseInt(id2.replace('r_', ''), 10);
    expect(n2).toBe(n1 + 1);
  });

  it('scheduleReminder persists to disk', async () => {
    const fs = (await import('fs')).default;
    scheduleReminder('u1', 'persist test', 1, 'self', 'yourself');
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('fires self-reminder after delay via tick loop', async () => {
    startReminderTick(1000);
    scheduleReminder('u1', 'Take a break', 1, 'self', 'yourself');

    // Advance 1 minute + one tick
    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockSendSelfMessage).toHaveBeenCalledWith(
      'u1',
      expect.stringContaining('Take a break'),
    );
  });

  it('fires contact-reminder via sendMessage', async () => {
    startReminderTick(1000);
    scheduleReminder('u1', 'Meeting soon', 1, '1234@s.whatsapp.net', 'John');

    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockSendMessage).toHaveBeenCalledWith(
      'u1',
      '1234@s.whatsapp.net',
      expect.stringContaining('Meeting soon'),
    );
  });

  it('skips reminder when WhatsApp not connected', async () => {
    mockIsConnected.mockReturnValue(false);
    startReminderTick(1000);
    scheduleReminder('u1', 'No conn', 1, 'self', 'yourself');

    await vi.advanceTimersByTimeAsync(61_000);

    expect(mockSendSelfMessage).not.toHaveBeenCalled();
  });

  it('does not fire reminder before its scheduled time', async () => {
    startReminderTick(1000);
    scheduleReminder('u1', 'Too early', 5, 'self', 'yourself');

    // Advance only 2 minutes (reminder is at 5)
    await vi.advanceTimersByTimeAsync(120_000);

    expect(mockSendSelfMessage).not.toHaveBeenCalled();
  });
});
