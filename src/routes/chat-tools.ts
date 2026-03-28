/**
 * Chat Tools routes — Omi chat tool manifest and tool endpoints.
 *
 * GET  /.well-known/omi-tools.json    → Tool manifest for Omi to discover available tools
 * POST /tools/send_message            → Send a WhatsApp message to a contact
 * POST /tools/send_meeting_notes      → Send meeting notes to self on WhatsApp
 * POST /tools/send_recap_to_contact   → Send meeting recap to a specific contact
 * POST /tools/set_reminder            → Set a timed WhatsApp reminder (self or contact)
 * POST /tools/save_contact            → Save a WhatsApp contact by name + phone number
 *
 * These endpoints follow the Omi Chat Tools spec:
 * https://docs.omi.me/doc/developer/apps/ChatTools
 */

import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { findRecipient } from '../services/contact-matcher.js';
import { scheduleReminder } from '../services/reminder.js';
import { getSavedContacts, saveContact } from '../services/saved-contacts.js';
import {
  isConnected,
  sendSelfMessage,
  sendMessage,
  getContacts,
  getGroups,
  waitForRecipientContext,
  checkWhatsAppNumber,
} from '../services/whatsapp.js';

const RECIPIENT_NOT_FOUND_HINT = 'If this is a person, you can save this contact by saying: "Save contact NAME with number +COUNTRYCODE_NUMBER"';
const E164_REGEX = /^\+[1-9]\d{6,14}$/;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Build the manifest with absolute endpoint URLs based on the incoming request. */
function buildManifest(baseUrl: string) {
  return {
    tools: [
      {
        name: 'send_whatsapp_message',
        description:
          'Send a WhatsApp message to a contact or group. Use this when the user wants to send a message, text, or WhatsApp someone or a group. Examples: "Send a WhatsApp message to John saying hi", "Text Mom that I\'ll be late", "Message the family group that I am running late".',
        endpoint: `${baseUrl}/tools/send_message`,
        method: 'POST',
        parameters: {
          properties: {
            contact_name: {
              type: 'string',
              description: 'The name of the WhatsApp contact or group to send the message to (e.g., "John", "Mom", "Family Group")',
            },
            message: {
              type: 'string',
              description: 'The message text to send',
            },
          },
          required: ['contact_name', 'message'],
        },
        auth_required: true,
        status_message: 'Sending WhatsApp message...',
      },
      {
        name: 'send_meeting_notes',
        description:
          'Send the latest meeting notes or conversation summary to the user\'s own WhatsApp. Use this when the user says "send me the meeting notes on WhatsApp", "WhatsApp me the summary", or "send the recap to my WhatsApp".',
        endpoint: `${baseUrl}/tools/send_meeting_notes`,
        method: 'POST',
        parameters: {
          properties: {
            summary: {
              type: 'string',
              description: 'The meeting notes or conversation summary text to send',
            },
          },
          required: ['summary'],
        },
        auth_required: true,
        status_message: 'Sending meeting notes to WhatsApp...',
      },
      {
        name: 'send_recap_to_contact',
        description:
          'Send meeting notes, conversation recap, or summary to a specific WhatsApp contact or group. Use this when the user says "send the meeting notes to John on WhatsApp", "share the recap with Sarah", "forward the summary to Mom on WhatsApp", or "send today\'s notes to the team group".',
        endpoint: `${baseUrl}/tools/send_recap_to_contact`,
        method: 'POST',
        parameters: {
          properties: {
            contact_name: {
              type: 'string',
              description: 'The name of the WhatsApp contact or group to send the recap to (e.g., "John", "Mom", "Family Group")',
            },
            summary: {
              type: 'string',
              description: 'The meeting notes or conversation summary text to send',
            },
          },
          required: ['contact_name', 'summary'],
        },
        auth_required: true,
        status_message: 'Sending recap to contact on WhatsApp...',
      },
      {
        name: 'set_whatsapp_reminder',
        description:
          'Set a timed reminder that will be sent as a WhatsApp message. If no contact name is provided, the reminder is sent to the user themselves. The optional target can be a contact or group. Use this when the user says "remind me in 30 minutes to call the dentist", "set a reminder for 1 hour to check email", or "remind the family group in 10 minutes".',
        endpoint: `${baseUrl}/tools/set_reminder`,
        method: 'POST',
        parameters: {
          properties: {
            message: {
              type: 'string',
              description: 'The reminder message text (e.g., "Call the dentist", "Check email")',
            },
            delay_minutes: {
              type: 'integer',
              description: 'How many minutes from now to send the reminder (e.g., 5, 15, 30, 60)',
            },
            contact_name: {
              type: 'string',
              description: 'Optional: name of the contact or group to send the reminder to. If not provided, reminder is sent to the user themselves.',
            },
          },
          required: ['message', 'delay_minutes'],
        },
        auth_required: true,
        status_message: 'Setting reminder...',
      },
      {
        name: 'save_whatsapp_contact',
        description:
          'Save a WhatsApp contact with a name and phone number (with country code). Use this when the user says "Save +919876543210 as Rajesh", "Add contact Mom with number +14155551234", or "Save this number as John". Also use this when a previous message failed because a contact was not found and the user provides the number.',
        endpoint: `${baseUrl}/tools/save_contact`,
        method: 'POST',
        parameters: {
          properties: {
            contact_name: {
              type: 'string',
              description: 'The name to save the contact as (e.g., "Rajesh", "Mom", "John")',
            },
            phone_number: {
              type: 'string',
              description: 'The phone number with country code (e.g., "+919876543210", "+14155551234")',
            },
          },
          required: ['contact_name', 'phone_number'],
        },
        auth_required: true,
        status_message: 'Saving contact...',
      },
    ],
  };
}

