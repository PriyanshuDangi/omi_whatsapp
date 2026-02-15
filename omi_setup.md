# Omi App Setup Guide

Step-by-step instructions to register this WhatsApp integration as an app on Omi and connect it to your running server.

---

## Prerequisites

- Omi device paired with the Omi mobile app
- This server running locally (`npm run dev`)
- ngrok (or cloudflared) exposing your local server to the internet

---

## 1. Start the Server

```bash
cp .env.example .env        # edit with your values if needed
npm run dev                  # starts on http://localhost:3000
```

## 2. Start ngrok Tunnel

```bash
ngrok http 3000
```

Copy the forwarding URL (e.g. `https://abc123.ngrok-free.app`). This is your `NGROK_URL`.

## 3. Enable Developer Mode in Omi

1. Open the **Omi app** on your phone
2. Go to **Settings**
3. Scroll down and tap **Enable Developer Mode**
4. Tap **Developer Settings** once it appears

## 4. Create the App on Omi

1. In the Omi app, go to **Explore** (bottom tab)
2. Tap **Create an App** (or the "+" icon)
3. Fill in the fields:

| Field | Value |
|-------|-------|
| **App Name** | `WhatsApp` |
| **Description** | `Get meeting recaps on WhatsApp automatically. Send messages to anyone by voice during conversations.` |
| **Category** | Integration Apps |

4. Under **Capabilities**, select **External Integration**

## 5. Configure Integration Triggers

You need to set up **two triggers**: Memory Creation and Real-Time Transcript.

### Memory Creation Trigger

This fires when a conversation ends and Omi creates a memory.

| Field | Value |
|-------|-------|
| **Trigger** | Memory Created |
| **Webhook URL** | `{NGROK_URL}/webhook/memory` |

### Real-Time Transcript Trigger

This fires continuously during a live conversation with transcript segments.

| Field | Value |
|-------|-------|
| **Trigger** | Transcript Processed (Real-Time) |
| **Webhook URL** | `{NGROK_URL}/webhook/realtime` |

## 6. Configure Setup / Auth

These fields let Omi know how to guide the user through WhatsApp linking.

| Field | Value |
|-------|-------|
| **Auth URL** | `{NGROK_URL}/setup` |
| **Setup Completed URL** | `{NGROK_URL}/setup/status` |
| **Setup Instructions** | `Tap the link below to connect your WhatsApp. You'll scan a QR code just like WhatsApp Web.` |

- **Auth URL** — When the user installs your app, Omi opens this URL (with `?uid=USER_ID` appended) so they can scan the WhatsApp QR code.
- **Setup Completed URL** — Omi polls this endpoint (with `?uid=USER_ID`) and expects `{ "is_setup_completed": true }` once WhatsApp is linked.

## 7. Configure Chat Tools (Optional — enables Omi AI to send WhatsApp messages)

This lets Omi's AI decide on its own to send WhatsApp messages when users ask in chat (e.g., "Send a WhatsApp message to John saying hi" or "Send me the meeting notes on WhatsApp").

| Field | Value |
|-------|-------|
| **Chat Tools Manifest URL** | `{NGROK_URL}/.well-known/omi-tools.json` |

Omi will automatically fetch the tool definitions from this URL. The manifest exposes two tools:

- **send_whatsapp_message** — Send a message to any WhatsApp contact by name
- **send_meeting_notes** — Send meeting notes/summary to the user's own WhatsApp

## 8. Save and Install the App

1. Tap **Save** / **Submit** to create the app
2. Install the app on your own account (you can test with your own device)

## 9. Link WhatsApp

1. After installing, Omi will open the Auth URL in a browser
2. You'll see the QR code setup page
3. On your phone: open **WhatsApp** → **Settings** → **Linked Devices** → **Link a Device**
4. Scan the QR code shown on the setup page
5. Wait for the green "WhatsApp Connected!" confirmation
6. Omi will detect the setup is complete and close the auth flow

## 10. Test the Integration

### Test Memory Recap

**Option A — Live conversation:**
1. Have a short conversation with your Omi device
2. Wait for the conversation to end and memory to be created
3. Check your WhatsApp "Message Yourself" chat for the recap

**Option B — Trigger manually (Developer Mode):**
1. Go to any existing memory in the Omi app
2. Tap the **3-dot menu** → **Developer Tools** → **Trigger Webhook**
3. The recap should appear in your WhatsApp self-chat

### Test Voice Command

1. Start a conversation with your Omi device
2. Say: *"Send message to [contact name]: Hello, this is a test"*
3. The message should arrive on that contact's WhatsApp

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| QR code not appearing | Check server logs. Make sure ngrok is running and URL is correct. |
| "Setup not completed" stuck | Verify `GET /setup/status?uid=...` returns `{ "is_setup_completed": true }` after scanning. |
| Recap not arriving | Check WhatsApp is still connected. Check server logs for errors. |
| Voice command not detected | Speak clearly: *"send message to [name]: [content]"*. Check server logs for incoming transcript segments. |
| ngrok URL changed | ngrok free tier gives a new URL each restart. Update all webhook URLs in the Omi app config. |
| WhatsApp disconnected | Re-scan the QR code. Delete `sessions/` folder if auth state is corrupted, then re-link. |

---

## Environment Variables Reference

Add these to your `.env` file if you want Omi push notifications later:

```
PORT=3000
NGROK_URL=https://your-tunnel.ngrok-free.app
OMI_APP_ID=your_app_id_from_omi
OMI_APP_SECRET=your_app_secret_from_omi
LOG_LEVEL=info
```

You can find your App ID and App Secret in the Omi developer portal after creating the app.
