/**
 * Contacts routes — user-managed saved contacts CRUD.
 *
 * POST /contacts/save?uid=...   → Save a contact (name + phone with country code)
 * GET  /contacts?uid=...        → List all saved contacts
 * DELETE /contacts?uid=...      → Delete a saved contact by JID or phone
 */

import { Router } from 'express';
import { logger } from '../utils/logger.js';
import { isConnected, checkWhatsAppNumber } from '../services/whatsapp.js';
import { getSavedContacts, saveContact, deleteContact } from '../services/saved-contacts.js';

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export const contactsRouter = Router();

// ---------------------------------------------------------------------------
// POST /contacts/save
// ---------------------------------------------------------------------------
contactsRouter.post('/save', async (req, res) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  const name = req.body?.name?.trim();
  const phone = req.body?.phone?.trim();

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!name) {
    res.status(400).json({ error: 'Missing required parameter: name' });
    return;
  }
  if (!phone) {
    res.status(400).json({ error: 'Missing required parameter: phone (with country code, e.g. +14155551234)' });
    return;
  }

  const normalized = phone.replace(/[\s\-()]/g, '');
  if (!E164_REGEX.test(normalized)) {
    res.status(400).json({
      error: 'Invalid phone number format. Use E.164 with country code (e.g. +14155551234, +919876543210).',
    });
    return;
  }

  if (!isConnected(uid)) {
    res.status(401).json({
      error: 'WhatsApp not connected. Please link your WhatsApp account first.',
    });
    return;
  }

  logger.info({ uid, name, phone: normalized }, 'Save contact request');

  try {
    const check = await checkWhatsAppNumber(uid, normalized);
    if (!check.exists || !check.jid) {
      res.status(404).json({
        error: `The number ${normalized} is not registered on WhatsApp. Please check and try again.`,
      });
      return;
    }

    const contact = saveContact(uid, name, check.jid);
    res.json({ result: `Contact "${name}" saved successfully.`, contact });
  } catch (err) {
    logger.error({ uid, name, phone: normalized, err }, 'Failed to save contact');
    res.status(500).json({ error: 'Failed to save contact. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /contacts
// ---------------------------------------------------------------------------
contactsRouter.get('/', (req, res) => {
  const uid = (req.query.uid as string);

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }

  const saved = getSavedContacts(uid);
  const contacts = Array.from(saved.values()).map((c) => ({
    jid: c.id,
    name: c.name,
    phone: '+' + c.id.replace('@s.whatsapp.net', ''),
    addedAt: c.addedAt,
    updatedAt: c.updatedAt,
  }));

  res.json({ contacts });
});

// ---------------------------------------------------------------------------
// DELETE /contacts
// ---------------------------------------------------------------------------
contactsRouter.delete('/', (req, res) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  const phone: string | undefined = req.body?.phone?.trim();
  const jid: string | undefined = req.body?.jid?.trim();

  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }
  if (!phone && !jid) {
    res.status(400).json({ error: 'Missing required parameter: phone or jid' });
    return;
  }

  let targetJid = jid;
  if (!targetJid && phone) {
    const stripped = phone.replace(/[^0-9]/g, '');
    targetJid = `${stripped}@s.whatsapp.net`;
  }

  const deleted = deleteContact(uid, targetJid!);
  if (!deleted) {
    res.status(404).json({ error: 'Contact not found in saved contacts.' });
    return;
  }

  res.json({ result: 'Contact deleted successfully.' });
});
