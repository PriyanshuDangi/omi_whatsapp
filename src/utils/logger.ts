/**
 * Shared pino logger — single source of truth for all app logging.
 *
 * Writes to both stdout (for pm2) and logs/app.log (persistent file).
 * Exports a silenced Baileys logger to suppress all Baileys internal noise.
 */

import fs from 'fs';
import path from 'path';
import pino from 'pino';

// pino transports run in a worker thread where relative paths and import.meta.url
// resolve unpredictably. Write directly to a pino.destination for reliable file logging.
const LOGS_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'app.log');

fs.mkdirSync(LOGS_DIR, { recursive: true });

const fileDestination = pino.destination({ dest: LOG_FILE, append: true, sync: false });

const multistream = pino.multistream([
  { stream: process.stdout, level: 'info' },
  { stream: fileDestination, level: 'info' },
]);

/** App-wide logger. */
export const logger = pino({
  level: 'info',
  base: undefined,
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