export const manifestRouter = Router();
export const toolsRouter = Router();

function isGroupAnnouncementsOnly(uid: string, jid: string): boolean {
  const group = getGroups(uid).get(jid);
  return group?.announce === true;
}

// ---------------------------------------------------------------------------
// GET /.well-known/omi-tools.json
// ---------------------------------------------------------------------------
manifestRouter.get('/omi-tools.json', (req, res) => {
  // Use BASE_URL if set, otherwise derive from the request
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json(buildManifest(baseUrl));
});

// ---------------------------------------------------------------------------
// POST /tools/send_message
// ---------------------------------------------------------------------------
toolsRouter.post('/send_message', async (req, res) => {
  const data = req.body;

  const uid = data?.uid || (req.query.uid as string);
  const contactName = data?.contact_name;
  const message = data?.message;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!contactName) {
    res.status(400).json({ error: 'Missing required parameter: contact_name' });
    return;
  }
  if (!message) {
    res.status(400).json({ error: 'Missing required parameter: message' });
    return;
  }

  logger.info({ uid, contactName, messageLength: message.length }, 'Chat tool: send_message request received');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'Chat tool: send_message — WhatsApp not connected');
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  // Wait for contacts/groups to be available
  const hasCtx = await waitForRecipientContext(uid, 5, 1000);
  if (!hasCtx) {
    logger.warn({ uid }, 'Chat tool: send_message — contacts/groups not synced');
    res.status(500).json({ error: 'Contacts/groups not synced yet. Please try again in a moment.' });
    return;
  }

  const contacts = getContacts(uid);
  const groups = getGroups(uid);
  const saved = getSavedContacts(uid);
  const match = findRecipient(contacts, groups, contactName, saved);

  logger.info({
    uid,
    contactName,
    matched: match?.displayName ?? null,
    jid: match?.jid ?? null,
    isGroup: match?.isGroup ?? null,
  }, 'Chat tool: recipient match result');

  if (!match) {
    logger.warn({ uid, contactName }, 'Chat tool: send_message — recipient not found');
    res.status(404).json({ error: `Could not find a WhatsApp contact or group named "${contactName}". ${RECIPIENT_NOT_FOUND_HINT}` });
    return;
  }

  if (match.isGroup && isGroupAnnouncementsOnly(uid, match.jid)) {
    logger.warn({ uid, group: match.displayName, jid: match.jid }, 'Chat tool: send_message — group is announcements-only');
    res.status(403).json({ error: `Cannot send to "${match.displayName}" because only admins can post in that group.` });
    return;
  }

  try {
    await sendMessage(uid, match.jid, message);
    logger.info({ uid, recipient: match.displayName, jid: match.jid, isGroup: match.isGroup }, 'Chat tool: message sent');
    res.json({ result: `Message sent to ${match.isGroup ? `group "${match.displayName}"` : match.displayName} on WhatsApp.` });
  } catch (err) {
    logger.error({ uid, contactName, err }, 'Chat tool: failed to send message');
    res.status(500).json({ error: `Failed to send message to ${match.displayName}. Please try again.` });
  }
});

