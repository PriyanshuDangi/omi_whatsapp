/**
 * Omi notification service — sends push notifications back to the user's Omi app.
 * Used to confirm "Message sent to John" or report "Contact not found: John".
 *
 * API: POST https://api.omi.me/v2/integrations/{app_id}/notification?uid=...&message=...
 * Auth: Bearer {app_secret}
 */

import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

/**
 * Send a notification to the user's Omi app.
 * Fails silently (logs error) so it never blocks webhook processing.
 */
export async function sendNotification(uid: string, message: string): Promise<void> {
  const appId = process.env.OMI_APP_ID;
  const appSecret = process.env.OMI_APP_SECRET;

  if (!appId || !appSecret) {
    logger.warn('OMI_APP_ID or OMI_APP_SECRET not set — skipping notification');
    return;
  }

  const url = new URL(`https://api.omi.me/v2/integrations/${appId}/notification`);
  url.searchParams.set('uid', uid);
  url.searchParams.set('message', message);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appSecret}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.error({ uid, status: response.status }, 'Omi notification API error');
    } else {
      logger.info({ uid, message }, 'Omi notification sent');
    }
  } catch (err) {
    logger.error({ uid, err }, 'Failed to send Omi notification');
  }
}
