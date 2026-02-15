/**
 * Setup routes — QR code page, SSE events, and setup status for Omi polling.
 *
 * GET /setup?uid=...        → Serve the HTML setup page
 * GET /setup/status?uid=... → Return { is_setup_completed: boolean } for Omi
 * GET /setup/events?uid=... → SSE stream pushing QR codes and connection status
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as QRCode from 'qrcode';
import { initSession, isConnected, subscribe } from '../services/whatsapp.js';
import pino from 'pino';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

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
