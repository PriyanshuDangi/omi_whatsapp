/**
 * Reminder service — scheduled reminders sent via WhatsApp.
 * Reminders are persisted to data/reminders.json so they survive restarts.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { isConnected, sendSelfMessage, sendMessage } from './whatsapp.js';

const DATA_DIR = 'data';
const REMINDERS_FILE = path.join(DATA_DIR, 'reminders.json');

interface Reminder {
  id: string;
  uid: string;
  message: string;
  /** JID to send to, or 'self' for self-message. */
  target: string;
  targetName: string;
  fireAt: number; // epoch ms
}

/** All pending reminders. */
const reminders: Reminder[] = [];

let nextId = 1;

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/** Ensure data/ directory exists. */
function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Write all pending reminders to disk. */
function saveReminders(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2), 'utf-8');
    logger.info({ count: reminders.length }, 'Reminders saved to disk');
  } catch (err) {
    logger.error({ err }, 'Failed to save reminders to disk');
  }
}

/** Load reminders from disk on startup. */
function loadReminders(): void {
  if (!fs.existsSync(REMINDERS_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8')) as Reminder[];
    const now = Date.now();
    // Only load reminders that haven't expired yet
    for (const r of data) {
      if (r.fireAt > now) {
        reminders.push(r);
      }
    }
    // Set nextId to max existing id + 1
    const maxId = data.reduce((max, r) => {
      const num = parseInt(r.id.replace('r_', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);
    nextId = maxId + 1;

    logger.info({ loaded: reminders.length, skippedExpired: data.length - reminders.length }, 'Reminders loaded from disk');
    // Save back to prune expired entries
    if (data.length !== reminders.length) {
      saveReminders();
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load reminders from disk');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule a new reminder.
 * Returns the reminder id.
 */
export function scheduleReminder(
  uid: string,
  message: string,
  delayMinutes: number,
  target: string,
  targetName: string,
): string {
  const id = `r_${nextId++}`;
  const fireAt = Date.now() + delayMinutes * 60_000;

  reminders.push({ id, uid, message, target, targetName, fireAt });
  logger.info({ id, uid, delayMinutes, target: targetName }, 'Reminder scheduled');
  saveReminders();
  return id;
}

/**
 * Fire all due reminders. Called by the tick interval.
 */
async function fireDueReminders(): Promise<void> {
  const now = Date.now();
  // Find all reminders that are due
  const due = reminders.filter((r) => r.fireAt <= now);

  for (const reminder of due) {
    // Remove from the list
    const idx = reminders.indexOf(reminder);
    if (idx !== -1) reminders.splice(idx, 1);

    if (!isConnected(reminder.uid)) {
      logger.warn({ uid: reminder.uid, id: reminder.id }, 'Reminder skipped — WhatsApp not connected');
      continue;
    }

    const text = `⏰ *Reminder from Omi*\n\n${reminder.message}`;

    try {
      if (reminder.target === 'self') {
        await sendSelfMessage(reminder.uid, text);
      } else {
        await sendMessage(reminder.uid, reminder.target, text);
      }
      logger.info({ uid: reminder.uid, id: reminder.id, target: reminder.targetName }, 'Reminder fired');
    } catch (err) {
      logger.error({ uid: reminder.uid, id: reminder.id, err }, 'Failed to fire reminder');
    }
  }

  // Persist after firing (removals)
  if (due.length > 0) {
    saveReminders();
  }
}

/** Start the reminder tick loop. Call once on server startup. */
export function startReminderTick(intervalMs = 15_000): void {
  loadReminders();
  setInterval(() => {
    fireDueReminders().catch((err) => {
      logger.error({ err }, 'Reminder tick error');
    });
  }, intervalMs);
  logger.info({ intervalMs }, 'Reminder tick started');
}
