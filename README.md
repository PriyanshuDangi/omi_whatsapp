# Omi + WhatsApp

> **Beta** — independent side project. Not affiliated with WhatsApp LLC, Meta Platforms, Inc., or Omi.

An [Omi](https://www.omi.me) integration that connects your conversations to WhatsApp.

After every conversation Omi captures, you receive a clean meeting recap as a WhatsApp self-message. You can also ask Omi's AI to send WhatsApp messages, share meeting notes, or schedule reminders — all hands-free.

---

## ⚠️ Read this before linking your WhatsApp

This app uses [Baileys](https://github.com/WhiskeySockets/Baileys), an open-source library that emulates the WhatsApp Web protocol. **Use of unofficial WhatsApp clients may violate WhatsApp's Terms of Service and could result in your number being temporarily or permanently banned.** You use this app at your own risk.

If you're not comfortable with that, don't link a WhatsApp account you depend on.

---

## What it does

- **Auto recaps** — every Omi memory becomes a formatted WhatsApp self-message (title, overview, action items, category, duration).
- **Voice messaging** — ask Omi's AI: *"Send a WhatsApp message to Mom saying I'll call later"* and it routes through Baileys to the matched contact.
- **Share notes** — push the latest meeting notes to any contact or yourself.
- **Reminders** — schedule a WhatsApp reminder by voice.

All four flows are exposed as Omi Chat Tools. See [`docs/prd.md`](./docs/prd.md) for the full feature spec.

---

## Stack

- **Node.js 22** + **TypeScript** + **Express**
- [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys) for WhatsApp (QR auth, contacts, messaging)
- Single process, in-memory state with filesystem persistence (no database)
- Deployed with `pm2`, sessions persisted to disk under `sessions/`

See [`docs/tech-stack.md`](./docs/tech-stack.md) and [`docs/architecture.md`](./docs/architecture.md) for details.

---

## Run locally

```bash
git clone https://github.com/PriyanshuDangi/omi_whatsapp
cd omi_whatsapp
npm install
cp .env.example .env   # edit values
npm run dev
```

Then open `http://localhost:3000/setup?uid=test` and scan the QR code with WhatsApp → **Settings → Linked Devices → Link a Device**.

To send a memory recap, POST to `http://localhost:3000/webhook/memory?uid=test` with an Omi memory payload.

For convenient request examples and a runnable test flow, see [`test-api-example.http`](./test-api-example.http) and [`test-api.mjs`](./test-api.mjs).

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/setup` | QR code page for WhatsApp linking |
| `GET` | `/setup/status` | Returns `{is_setup_completed: bool}` for Omi polling |
| `POST` | `/webhook/memory` | Receives Omi memory, sends WhatsApp recap |
| `POST` | `/tools/send_message` | Omi chat tool: send a WhatsApp message to a contact |
| `POST` | `/tools/send_recap_to_contact` | Omi chat tool: send meeting recap to a contact |
| `POST` | `/tools/send_meeting_notes` | Omi chat tool: send meeting notes to self |
| `POST` | `/tools/set_reminder` | Omi chat tool: schedule a WhatsApp reminder |
| `GET` | `/legal/{privacy,terms,disclaimer}` | User-facing legal pages |

---

## Deploy

A reference `deploy.sh` script and `ecosystem.config.cjs` (pm2) are included. See [`docs/deployment-plan.md`](./docs/deployment-plan.md).

---

## Privacy & terms

The user-facing legal pages live in the running app:

- Privacy Policy → `/legal/privacy`
- Terms of Service → `/legal/terms`
- Disclaimer & non-affiliation notice → `/legal/disclaimer`

The app stores the minimum needed to keep WhatsApp linked: WhatsApp session keys, your contacts, and your Omi `uid`. Nothing is sold or shared. Logging out severs the WhatsApp Web link and removes the active session keys. To request full deletion of all data tied to your account, email [priyanshudangipd@gmail.com](mailto:priyanshudangipd@gmail.com).

---

## Contributing

This is a personal beta side project, but PRs and issues are welcome at [github.com/PriyanshuDangi/omi_whatsapp](https://github.com/PriyanshuDangi/omi_whatsapp). Please don't open issues asking for help bypassing WhatsApp bans or building bulk-messaging features — those are explicitly out of scope.

---

## License

[MIT](./LICENSE) — copyright © 2026 Priyanshu Dangi.

"WhatsApp" is a trademark of WhatsApp LLC. "Meta" is a trademark of Meta Platforms, Inc. This project is not affiliated with, endorsed by, or sponsored by either company.
