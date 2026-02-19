# PRD: Omi WhatsApp Integration

## Overview

An Omi integration app that connects your conversations to WhatsApp. After every conversation captured by Omi, you receive a clean, formatted meeting recap as a WhatsApp self-message. You can also ask Omi's AI to send messages, share meeting notes, or set reminders via WhatsApp using Omi's Chat Tools.

**Track:** Track 1 — Omi App (Integration + Real-Time Notifications)

**Hackathon constraint:** Must be demo-able in 2 minutes with a working MVP.

---

## Problem Statement

After meetings and conversations, important details — decisions, action items, promises — get lost. People rely on memory or manual note-taking. Omi captures everything, but the data stays inside the Omi app. There's no way to automatically push structured recaps to the messaging app you already live in: WhatsApp.

Additionally, after conversations you often want to quickly message someone or share notes, but the friction of opening WhatsApp and typing breaks your flow. Omi's Chat Tools let you ask the AI to handle this hands-free.

---

## Target User

Solo professional who:
- Has frequent meetings, calls, or in-person conversations
- Uses WhatsApp as their primary messaging app
- Wants conversation recaps delivered automatically without any manual effort
- Wants to send messages and share notes hands-free via Omi's AI

---

## Core Features

### Feature 1: Auto Meeting Recap to WhatsApp (MVP)

**Trigger:** Omi Memory Created (conversation ends)

**Flow:**
1. User has a conversation (meeting, call, in-person chat)
2. Omi processes the conversation and creates a memory
3. Omi sends the memory payload to our webhook (`POST /webhook/memory?uid=USER_ID`)
4. Our server extracts the structured data from the Omi payload
5. Server formats it into a clean WhatsApp message
6. Server sends the message to the user's own WhatsApp ("Message Yourself" chat) via Baileys

**Message Format:**
```
📋 *{title}*

📝 {overview}

✅ Action Items:
• {action_item_1}
• {action_item_2}
• ...

🏷️ Category: {category}
🕐 Duration: {duration}
📅 {date}
```

**What we use from the Omi payload (no LLM needed):**
- `structured.title` — conversation title
- `structured.overview` — summary paragraph
- `structured.action_items[]` — list of action items
- `structured.category` — topic category
- `structured.emoji` — topic emoji
- `started_at` / `finished_at` — for duration calculation
- `created_at` — for date display

**Edge cases:**
- If `structured` is empty or conversation is `discarded: true`, skip sending
- If action items list is empty, omit that section
- If overview is very long (>500 chars), truncate with "..."

---

### Feature 2: WhatsApp Chat Tools (MVP)

**Trigger:** User asks Omi's AI (e.g. "Send a WhatsApp message to John saying hi")

**Available tools:**

| Tool | Endpoint | What it does |
|------|----------|--------------|
| `send_whatsapp_message` | `POST /tools/send_message` | Send a message to a named contact |
| `send_recap_to_contact` | `POST /tools/send_recap_to_contact` | Send meeting recap to a contact |
| `send_meeting_notes` | `POST /tools/send_meeting_notes` | Send notes to yourself |
| `set_reminder` | `POST /tools/set_reminder` | Schedule a WhatsApp reminder |

**Flow (example: "Send a WhatsApp to John saying hi"):**
1. Omi's AI reads the tool manifest from `GET /.well-known/omi-tools.json`
2. Omi calls `POST /tools/send_message { uid, contact_name: "John", message: "hi" }`
3. Server fuzzy-matches "John" against Baileys contacts
4. If match found: sends message via Baileys, returns `{ result: "Message sent to John on WhatsApp." }`
5. Omi's AI relays the result back to the user

**Contact matching logic:**
- Normalize both query and variants (lowercase, strip diacritics and punctuation)
- Score each candidate: exact (100) > first-name (85) > token-overlap (70) > starts-with (60) > contains (40) > fuzzy/Levenshtein (20)
- Return the highest-scoring match; return 404 if no match found

**Edge cases:**
- No match: return 404 with a descriptive error Omi's AI can relay ("Could not find a contact named X")
- WhatsApp not connected: return 503 with setup instructions
- Unknown session: return 403 before reaching the handler

