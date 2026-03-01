/**
 * Shared pino logger — single source of truth for all app logging.
 *
 * Writes to both stdout (for pm2) and logs/app-yyyy-mm-dd.log (one file per day, sorted).
 * Exports a silenced Baileys logger to suppress all Baileys internal noise.
 * Request-scoped tid is added via AsyncLocalStorage + mixin when present.
 */

import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

/** Request context (tid) for correlating logs. Set by middleware, read by mixin. */
export const requestContextStorage = new AsyncLocalStorage<{ tid: string }>();

const LOGS_DIR = path.join(process.cwd(), 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

function getDateString(): string {
  return new Date().toISOString().slice(0, 10); // yyyy-mm-dd, always sorted
}

const DAILY_LOG_FILE = path.join(LOGS_DIR, `app-${getDateString()}.log`);
const fileDestination = pino.destination({ dest: DAILY_LOG_FILE, append: true, sync: false });

const multistream = pino.multistream([
  { stream: process.stdout, level: 'info' },
  { stream: fileDestination, level: 'info' },
]);

/** App-wide logger. Tid is added to every log when inside a request (AsyncLocalStorage). */
export const logger = pino({
  level: 'info',
  base: undefined,
  mixin() {
    const store = requestContextStorage.getStore();
    return store ? { tid: store.tid } : {};
  },
  formatters: {
    level(label) { return { level: label }; },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
}, multistream);

/** Silent logger passed to Baileys to suppress all its internal output. */
export const baileysLogger = pino({ level: 'silent' });

// ---------------------------------------------------------------------------
// Intercept console.log/error to suppress Baileys' libsignal noise.
// libsignal uses console.log directly for session dumps and console.error
// for decryption warnings — neither goes through pino.
// ---------------------------------------------------------------------------
const BAILEYS_NOISE = [
  'Closing session',
  'Closing open session',
  'SessionEntry',
  '_chains',
  'registrationId',
  'currentRatchet',
  'ephemeralKeyPair',
  'rootKey',
  'indexInfo',
  'pendingPreKey',
  'chainKey',
  'chainType',
  'messageKeys',
  'Failed to decrypt',
  'Session error',
  'MessageCounterError',
  '<Buffer',
];

function isBaileysNoise(args: unknown[]): boolean {
  const text = args.map(String).join(' ');
  return BAILEYS_NOISE.some((pattern) => text.includes(pattern));
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  if (isBaileysNoise(args)) return;
  originalConsoleLog(...args);
};

console.error = (...args: unknown[]) => {
  if (isBaileysNoise(args)) return;
  originalConsoleError(...args);
};
