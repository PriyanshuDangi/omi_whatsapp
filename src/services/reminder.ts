/**
 * Reminder service — in-memory scheduled reminders sent via WhatsApp.
 * Reminders are lost on server restart (MVP, no database).
 */

import pino from 'pino';
import { isConnected, sendSelfMessage, sendMessage } from './whatsapp.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

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
      console.log(`[REMINDER] Fired: "${reminder.message}" → ${reminder.targetName}`);
    } catch (err) {
      logger.error({ uid: reminder.uid, id: reminder.id, err }, 'Failed to fire reminder');
    }
  }
}

/** Start the reminder tick loop. Call once on server startup. */
export function startReminderTick(intervalMs = 15_000): void {
  setInterval(() => {
    fireDueReminders().catch((err) => {
      logger.error({ err }, 'Reminder tick error');
    });
  }, intervalMs);
  console.log('  Reminder tick started (every 15s)');
}
