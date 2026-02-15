/**
 * Webhook routes — receive Omi memory and real-time transcript payloads.
 *
 * POST /webhook/memory?uid=...                  → Format recap → send WhatsApp self-message
 * POST /webhook/realtime?uid=...&session_id=... → Detect voice commands → send WhatsApp message
 */

import { Router } from 'express';
import pino from 'pino';
import type { OmiMemory, TranscriptSegment } from '../types/omi.js';
import { formatMemoryRecap } from '../services/formatter.js';
import { parseCommand } from '../services/command-parser.js';
import { findContact } from '../services/contact-matcher.js';
import { sendNotification } from '../services/notification.js';
import {
  isConnected,
  sendSelfMessage,
  sendMessage,
  getContacts,
} from '../services/whatsapp.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// Dedup state for real-time transcript processing.
// Tracks processed segment start times per session to avoid re-triggering commands.
// Map<session_id, Set<segment_start_time>>
// ---------------------------------------------------------------------------
const processedSegments = new Map<string, Set<number>>();

// Tracks which commands have already been sent per session to avoid duplicates.
// Map<session_id, Set<"name:content_hash">>
const processedCommands = new Map<string, Set<string>>();

/** Clean up old session dedup data periodically (every 30 min). */
const SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  // Simple approach: clear all dedup state periodically.
  // For an MVP this is fine — sessions rarely last > 30 min.
  processedSegments.clear();
  processedCommands.clear();
  logger.debug('Cleared dedup state');
}, SESSION_TTL_MS);

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

  // Skip discarded or empty memories
  if (memory.discarded) {
    logger.info({ uid, memoryId: memory.id }, 'Skipping discarded memory');
    return;
  }

  const recap = formatMemoryRecap(memory);
  if (!recap) {
    logger.info({ uid, memoryId: memory.id }, 'Skipping memory — no formatted recap');
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

// ---------------------------------------------------------------------------
// POST /webhook/realtime?uid=...&session_id=...
// ---------------------------------------------------------------------------
webhookRouter.post('/realtime', (req, res) => {
  const uid = req.query.uid as string;
  const sessionId = req.query.session_id as string;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  // Return 200 immediately
  res.status(200).json({ status: 'ok' });

  const segments = req.body as TranscriptSegment[];
  if (!Array.isArray(segments) || segments.length === 0) return;

  if (!sessionId) {
    logger.warn({ uid }, 'Missing session_id — skipping realtime processing');
    return;
  }

  // Initialize dedup sets for this session
  if (!processedSegments.has(sessionId)) {
    processedSegments.set(sessionId, new Set());
  }
  if (!processedCommands.has(sessionId)) {
    processedCommands.set(sessionId, new Set());
  }

  const seen = processedSegments.get(sessionId)!;
  const sentCommands = processedCommands.get(sessionId)!;

  // Filter to only new segments
  const newSegments = segments.filter((seg) => {
    const key = seg.start;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (newSegments.length === 0) return;

  // Concatenate all new segment text and check for commands
  const fullText = newSegments.map((s) => s.text).join(' ');
  const command = parseCommand(fullText);

  if (!command) return;

  // Dedup: avoid re-sending the same command in this session
  const commandKey = `${command.name.toLowerCase()}:${command.content.toLowerCase()}`;
  if (sentCommands.has(commandKey)) {
    logger.debug({ uid, sessionId, commandKey }, 'Command already processed — skipping');
    return;
  }
  sentCommands.add(commandKey);

  // Process the command asynchronously
  processVoiceCommand(uid, command.name, command.content).catch((err) => {
    logger.error({ uid, err }, 'Failed to process voice command');
  });
});

/**
 * Process a detected voice command: find the contact and send the message.
 */
async function processVoiceCommand(
  uid: string,
  name: string,
  content: string
): Promise<void> {
  logger.info({ uid, name, content }, 'Processing voice command');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'WhatsApp not connected — cannot send message');
    await sendNotification(uid, 'WhatsApp is not connected. Please link your account first.');
    return;
  }

  if (!content.trim()) {
    await sendNotification(uid, 'No message content detected');
    return;
  }

  const contacts = getContacts(uid);
  const match = findContact(contacts, name);

  if (!match) {
    logger.warn({ uid, name }, 'Contact not found');
    await sendNotification(uid, `Could not find contact: ${name}`);
    return;
  }

  try {
    await sendMessage(uid, match.jid, content);
    await sendNotification(uid, `Message sent to ${match.displayName}`);
    logger.info({ uid, contact: match.displayName, jid: match.jid }, 'Voice command message sent');
  } catch (err) {
    logger.error({ uid, name, err }, 'Failed to send voice command message');
    await sendNotification(uid, `Failed to send message to ${match.displayName}`);
  }
}
