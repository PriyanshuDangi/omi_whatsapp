# Tech Stack

## Runtime & Language

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Node.js | 22 LTS |
| Language | TypeScript | ^5.5 |
| Dev runner | tsx | ^4.19 |

TypeScript is required because Baileys is a JS/TS-native library. `tsx` lets us run `.ts` files directly without a compile step during development.

---

## Server

| Component | Technology | Why |
|-----------|-----------|-----|
| Framework | Express.js | Lightweight, 4 routes, nothing more needed |
| Logging | pino | Baileys uses pino internally; control log levels (silent during demo) |
| Config | dotenv | Load PORT, NGROK_URL, OMI_APP_ID, OMI_APP_SECRET from .env |

---

## WhatsApp

| Component | Technology | Why |
|-----------|-----------|-----|
| Client | @whiskeysockets/baileys | Free, QR-scan auth, contact access, self-messaging. No Meta approval needed |
| Auth state | Baileys `useMultiFileAuthState` | Built-in filesystem persistence in `sessions/{uid}/` |
| QR display | qrcode (npm) | Generate QR as data URL for the setup page |

---

## Setup Page

Simple HTML served by Express. Uses Server-Sent Events (SSE) to push QR code updates and "Connected!" status to the browser without polling.

No frontend framework. One HTML file.

---

## Tunnel (Development)

| Tool | Why |
|------|-----|
| ngrok | Exposes local server to Omi webhooks. Alternative: `cloudflared` (free, no session timeout) |

---

## State Management (MVP)

Everything lives in memory and filesystem for the MVP:

- **Baileys auth** — filesystem (`sessions/{uid}/`)
- **Contact lookup** — live from Baileys `store.contacts` on each request

This keeps the MVP dead simple with zero database setup.

---

## State Management (Post-MVP)

When we need persistence beyond a single process restart:

| Component | Technology | Why |
|-----------|-----------|-----|
| App state | better-sqlite3 | Single file, no server, fast lookups |
| Use cases | Session metadata, contact cache, dedup state, follow-up reminders | — |

SQLite gets added later. Not needed for the hackathon demo.

---

## Dependencies

```json
{
  "dependencies": {
    "@whiskeysockets/baileys": "latest",
    "express": "^4.21",
    "fastest-levenshtein": "^1.0",
    "qrcode": "^1.5",
    "dotenv": "^16.4",
    "pino": "^9.0"
  },
  "devDependencies": {
    "typescript": "^5.5",
    "tsx": "^4.19",
    "@types/express": "^5.0",
    "@types/qrcode": "^1.5",
    "@types/node": "^22.0"
  }
}
```

---

## What We're NOT Using

| Technology | Why Not |
|-----------|---------|
| Database (Postgres, Mongo, Redis) | Overkill for single-user hackathon MVP |
| LLM / OpenAI | Omi's structured payload already has title, overview, action items |
| Docker | Adds setup complexity for zero benefit in a local demo |
| React / Next.js | One HTML page with SSE is all the setup page needs |
| Python / FastAPI | Baileys is JS-only; two services adds unnecessary complexity |
| WhatsApp Business API | Requires Meta approval (weeks), no self-messaging, costs money |

---

## Architecture (Single Process)

```
Node.js + Express (TypeScript)
├── POST /webhook/memory          ← Omi memory → format recap → Baileys → WhatsApp self-message
├── GET  /setup                   ← Serve HTML → Baileys QR → SSE push to browser
├── GET  /setup/status            ← Omi polls → check Baileys session → {is_setup_completed: bool}
├── GET  /.well-known/omi-tools.json  ← Chat tool manifest for Omi AI
├── POST /tools/send_message      ← Omi AI → fuzzy match contact → Baileys → WhatsApp message
├── POST /tools/send_recap_to_contact ← Omi AI → fuzzy match → Baileys → WhatsApp message
├── POST /tools/send_meeting_notes    ← Omi AI → Baileys → WhatsApp self-message
├── POST /tools/set_reminder          ← Omi AI → schedule timed WhatsApp reminder
│
├── Baileys connection (persistent socket per uid)
└── Filesystem (Baileys auth state)
```

Everything runs in a single Node.js process. No microservices, no workers, no queues.
