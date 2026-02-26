import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Baileys ──────────────────────────────────────────────────────────────
// We need to capture the event handlers registered by whatsapp.ts so we can
// simulate connection.update, contacts.upsert, etc. from within tests.

type Handler = (...args: any[]) => void;

function createMockSocket() {
  const handlers = new Map<string, Handler[]>();
  return {
    ev: {
      on(event: string, handler: Handler) {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      },
    },
    user: { id: '919999999999:0@s.whatsapp.net' },
    sendMessage: vi.fn().mockResolvedValue({}),
    /** Test helper — fire an event as if Baileys emitted it. */
    _emit(event: string, ...args: any[]) {
      for (const h of handlers.get(event) ?? []) h(...args);
    },
    _handlers: handlers,
  };
}

let mockSocket = createMockSocket();

const mockMakeWASocket = vi.fn(() => mockSocket);

vi.mock('@whiskeysockets/baileys', () => {
  return {
    default: mockMakeWASocket,
    useMultiFileAuthState: vi.fn().mockResolvedValue({
      state: {
        creds: { firstUnuploadedPreKeyId: 0 },
        keys: { set: vi.fn() },
      },
      saveCreds: vi.fn(),
    }),
    DisconnectReason: { loggedOut: 401 },
    proto: {
      HistorySync: {
        HistorySyncType: {
          PUSH_NAME: 1,
          INITIAL_BOOTSTRAP: 2,
          RECENT: 3,
          NON_BLOCKING_DATA: 5,
        },
      },
    },
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: {
      ...(actual.default as Record<string, unknown>),
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: vi.fn(),
      readFileSync: vi.fn().mockReturnValue('{}'),
      mkdirSync: vi.fn(),
      readdirSync: vi.fn().mockReturnValue([]),
      unlinkSync: vi.fn(),
    },
  };
});

// ── Import the module under test AFTER mocks are set up ───────────────────────
const {
  initSession,
  isConnected,
  sendSelfMessage,
  sendMessage,
  getContacts,
  getSession,
} = await import('../src/services/whatsapp.js');

describe('WhatsApp service', () => {
  beforeEach(() => {
    mockSocket = createMockSocket();
    mockMakeWASocket.mockReturnValue(mockSocket);
  });

  it('isConnected returns false before initSession', () => {
    expect(isConnected('unknown-uid')).toBe(false);
  });

  it('initSession creates a session and connection opens', async () => {
    await initSession('user-a');
    expect(isConnected('user-a')).toBe(false);

    mockSocket._emit('connection.update', { connection: 'open' });

    expect(isConnected('user-a')).toBe(true);
  });

  it('sendSelfMessage calls socket.sendMessage with normalized self JID', async () => {
    await initSession('user-b');
    mockSocket._emit('connection.update', { connection: 'open' });

    await sendSelfMessage('user-b', 'Hello self');

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '919999999999@s.whatsapp.net',
      { text: 'Hello self' },
    );
  });

  it('sendMessage calls socket.sendMessage with target JID', async () => {
    await initSession('user-c');
    mockSocket._emit('connection.update', { connection: 'open' });

    await sendMessage('user-c', '919876543210@s.whatsapp.net', 'Hi there');

    expect(mockSocket.sendMessage).toHaveBeenCalledWith(
      '919876543210@s.whatsapp.net',
      { text: 'Hi there' },
    );
  });

  it('sendMessage throws when not connected', async () => {
    await expect(sendMessage('nobody', '1@s.whatsapp.net', 'fail')).rejects.toThrow(
      'WhatsApp not connected',
    );
  });

  it('sendSelfMessage throws when not connected', async () => {
    await expect(sendSelfMessage('nobody', 'fail')).rejects.toThrow(
      'WhatsApp not connected',
    );
  });

  it('contacts.upsert populates getContacts', async () => {
    await initSession('user-d');
    mockSocket._emit('connection.update', { connection: 'open' });

    mockSocket._emit('contacts.upsert', [
      { id: '1@s.whatsapp.net', name: 'Test Contact' },
    ]);

    const contacts = getContacts('user-d');
    expect(contacts.size).toBe(1);
    expect(contacts.get('1@s.whatsapp.net')?.name).toBe('Test Contact');
  });

  it('disconnect with loggedOut cleans up session', async () => {
    await initSession('user-e');
    mockSocket._emit('connection.update', { connection: 'open' });
    expect(isConnected('user-e')).toBe(true);

    mockSocket._emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });

    expect(isConnected('user-e')).toBe(false);
    expect(getSession('user-e')).toBeUndefined();
  });

  it('QR code is stored on session when emitted', async () => {
    await initSession('user-f');
    mockSocket._emit('connection.update', { qr: 'test-qr-string' });

    const session = getSession('user-f');
    expect(session?.qr).toBe('test-qr-string');
    expect(session?.connected).toBe(false);
  });
});
