/**
 * Entry point — Express server wiring routes and startup.
 * Single process: setup page, webhook receivers, WhatsApp via Baileys.
 */

import 'dotenv/config';
import express from 'express';
import pino from 'pino';
import { setupRouter } from './routes/setup.js';
import { webhookRouter } from './routes/webhook.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const PORT = parseInt(process.env.PORT || '3000', 10);

const app = express();

// Parse JSON bodies (Omi webhook payloads)
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Mount routes
app.use('/setup', setupRouter);
app.use('/webhook', webhookRouter);

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
});