// ---------------------------------------------------------------------------
// POST /tools/send_meeting_notes
// ---------------------------------------------------------------------------
toolsRouter.post('/send_meeting_notes', async (req, res) => {
  const data = req.body;

  const uid = data?.uid || (req.query.uid as string);
  const summary = data?.summary;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!summary) {
    res.status(400).json({ error: 'Missing required parameter: summary' });
    return;
  }

  logger.info({ uid, summaryLength: summary.length }, 'Chat tool: send_meeting_notes request received');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'Chat tool: send_meeting_notes — WhatsApp not connected');
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  try {
    const formatted = `📋 *Meeting Notes from Omi*\n\n${summary}`;
    await sendSelfMessage(uid, formatted);
    logger.info({ uid }, 'Chat tool: meeting notes sent to self');
    res.json({ result: 'Meeting notes sent to your WhatsApp.' });
  } catch (err) {
    logger.error({ uid, err }, 'Chat tool: failed to send meeting notes');
    res.status(500).json({ error: 'Failed to send meeting notes. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// POST /tools/send_recap_to_contact
// ---------------------------------------------------------------------------
toolsRouter.post('/send_recap_to_contact', async (req, res) => {
  const data = req.body;

  const uid = data?.uid || (req.query.uid as string);
  const contactName = data?.contact_name;
  const summary = data?.summary;

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!contactName) {
    res.status(400).json({ error: 'Missing required parameter: contact_name' });
    return;
  }
  if (!summary) {
    res.status(400).json({ error: 'Missing required parameter: summary' });
    return;
  }

  logger.info({ uid, contactName, summaryLength: summary.length }, 'Chat tool: send_recap_to_contact request received');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'Chat tool: send_recap_to_contact — WhatsApp not connected');
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  // Wait for contacts/groups to be available
  const hasCtx = await waitForRecipientContext(uid, 5, 1000);
  if (!hasCtx) {
    logger.warn({ uid }, 'Chat tool: send_recap_to_contact — contacts/groups not synced');
    res.status(500).json({ error: 'Contacts/groups not synced yet. Please try again in a moment.' });
    return;
  }

  const contacts = getContacts(uid);
  const groups = getGroups(uid);
  const saved = getSavedContacts(uid);
  const match = findRecipient(contacts, groups, contactName, saved);

  logger.info({
    uid,
    contactName,
    matched: match?.displayName ?? null,
    jid: match?.jid ?? null,
    isGroup: match?.isGroup ?? null,
  }, 'Chat tool: recipient match result');

  if (!match) {
    logger.warn({ uid, contactName }, 'Chat tool: send_recap_to_contact — recipient not found');
    res.status(404).json({ error: `Could not find a WhatsApp contact or group named "${contactName}". ${RECIPIENT_NOT_FOUND_HINT}` });
    return;
  }

  if (match.isGroup && isGroupAnnouncementsOnly(uid, match.jid)) {
    logger.warn({ uid, group: match.displayName, jid: match.jid }, 'Chat tool: send_recap_to_contact — group is announcements-only');
    res.status(403).json({ error: `Cannot send to "${match.displayName}" because only admins can post in that group.` });
    return;
  }

  try {
    const formatted = `📋 *Meeting Notes from Omi*\n\n${summary}`;
    await sendMessage(uid, match.jid, formatted);
    logger.info({ uid, recipient: match.displayName, jid: match.jid, isGroup: match.isGroup }, 'Chat tool: recap sent');
    res.json({ result: `Meeting recap sent to ${match.isGroup ? `group "${match.displayName}"` : match.displayName} on WhatsApp.` });
  } catch (err) {
    logger.error({ uid, contactName, err }, 'Chat tool: failed to send recap to contact');
    res.status(500).json({ error: `Failed to send recap to ${match.displayName}. Please try again.` });
  }
});

// ---------------------------------------------------------------------------
// POST /tools/set_reminder
// ---------------------------------------------------------------------------
toolsRouter.post('/set_reminder', async (req, res) => {
  const data = req.body;

  const uid = data?.uid || (req.query.uid as string);
  const message = data?.message;
  const delayMinutes = data?.delay_minutes;
  const contactName = data?.contact_name; // optional

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!message) {
    res.status(400).json({ error: 'Missing required parameter: message' });
    return;
  }
  if (!delayMinutes || delayMinutes < 1) {
    res.status(400).json({ error: 'Missing or invalid delay_minutes (must be >= 1)' });
    return;
  }

  logger.info({ uid, messageLength: message.length, delayMinutes, contactName: contactName ?? null }, 'Chat tool: set_reminder request received');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'Chat tool: set_reminder — WhatsApp not connected');
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  // Resolve target: self or a specific contact
  let target = 'self';
  let targetName = 'yourself';

  if (contactName) {
    const hasCtx = await waitForRecipientContext(uid, 5, 1000);
    if (!hasCtx) {
      logger.warn({ uid }, 'Chat tool: set_reminder — contacts/groups not synced');
      res.status(500).json({ error: 'Contacts/groups not synced yet. Please try again in a moment.' });
      return;
    }

    const contacts = getContacts(uid);
    const groups = getGroups(uid);
    const saved = getSavedContacts(uid);
    const match = findRecipient(contacts, groups, contactName, saved);

    logger.info({
      uid,
      contactName,
      matched: match?.displayName ?? null,
      jid: match?.jid ?? null,
      isGroup: match?.isGroup ?? null,
    }, 'Chat tool: recipient match result');

    if (!match) {
      logger.warn({ uid, contactName }, 'Chat tool: set_reminder — recipient not found');
      res.status(404).json({ error: `Could not find a WhatsApp contact or group named "${contactName}". ${RECIPIENT_NOT_FOUND_HINT}` });
      return;
    }

    if (match.isGroup && isGroupAnnouncementsOnly(uid, match.jid)) {
      logger.warn({ uid, group: match.displayName, jid: match.jid }, 'Chat tool: set_reminder — group is announcements-only');
      res.status(403).json({ error: `Cannot send to "${match.displayName}" because only admins can post in that group.` });
      return;
    }

    target = match.jid;
    targetName = match.isGroup ? `group "${match.displayName}"` : match.displayName;
  }

  scheduleReminder(uid, message, delayMinutes, target, targetName);

  // Send a confirmation to the user's own WhatsApp
  const timeLabel = delayMinutes >= 60
    ? `${Math.floor(delayMinutes / 60)}h ${delayMinutes % 60 > 0 ? `${delayMinutes % 60}m` : ''}`
    : `${delayMinutes} min`;
  const confirmText = contactName
    ? `✅ *Reminder set*\n\n"${message}"\n→ To: ${targetName}\n⏰ In ${timeLabel}`
    : `✅ *Reminder set*\n\n"${message}"\n⏰ In ${timeLabel}`;

  sendSelfMessage(uid, confirmText).catch((err) => {
    logger.error({ uid, err }, 'Failed to send reminder confirmation');
  });

  res.json({ result: `Reminder set! "${message}" will be sent to ${targetName} in ${timeLabel}.` });
});

