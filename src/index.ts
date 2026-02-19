/**
 * Entry point — Express server wiring routes and startup.
 * Single process: setup page, webhook receivers, WhatsApp via Baileys.
 */

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { setupRouter } from './routes/setup.js';
import { webhookRouter } from './routes/webhook.js';
import { manifestRouter, toolsRouter } from './routes/chat-tools.js';
import { initSession } from './services/whatsapp.js';
import { startReminderTick } from './services/reminder.js';
import { sanitizeUid } from './utils/sanitize.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Parse JSON bodies (Omi webhook payloads)
app.use(express.json());

// ---------------------------------------------------------------------------
// UID sanitization middleware (must come after express.json for req.body)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  if (uid && !sanitizeUid(uid)) {
    res.status(400).json({ error: 'Invalid uid format' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Webhook auth — verify OMI_APP_SECRET (skipped in dev when not set)
// ---------------------------------------------------------------------------
app.use('/webhook', (req, res, next) => {
  const secret = process.env.OMI_APP_SECRET;
  if (!secret) return next(); // dev mode, no auth
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Chat tool session validation — uid must have a known session
// ---------------------------------------------------------------------------
app.use('/tools', (req, res, next) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  if (uid && !fs.existsSync(path.join('sessions', uid))) {
    res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
    return;
  }
  next();
});
app.use('/setup/tools', (req, res, next) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  if (uid && !fs.existsSync(path.join('sessions', uid))) {
    res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
    return;
  }
  next();
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// Mount routes
// ---------------------------------------------------------------------------
app.use('/setup', setupRouter);
app.use('/webhook', webhookRouter);
app.use('/.well-known', manifestRouter);
app.use('/tools', toolsRouter);
app.use('/setup/tools', toolsRouter); // Omi resolves relative to App Home URL (/setup)

// ---------------------------------------------------------------------------
// Auto-restore existing WhatsApp sessions from filesystem on startup
// ---------------------------------------------------------------------------
function restoreSessions(): void {
  const sessionsDir = 'sessions';
  if (!fs.existsSync(sessionsDir)) return;

  const uids = fs.readdirSync(sessionsDir).filter((entry) => {
    return fs.statSync(path.join(sessionsDir, entry)).isDirectory();
  });

  for (const uid of uids) {
    logger.info({ uid }, 'Restoring WhatsApp session');
    initSession(uid).catch((err) => {
      logger.error({ uid, err }, 'Failed to restore WhatsApp session');
    });
  }

  if (uids.length > 0) {
    logger.info({ count: uids.length }, 'Sessions restored');
  }
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started');
  console.log(`\n  Omi WhatsApp Integration`);
  console.log(`  ========================`);
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Setup page:    http://localhost:${PORT}/setup?uid=test`);
  console.log(`  Setup status:  http://localhost:${PORT}/setup/status?uid=test`);
  console.log(`  Memory hook:   POST http://localhost:${PORT}/webhook/memory?uid=test`);
  console.log('');

  // Restore sessions after server is listening
  restoreSessions();

  // Start the reminder tick loop
  startReminderTick();
});
