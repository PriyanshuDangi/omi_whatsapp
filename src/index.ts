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
import { initSession, getContacts } from './services/whatsapp.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Parse JSON bodies (Omi webhook payloads)
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Debug: list contacts for a uid
app.get('/debug/contacts', (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) { res.status(400).json({ error: 'Missing uid' }); return; }
  const contacts = getContacts(uid);
  const list = Array.from(contacts.entries()).map(([jid, c]) => ({
    jid,
    name: c.name,
    notify: c.notify,
    verifiedName: c.verifiedName,
  }));
  res.json({ count: list.length, contacts: list });
});

// Mount routes
app.use('/setup', setupRouter);
app.use('/webhook', webhookRouter);

// Auto-restore existing WhatsApp sessions from filesystem on startup
function restoreSessions(): void {
  const sessionsDir = 'sessions';
  if (!fs.existsSync(sessionsDir)) return;

  const uids = fs.readdirSync(sessionsDir).filter((entry) => {
    return fs.statSync(path.join(sessionsDir, entry)).isDirectory();
  });

  for (const uid of uids) {
    console.log(`  Restoring WhatsApp session for uid: ${uid}`);
    initSession(uid).catch((err) => {
      logger.error({ uid, err }, 'Failed to restore WhatsApp session');
    });
  }

  if (uids.length > 0) {
    console.log(`  Restored ${uids.length} session(s)`);
  }
}

// Start server
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server started');
  console.log(`\n  Omi WhatsApp Integration`);
  console.log(`  ========================`);
  console.log(`  Server running on http://localhost:${PORT}`);
  console.log(`  Setup page:    http://localhost:${PORT}/setup?uid=test`);
  console.log(`  Setup status:  http://localhost:${PORT}/setup/status?uid=test`);
  console.log(`  Memory hook:   POST http://localhost:${PORT}/webhook/memory?uid=test`);
  console.log(`  Realtime hook: POST http://localhost:${PORT}/webhook/realtime?uid=test&session_id=s1`);
  console.log(`\n  Tip: Use ngrok to expose this to Omi webhooks:`);
  console.log(`  ngrok http ${PORT}\n`);

  // Restore sessions after server is listening
  restoreSessions();
});
