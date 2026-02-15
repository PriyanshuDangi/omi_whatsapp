/**
 * Chat Tools routes — Omi chat tool manifest and tool endpoints.
 *
 * GET  /.well-known/omi-tools.json    → Tool manifest for Omi to discover available tools
 * POST /tools/send_message            → Send a WhatsApp message to a contact
 * POST /tools/send_meeting_notes      → Send meeting notes to self on WhatsApp
 * POST /tools/send_recap_to_contact   → Send meeting recap to a specific contact
 *
 * These endpoints follow the Omi Chat Tools spec:
 * https://docs.omi.me/doc/developer/apps/ChatTools
 */

import { Router } from 'express';
import pino from 'pino';
import { findContact } from '../services/contact-matcher.js';
import {
  isConnected,
  sendSelfMessage,
  sendMessage,
  getContacts,
  waitForContacts,
} from '../services/whatsapp.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

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
          'Send a WhatsApp message to a contact. Use this when the user wants to send a message, text, or WhatsApp someone. Examples: "Send a WhatsApp message to John saying hi", "Text Mom that I\'ll be late", "Message Sarah asking about dinner plans".',
        endpoint: `${baseUrl}/tools/send_message`,
        method: 'POST',
        parameters: {
          properties: {
            contact_name: {
              type: 'string',
              description: 'The name of the contact to send the message to (e.g., "John", "Mom", "Sarah")',
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
          'Send meeting notes, conversation recap, or summary to a specific WhatsApp contact. Use this when the user says "send the meeting notes to John on WhatsApp", "share the recap with Sarah", "forward the summary to Mom on WhatsApp", or "send today\'s notes to my manager".',
        endpoint: `${baseUrl}/tools/send_recap_to_contact`,
        method: 'POST',
        parameters: {
          properties: {
            contact_name: {
              type: 'string',
              description: 'The name of the contact to send the recap to (e.g., "John", "Mom", "Sarah")',
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
    ],
  };
}

export const manifestRouter = Router();
export const toolsRouter = Router();

// ---------------------------------------------------------------------------
// GET /.well-known/omi-tools.json
// ---------------------------------------------------------------------------
manifestRouter.get('/omi-tools.json', (req, res) => {
  // Use NGROK_URL if set, otherwise derive from the request
  const baseUrl = process.env.NGROK_URL || `${req.protocol}://${req.get('host')}`;
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

  if (!isConnected(uid)) {
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  // Wait for contacts to be available
  const hasCtx = await waitForContacts(uid, 5, 1000);
  if (!hasCtx) {
    res.status(500).json({ error: 'Contacts not synced yet. Please try again in a moment.' });
    return;
  }

  const contacts = getContacts(uid);
  const match = findContact(contacts, contactName);

  if (!match) {
    res.status(404).json({ error: `Could not find a WhatsApp contact named "${contactName}". Check the spelling or use their saved name.` });
    return;
  }

  try {
    await sendMessage(uid, match.jid, message);
    logger.info({ uid, contact: match.displayName, jid: match.jid }, 'Chat tool: message sent');
    res.json({ result: `Message sent to ${match.displayName} on WhatsApp.` });
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

  if (!isConnected(uid)) {
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

  if (!isConnected(uid)) {
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first in the app setup.',
    });
    return;
  }

  // Wait for contacts to be available
  const hasCtx = await waitForContacts(uid, 5, 1000);
  if (!hasCtx) {
    res.status(500).json({ error: 'Contacts not synced yet. Please try again in a moment.' });
    return;
  }

  const contacts = getContacts(uid);
  const match = findContact(contacts, contactName);

  if (!match) {
    res.status(404).json({ error: `Could not find a WhatsApp contact named "${contactName}". Check the spelling or use their saved name.` });
    return;
  }

  try {
    const formatted = `📋 *Meeting Notes from Omi*\n\n${summary}`;
    await sendMessage(uid, match.jid, formatted);
    logger.info({ uid, contact: match.displayName, jid: match.jid }, 'Chat tool: recap sent to contact');
    res.json({ result: `Meeting recap sent to ${match.displayName} on WhatsApp.` });
  } catch (err) {
    logger.error({ uid, contactName, err }, 'Chat tool: failed to send recap to contact');
    res.status(500).json({ error: `Failed to send recap to ${match.displayName}. Please try again.` });
  }
});
