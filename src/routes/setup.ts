/**
 * Setup routes — QR code page, SSE events, setup status, logout, and history sync.
 *
 * GET  /setup?uid=...            → Serve the HTML setup page
 * GET  /setup/status?uid=...     → Return { is_setup_completed: boolean } for Omi
 * GET  /setup/events?uid=...     → SSE stream pushing QR codes and connection status
 * POST /setup/logout?uid=...     → Log out WhatsApp session and clean up auth state
 * POST /setup/sync-history?uid=… → Trigger on-demand history sync for contact enrichment
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as QRCode from 'qrcode';
import { initSession, isConnected, subscribe, requestHistorySync, logoutSession } from '../services/whatsapp.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const setupRouter = Router();

/**
 * GET /setup?uid=...
 * Serves the setup HTML page. Kicks off a Baileys session for the uid.
 */
setupRouter.get('/', async (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  // Start session in background (don't await full connection)
  initSession(uid).catch((err) => {
    logger.error({ uid, err }, 'Failed to init WhatsApp session');
  });

  // Serve the HTML page
  const htmlPath = path.resolve(__dirname, '..', 'views', 'setup.html');
  res.sendFile(htmlPath);
});

/**
 * GET /setup/status?uid=...
 * Returns { is_setup_completed: boolean } — polled by Omi to check if WhatsApp is linked.
 */
setupRouter.get('/status', (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  res.json({ is_setup_completed: isConnected(uid) });
});

/**
 * GET /setup/events?uid=...
 * SSE endpoint. Pushes QR code data URLs and connection status to the browser.
 */
setupRouter.get('/events', (req, res) => {
  const uid = req.query.uid as string;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid query parameter' });
    return;
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Subscribe to session events for this uid
  const unsubscribe = subscribe(uid, async (event) => {
    try {
      if (event.type === 'qr') {
        // Convert QR string to data URL for display in <img>
        const dataUrl = await QRCode.toDataURL(event.data, { width: 300, margin: 2 });
        res.write(`event: qr\ndata: ${dataUrl}\n\n`);
      } else if (event.type === 'connected') {
        res.write(`event: connected\ndata: ok\n\n`);
      } else if (event.type === 'disconnected') {
        res.write(`event: disconnected\ndata: ${event.reason || 'unknown'}\n\n`);
      }
    } catch (err) {
      logger.error({ uid, err }, 'Error writing SSE event');
    }
  });

  // Clean up on client disconnect
  req.on('close', () => {
    unsubscribe();
  });
});

/**
 * POST /setup/logout?uid=...
 * Logs out the WhatsApp session, removes auth state, and notifies SSE listeners.
 */
setupRouter.post('/logout', async (req, res) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }

  try {
    await logoutSession(uid);
    res.json({ result: 'WhatsApp session logged out.' });
  } catch (err) {
    logger.error({ uid, err }, 'Failed to logout WhatsApp session');
    res.status(500).json({ error: 'Failed to logout. Please try again.' });
  }
});

/**
 * POST /setup/sync-history?uid=...
 * Triggers on-demand history sync from the main WhatsApp device.
 * Results arrive asynchronously via the messaging-history.set event
 * and automatically enrich the contact store.
 */
setupRouter.post('/sync-history', async (req, res) => {
  const uid = (req.query.uid as string) || req.body?.uid;
  if (!uid) {
    res.status(400).json({ error: 'Missing uid parameter' });
    return;
  }

  if (!isConnected(uid)) {
    res.status(401).json({ error: 'WhatsApp not connected. Please link your WhatsApp account first.' });
    return;
  }

  const count = parseInt(req.body?.count ?? '50', 10);

  try {
    await requestHistorySync(uid, count);
    res.json({ result: 'History sync requested. Contacts will be updated as data arrives.' });
  } catch (err) {
    logger.error({ uid, err }, 'Failed to request history sync');
    res.status(500).json({ error: 'Failed to request history sync. Please try again.' });
  }
});
