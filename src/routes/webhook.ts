/**
 * Webhook routes — receive Omi memory payloads.
 *
 * POST /webhook/memory?uid=... → Format recap → send WhatsApp self-message
 */

import { Router } from 'express';
import { logger } from '../utils/logger.js';
import type { OmiMemory } from '../types/omi.js';
import { formatMemoryRecap } from '../services/formatter.js';
import {
  isConnected,
  sendSelfMessage,
} from '../services/whatsapp.js';

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// POST /webhook/memory?uid=...
// ---------------------------------------------------------------------------
webhookRouter.post('/memory', (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  // Return 200 immediately so Omi doesn't timeout
  res.status(200).json({ status: 'ok' });

  // Process asynchronously
  const memory = req.body as OmiMemory;

  logger.info({ uid }, 'Memory webhook received');
  logger.info({ uid, body: req.body }, 'Memory webhook raw body');

  // Skip discarded or empty memories
  if (memory.discarded) {
    logger.info({ uid, memoryId: memory.id }, 'Skipping discarded memory');
    return;
  }

  const recap = formatMemoryRecap(memory);
  if (!recap) {
    logger.info({ uid, memoryId: memory.id, structured: memory.structured }, 'Skipping memory — no formatted recap');
    return;
  }

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'WhatsApp not connected — cannot send recap');
    return;
  }

  sendSelfMessage(uid, recap).catch((err) => {
    logger.error({ uid, err }, 'Failed to send WhatsApp recap');
  });
});
