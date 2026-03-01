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
import { Writable } from 'stream';

/** Request context (tid) for correlating logs. Set by middleware, read by mixin. */
export const requestContextStorage = new AsyncLocalStorage<{ tid: string }>();

const LOGS_DIR = path.join(process.cwd(), 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

function getDateString(): string {
  return new Date().toISOString().slice(0, 10); // yyyy-mm-dd, always sorted
}

/** Writable stream that rotates to a new file each day (app-yyyy-mm-dd.log). */
class DailyFileStream extends Writable {
  private currentDate: string;
  private stream: fs.WriteStream | null = null;

  constructor() {
    super();
    this.currentDate = getDateString();
    this.openStream();
  }

  private openStream(): void {
    const filename = `app-${this.currentDate}.log`;
    const dest = path.join(LOGS_DIR, filename);
    this.stream = fs.createWriteStream(dest, { flags: 'a' });
  }

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (err?: Error | null) => void,
  ): void {
    const date = getDateString();
    if (date !== this.currentDate) {
      if (this.stream && !this.stream.destroyed) {
        this.stream.destroy();
      }
      this.currentDate = date;
      this.openStream();
    }
    if (this.stream && !this.stream.destroyed) {
      this.stream.write(chunk, encoding, callback);
    } else {
      callback();
    }
  }
}

const dailyFileStream = new DailyFileStream();

const multistream = pino.multistream([
  { stream: process.stdout, level: 'info' },
  { stream: dailyFileStream, level: 'info' },
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
