/**
 * WhatsApp session state types for Baileys integration.
 */

import type { WASocket } from '@whiskeysockets/baileys';

/** Tracks a single user's WhatsApp connection */
export interface WhatsAppSession {
  socket: WASocket;
  /** Whether the socket is fully connected and authenticated */
  connected: boolean;
  /** Latest QR code string (undefined after successful auth) */
  qr?: string;
  /** The user's own JID (e.g. "1234567890@s.whatsapp.net"), set after connection */
  userJid?: string;
}

/** Callback for QR / connection status updates pushed to the setup page via SSE */
export type SessionEventCallback = (event: SessionEvent) => void;

export type SessionEvent =
  | { type: 'qr'; data: string }
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string };
