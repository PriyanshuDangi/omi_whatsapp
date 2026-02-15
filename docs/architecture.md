# Architecture

Single-process Node.js + Express server. No database, no microservices — everything runs in one process with in-memory state and filesystem auth persistence.

## File Structure

```
src/
├── index.ts                  # Entry point — Express app, route mounting, startup
├── routes/
│   ├── setup.ts              # GET /setup, GET /setup/status, GET /setup/events (SSE)
│   └── webhook.ts            # POST /webhook/memory, POST /webhook/realtime
├── services/
│   ├── whatsapp.ts           # Baileys connection lifecycle, QR, messaging, contacts
│   ├── formatter.ts          # Omi memory → WhatsApp recap message
│   ├── command-parser.ts     # Regex detection of "send message to X" voice commands
│   ├── contact-matcher.ts    # Fuzzy name → WhatsApp JID matching
│   └── notification.ts       # Omi notification API client (deferred)
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

### Voice Command (Feature 2)

```
Omi Backend
  → POST /webhook/realtime?uid=...&session_id=...
  → webhook.ts: deduplicate segments by session_id + start time
  → command-parser.ts: regex detect "send message to {name}: {content}"
  → contact-matcher.ts: fuzzy match name against Baileys contacts
  → whatsapp.ts: sendMessage() to matched JID
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

## State Management

| State | Storage | Lifetime |
|-------|---------|----------|
| Baileys auth credentials | Filesystem (`sessions/{uid}/`) | Persistent across restarts |
| Active WhatsApp sockets | In-memory `Map<uid, WhatsAppSession>` | Process lifetime |
| Contacts | In-memory `Map<uid, Map<jid, Contact>>` | Process lifetime, synced on connect |
| Transcript dedup | In-memory `Map<session_id, Set<start>>` | Cleared every 30 min |
| SSE listeners | In-memory `Map<uid, Set<callback>>` | Until browser disconnects |

## Key Design Decisions

- **No LLM** — Omi's `structured` payload provides title, overview, and action items. We format directly.
- **No database** — In-memory state + filesystem auth. Good enough for single-user hackathon demo.
- **Return 200 immediately** — All webhooks respond instantly, then do async work. Omi has timeout expectations.
- **SSE for setup** — Real-time QR updates without polling. EventSource in the browser, simple write on the server.
- **Baileys auto-reconnect** — On disconnect (unless logged out), the service automatically re-initializes the session.