// ---------------------------------------------------------------------------
// POST /tools/save_contact
// ---------------------------------------------------------------------------
toolsRouter.post('/save_contact', async (req, res) => {
  const data = req.body;

  const uid = data?.uid || (req.query.uid as string);
  const contactName = data?.contact_name?.trim();
  const phoneNumber = data?.phone_number?.trim();

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!contactName) {
    res.status(400).json({ error: 'Missing required parameter: contact_name' });
    return;
  }
  if (!phoneNumber) {
    res.status(400).json({ error: 'Missing required parameter: phone_number (with country code, e.g. +14155551234)' });
    return;
  }

  const normalized = phoneNumber.replace(/[\s\-()]/g, '');
  if (!E164_REGEX.test(normalized)) {
    res.status(400).json({
      error: 'Invalid phone number format. Use the full number with country code (e.g. +14155551234, +919876543210).',
    });
    return;
  }

  logger.info({ uid, contactName, phone: normalized }, 'Chat tool: save_contact request received');

  if (!isConnected(uid)) {
    logger.warn({ uid }, 'Chat tool: save_contact — WhatsApp not connected');
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  try {
    const check = await checkWhatsAppNumber(uid, normalized);
    if (!check.exists || !check.jid) {
      res.status(404).json({
        error: `The number ${normalized} is not registered on WhatsApp. Please check the number and try again.`,
      });
      return;
    }

    const contact = saveContact(uid, contactName, check.jid, 'manual');
    logger.info({ uid, contactName, jid: check.jid }, 'Chat tool: contact saved');
    res.json({ result: `Contact "${contactName}" (${normalized}) saved successfully. You can now send messages to ${contactName} by name.` });
  } catch (err) {
    logger.error({ uid, contactName, phone: normalized, err }, 'Chat tool: failed to save contact');
    res.status(500).json({ error: 'Failed to save contact. Please try again.' });
  }
});
