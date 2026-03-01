# Architecture

Single-process Node.js + Express server. No database, no microservices — everything runs in one process with in-memory state and filesystem auth persistence.

## File Structure

```
src/
├── index.ts                  # Entry point — Express app, route mounting, startup
├── routes/
│   ├── setup.ts              # GET /setup, GET /setup/status, GET /setup/events, POST /setup/sync-history
│   ├── webhook.ts            # POST /webhook/memory
│   └── chat-tools.ts         # GET /.well-known/omi-tools.json, POST /tools/*
├── services/
│   ├── whatsapp.ts           # Baileys connection lifecycle, QR, messaging, contacts
│   ├── formatter.ts          # Omi memory → WhatsApp recap message
│   ├── contact-matcher.ts    # Scored fuzzy name → WhatsApp JID matching
│   └── reminder.ts           # Timed WhatsApp reminder scheduler
├── types/
│   ├── omi.ts                # OmiMemory, TranscriptSegment, ActionItem, Structured
│   └── whatsapp.ts           # WhatsAppSession, SessionEvent types
└── views/
    └── setup.html            # QR code setup page (SSE-powered, no framework)
```

## Data Flow

### Memory Recap (Feature 1)

```
Omi Backend
  → POST /webhook/memory?uid=...
  → webhook.ts: validate, skip if discarded
  → formatter.ts: build recap message from structured payload
  → whatsapp.ts: sendSelfMessage() via Baileys
  → WhatsApp "Message Yourself" chat
```

### Setup / QR Linking

```
Omi app opens Auth URL
  → GET /setup?uid=... → serves setup.html
  → Browser connects to GET /setup/events?uid=... (SSE)
  → whatsapp.ts: initSession() → Baileys generates QR
  → SSE pushes QR data URL to browser → user scans
  → Baileys connection.update → "connected" event via SSE
  → Omi polls GET /setup/status?uid=... → { is_setup_completed: true }
```

### Chat Tools (Feature 2 — Omi AI-initiated)

```
User asks Omi AI: "Send a WhatsApp message to John saying hi"
  → Omi AI decides to call send_whatsapp_message tool
  → POST /tools/send_message { uid, contact_name, message }
  → chat-tools.ts: validate params, check WhatsApp connected
  → contact-matcher.ts: fuzzy match contact_name
  → whatsapp.ts: sendMessage() to matched JID
  → Return { result: "Message sent to John on WhatsApp." }

User asks Omi AI: "Send me the meeting notes on WhatsApp"
  → Omi AI decides to call send_meeting_notes tool
  → POST /tools/send_meeting_notes { uid, summary }
  → chat-tools.ts: validate, check WhatsApp connected
  → whatsapp.ts: sendSelfMessage() with formatted notes
  → Return { result: "Meeting notes sent to your WhatsApp." }
```

### History Sync & Contact Enrichment

```
Baileys connects → WhatsApp sends history sync events
  → messaging-history.set fires with { contacts, chats, messages, syncType }
  → contacts: direct Contact records (push names, phone-set names)
  → chats: Chat metadata with user-saved address book names (Chat.name / displayName)
  → messages: WAMessage records with pushName fields (sender self-chosen names)
  → enrichContactsFromChats(): fills Contact.name from chat metadata
  → enrichContactsFromMessages(): fills Contact.notify from message pushName
  → persistContacts(): saves enriched contacts to disk
```

### On-Demand History Sync

```
POST /setup/sync-history?uid=... { count: 50 }
  → whatsapp.ts: requestHistorySync() → socket.fetchMessageHistory()
  → WhatsApp main device sends additional history
  → messaging-history.set fires again → contacts re-enriched
```

## State Management

| State | Storage | Lifetime |
|-------|---------|----------|
| Baileys auth credentials | Filesystem (`sessions/{uid}/`) | Persistent across restarts |
| Active WhatsApp sockets | In-memory `Map<uid, WhatsAppSession>` | Process lifetime |
| Contacts | In-memory `Map<uid, Map<jid, Contact>>` + disk cache | Process lifetime, enriched from history sync |
| SSE listeners | In-memory `Map<uid, Set<callback>>` | Until browser disconnects |

## Key Design Decisions

- **No LLM** — Omi's `structured` payload provides title, overview, and action items. We format directly.
- **No database** — In-memory state + filesystem auth. Good enough for single-user hackathon demo.
- **Return 200 immediately** — All webhooks respond instantly, then do async work. Omi has timeout expectations.
- **SSE for setup** — Real-time QR updates without polling. EventSource in the browser, simple write on the server.
- **Baileys auto-reconnect** — On disconnect (unless logged out), the service automatically re-initializes the session.
- **Contact enrichment from multiple sources** — Contacts are enriched from three sources during history sync: direct contact records, chat metadata (user's address book names), and message push names. Chat names take priority as they reflect the user's saved contact name, not the sender's self-set name.