---

### Feature 3: Follow-Up Reminders (LATER — Post-MVP)

**Trigger:** Cron job checking stored promises

**Flow:**
1. When processing a memory, detect commitment phrases ("I will...", "I'll send...", "Let me follow up...")
2. Extract: what was promised, to whom, by when (if mentioned)
3. Store in database with `uid`, `promise_text`, `deadline`, `status`
4. Cron job runs every morning
5. If deadline is today or overdue, send WhatsApp reminder

**Status:** Deferred. Will add after MVP is stable.

---

## Technical Details

See [tech-stack.md](./tech-stack.md) for the full tech stack, architecture, dependencies, and project structure.

---

## Omi App Configuration

When submitting the app on Omi:

| Field | Value |
|-------|-------|
| **App Name** | WhatsApp |
| **Description** | Get meeting recaps on WhatsApp automatically. Send messages to anyone by voice during conversations. |
| **Category** | Integration Apps |
| **Capabilities** | `external_integration`, `chat` |
| **Webhook URL (Memory)** | `{NGROK_URL}/webhook/memory` |
| **Auth URL** | `{NGROK_URL}/setup` |
| **Setup Completed URL** | `{NGROK_URL}/setup/status` |
| **Setup Instructions** | "Tap the link below to connect your WhatsApp. You'll scan a QR code just like WhatsApp Web." |

---

## Demo Script (2 minutes)

**Setup (before demo, already done):**
- Server running locally with ngrok
- WhatsApp linked via QR scan
- Omi app installed with webhooks configured

**Live demo:**

1. **[0:00 - 0:20] Intro**
   - "This is WhatsApp for Omi. It sends you meeting recaps on WhatsApp and lets you message anyone by voice."

2. **[0:20 - 1:00] Feature 1: Meeting Recap**
   - Have a short conversation (or use a pre-recorded memory)
   - Show the formatted recap arriving in WhatsApp self-chat
   - "Every conversation automatically becomes a clean recap in my WhatsApp."

3. **[1:00 - 1:40] Feature 2: Chat Tools**
   - Ask Omi AI: "Send a WhatsApp message to [judge's name or friend] saying: Great meeting today, I'll send the notes over."
   - Show the message arriving on the recipient's WhatsApp
   - "I just sent a WhatsApp message just by asking Omi."

4. **[1:40 - 2:00] Wrap-up**
   - "No LLM costs, no complex setup — just scan a QR code and every conversation flows to WhatsApp. Built with Omi webhooks and Baileys."

---

## Success Criteria

- [ ] User can scan QR code and link WhatsApp in under 30 seconds
- [ ] After a conversation ends, recap appears in WhatsApp self-chat within 10 seconds
- [ ] Asking Omi AI to send a WhatsApp message works for contacts saved in WhatsApp
- [ ] No crashes during 2-minute demo
- [ ] Clean, readable message formatting in WhatsApp

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Baileys session drops mid-demo | Can't send messages | Test 10 min before demo; keep phone nearby to re-scan |
| WhatsApp rate-limits messages | Messages delayed/blocked | Only send 1-2 messages in demo; well within limits |
| Omi webhook latency | Recap arrives late | Pre-test timing; have a backup memory ready to trigger manually |
| Contact name mismatch | "Send to John" fails | Pre-test with exact contact names; have fallback contact ready |
| ngrok tunnel drops | Webhooks fail | Keep ngrok dashboard open; restart if needed |

---

## Future Enhancements (Post-Hackathon)

1. **LLM-powered recaps** — Use OpenAI/Groq to generate richer summaries, extract promises, and identify key insights beyond what Omi's structured data provides
2. **Follow-up reminders** — Detect commitments and send WhatsApp reminders when deadlines approach
3. **WhatsApp group support** — Send recaps to a designated team group instead of self-chat
4. **Rich media** — Send audio clips of key moments, or formatted PDFs
5. **Two-way chat** — Reply to the bot on WhatsApp to query past conversations
6. **Multi-user deployment** — Deploy to cloud with proper session management for multiple users
