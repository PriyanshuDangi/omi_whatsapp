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
  waitForContacts,
} from '../services/whatsapp.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// Dedup state for real-time transcript processing.
// Tracks processed segment start times per session to avoid re-triggering commands.
// Map<session_id, Set<segment_start_time>>
// ---------------------------------------------------------------------------
const processedSegments = new Map<string, Set<string>>();

// Accumulated full text per session for cross-fragment command detection.
// Map<session_id, string>
const sessionText = new Map<string, string>();

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
  sessionText.clear();
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

  logger.debug({ uid }, 'Memory webhook received');
  logger.debug({ uid, body: req.body }, 'Memory webhook raw body');

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

// ---------------------------------------------------------------------------
// POST /webhook/realtime?uid=...&session_id=...
// ---------------------------------------------------------------------------
webhookRouter.post('/realtime', (req, res) => {
  const uid = req.query.uid as string;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  // Return 200 immediately
  res.status(200).json({ status: 'ok' });

  // Omi sends either:
  //   1. A flat array of TranscriptSegment[] (with session_id as query param)
  //   2. An object { session_id, segments: TranscriptSegment[] }
  const body = req.body;
  let segments: TranscriptSegment[];
  let sessionId: string;

  if (Array.isArray(body)) {
    segments = body;
    sessionId = req.query.session_id as string;
  } else if (body && Array.isArray(body.segments)) {
    segments = body.segments;
    sessionId = body.session_id || (req.query.session_id as string);
  } else {
    logger.debug({ uid, body }, 'Realtime webhook unexpected body format');
    return;
  }

  logger.debug({ uid, sessionId, segmentCount: segments.length }, 'Realtime webhook received');
  for (const seg of segments) {
    logger.debug({ speaker: seg.speaker, text: seg.text }, 'Realtime segment');
  }

  if (segments.length === 0) return;

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
  if (!sessionText.has(sessionId)) {
    sessionText.set(sessionId, '');
  }

  const seen = processedSegments.get(sessionId)!;
  const sentCommands = processedCommands.get(sessionId)!;

  // Filter to only new segments (dedup by segment id or text+start combo)
  const newSegments = segments.filter((seg) => {
    const key = seg.id || `${seg.start}:${seg.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (newSegments.length === 0) return;

  // Strategy: try each new segment individually first, then try the
  // short rolling window (last partial + new text) for fragmented speech.
  const prevPartial = sessionText.get(sessionId)!;
  const newText = newSegments.map((s) => s.text).join(' ');

  // Candidates to parse: (1) each segment alone, (2) partial + new text combined
  const candidates: string[] = [
    ...newSegments.map((s) => s.text),
    prevPartial ? prevPartial + ' ' + newText : '',
  ].filter(Boolean);

  let command = null;
  for (const candidate of candidates) {
    command = parseCommand(candidate);
    if (command) break;
  }

  if (!command) {
    // No command found — store new text as partial for next call (keep only last chunk)
    sessionText.set(sessionId, newText);
    return;
  }

  // Command found — clear partial buffer
  sessionText.set(sessionId, '');

  logger.debug({ uid, command }, 'Realtime command detected');

  // Dedup: avoid re-sending the same command in this session
  const commandKey = `${command.name.toLowerCase()}:${command.content.toLowerCase()}`;
  if (sentCommands.has(commandKey)) {
    logger.debug({ uid, commandKey }, 'Command already processed — skipping');
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
/** Wait for WhatsApp to connect, retrying a few times. */
async function waitForConnection(uid: string, retries = 5, delayMs = 2000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (isConnected(uid)) return true;
    logger.debug({ uid, attempt: i + 1, retries }, 'WhatsApp not connected yet, waiting');
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return isConnected(uid);
}

async function processVoiceCommand(
  uid: string,
  name: string,
  content: string
): Promise<void> {
  logger.info({ uid, name, content }, 'Processing voice command');

  // Wait up to 10s for WhatsApp to connect (handles server restart race)
  const connected = await waitForConnection(uid);
  if (!connected) {
    logger.warn({ uid }, 'WhatsApp not connected — cannot send message');
    await sendNotification(uid, 'WhatsApp is not connected. Please link your account first.');
    return;
  }

  if (!content.trim()) {
    await sendNotification(uid, 'No message content detected');
    return;
  }

  // Wait for contacts to sync (they arrive after history sync, which can take 20s+)
  const hasCtx = await waitForContacts(uid);
  if (!hasCtx) {
    logger.debug({ uid }, 'No contacts synced — cannot look up name');
  }

  const contacts = getContacts(uid);

  logger.debug({ uid, name, contactCount: contacts.size }, 'Looking up contact for voice command');

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
