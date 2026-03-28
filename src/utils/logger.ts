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

/**
 * Writable stream that rotates to a new daily file automatically.
 * This avoids pinning all logs to the startup date when the process
 * runs across midnight.
 */
class DailyRotatingFileStream {
  private currentDate = getDateString();
  private stream = this.openStream(this.currentDate);

  private openStream(date: string): fs.WriteStream {
    const filePath = path.join(LOGS_DIR, `app-${date}.log`);
    return fs.createWriteStream(filePath, { flags: 'a' });
  }

  private rotateIfNeeded(): void {
    const nextDate = getDateString();
    if (nextDate === this.currentDate) return;

    const prev = this.stream;
    this.currentDate = nextDate;
    this.stream = this.openStream(nextDate);
    prev.end();
  }

  write(chunk: string | Buffer): boolean {
    this.rotateIfNeeded();
    return this.stream.write(chunk);
  }

  end(): void {
    this.stream.end();
  }
}

const fileDestination = new DailyRotatingFileStream();

const multistream = pino.multistream([
  { stream: process.stdout, level: 'info' },
  { stream: fileDestination as unknown as NodeJS.WritableStream, level: 'info' },
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
