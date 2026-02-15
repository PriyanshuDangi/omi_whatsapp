# PRD: Omi WhatsApp Integration

## Overview

An Omi integration app that connects your conversations to WhatsApp. After every conversation captured by Omi, you receive a clean, formatted meeting recap as a WhatsApp self-message. You can also say "send message to [name]: [content]" during any conversation, and the app will find the contact on WhatsApp and send the message on your behalf.

**Track:** Track 1 — Omi App (Integration + Real-Time Notifications)

**Hackathon constraint:** Must be demo-able in 2 minutes with a working MVP.

---

## Problem Statement

After meetings and conversations, important details — decisions, action items, promises — get lost. People rely on memory or manual note-taking. Omi captures everything, but the data stays inside the Omi app. There's no way to automatically push structured recaps to the messaging app you already live in: WhatsApp.

Additionally, during conversations you often want to quickly message someone ("I'll send John the doc") but you can't without pulling out your phone, opening WhatsApp, finding the contact, and typing. By the time you do, you've lost the flow of conversation.

---

## Target User

Solo professional who:
- Has frequent meetings, calls, or in-person conversations
- Uses WhatsApp as their primary messaging app
- Wants conversation recaps delivered automatically without any manual effort
- Wants to send quick messages hands-free during conversations

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

### Feature 2: "Send Message to [Name]" Voice Command (MVP)

**Trigger:** Omi Real-Time Transcript (live, during conversation)

**Flow:**
1. User is in a conversation
2. User says: "Send message to John: I'll have the proposal ready by Friday"
3. Omi streams transcript segments to our webhook (`POST /webhook/realtime?uid=USER_ID&session_id=SESSION_ID`)
4. Server detects the trigger phrase pattern: `send message to {name}: {content}` or `send message to {name} saying {content}`
5. Server searches the user's WhatsApp contacts (via Baileys) for a match on `{name}`
6. If match found: sends the message via Baileys to that contact
7. Server returns a notification to Omi: "Message sent to John" (or "Contact not found: John")

**Trigger phrase patterns (case-insensitive):**
- "send message to {name}: {content}"
- "send message to {name} saying {content}"
- "send a message to {name}: {content}"
- "message {name}: {content}"
- "text {name}: {content}"
- "whatsapp {name}: {content}"

**Contact matching logic:**
1. Normalize the name (lowercase, trim)
2. Search WhatsApp contacts via Baileys `store.contacts`
3. Match by first name, full name, or saved name (fuzzy match)
4. If multiple matches, pick the best match (exact > starts with > contains)
5. If no match, return error notification to user

**Edge cases:**
- Duplicate names: pick the most recently messaged contact
- No match: send Omi notification "Could not find contact: {name}"
- Empty message body: send Omi notification "No message content detected"
- Prevent re-triggering: track processed segments by `session_id` to avoid sending duplicates

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
| **Capabilities** | `external_integration` |
| **Webhook URL (Memory)** | `{NGROK_URL}/webhook/memory` |
| **Webhook URL (Real-Time)** | `{NGROK_URL}/webhook/realtime` |
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

3. **[1:00 - 1:40] Feature 2: Voice Message**
   - During a conversation, say: "Send message to [judge's name or friend]: Great meeting today, I'll send the notes over."
   - Show the message arriving on the recipient's WhatsApp
   - "I just sent a WhatsApp message without touching my phone."

4. **[1:40 - 2:00] Wrap-up**
   - "No LLM costs, no complex setup — just scan a QR code and every conversation flows to WhatsApp. Built with Omi webhooks and Baileys."

---

## Success Criteria

- [ ] User can scan QR code and link WhatsApp in under 30 seconds
- [ ] After a conversation ends, recap appears in WhatsApp self-chat within 10 seconds
- [ ] "Send message to [name]" works for contacts saved in WhatsApp
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
