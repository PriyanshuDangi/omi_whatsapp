# Production Deployment Plan

Harden the Omi WhatsApp integration for VPS deployment with focus on chat tools: add build pipeline, persist reminders, remove debug exposure, add security (rate limiting, webhook auth, uid sanitization), and prepare for a VPS with pm2.

---

## 1. Build Pipeline

Update `package.json` to compile TypeScript for production:

- Add `"build": "tsc"` script
- Change `"start"` from `tsx src/index.ts` to `node dist/index.js`
- Move `tsx` to `devDependencies` only (it's already there, just remove it from the `start` script)
- `tsconfig.json` already has `outDir: "dist"` -- no changes needed there

## 2. Persist Reminders to Disk

Currently `src/services/reminder.ts` stores reminders in a plain array that is lost on restart.

- Write reminders to `data/reminders.json` on every schedule/fire
- Load from disk on startup in `startReminderTick()`
- Create `data/` directory alongside `sessions/`
- Keep it simple: JSON file, full rewrite on each change (low volume, no need for SQLite yet)

## 3. Remove Debug Exposure

### 3a. Remove debug endpoint

Remove the unauthenticated `GET /debug/contacts` route from `src/index.ts` (lines 29-41). It exposes every user's full contact list with no auth.

### 3b. Replace console.log with pino logger

In `src/routes/webhook.ts`:

- Line 69-70: raw body dump -> `logger.debug`
- Lines 126-129: segment dump -> `logger.debug`
- Lines 246-251: full contact list dump -> `logger.debug`

In `src/services/whatsapp.ts`:

- Lines 35, 52, 173, 183: contact sync logs -> `logger.debug`

In `src/services/reminder.ts`:

- Line 72: `console.log` -> `logger.info`

In `src/index.ts`:

- Line 56 session restore log -> `logger.info`

This ensures `LOG_LEVEL=info` in production hides all sensitive data, while `LOG_LEVEL=debug` still works for local dev.

## 4. Input Sanitization — uid

The `uid` parameter flows directly into filesystem paths (`sessions/${uid}`). A crafted uid like `../../etc` is a path traversal risk.

- Create a shared `sanitizeUid()` utility in a new file `src/utils/sanitize.ts`
- Allow only `[a-zA-Z0-9_-]` characters, reject anything else with 400
- Apply it as Express middleware or at the top of every route that reads `uid` from query/body
- Simplest approach: a small middleware in `src/index.ts` that validates `req.query.uid` on all routes

## 5. Rate Limiting

Add `express-rate-limit` to `package.json` and apply it in `src/index.ts`:

- Global: 100 requests/min per IP (covers all endpoints)
- Chat tools: stricter 20 requests/min per IP on `/tools/*` (prevents message spam)
- Webhook endpoints: 60 requests/min per IP (Omi sends frequent realtime payloads)

## 6. Webhook / Chat Tool Auth

### 6a. Omi webhook verification

Add a middleware for `/webhook/*` routes that checks for a shared secret header. Omi sends requests with the app secret -- validate it against `OMI_APP_SECRET` env var.

### 6b. Chat tool uid validation

For `/tools/*` endpoints, the `uid` comes from Omi's server (not user-controlled). Add a check that the uid has an active or known session (exists in `sessions/` directory) before processing. This prevents arbitrary uid injection.

## 7. Environment and Deployment Config

### 7a. Update .env.example

Replace `NGROK_URL` with `BASE_URL` (more generic):

```
PORT=3000
BASE_URL=https://your-server.example.com
OMI_APP_ID=
OMI_APP_SECRET=
LOG_LEVEL=info
```

### 7b. Add pm2 ecosystem file

Create `ecosystem.config.cjs` for pm2:

```js
module.exports = {
  apps: [{
    name: 'omi-whatsapp',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
  }]
};
```

### 7c. Update .gitignore

Add `data/` directory (reminders file) to `.gitignore`.

---

## File Change Summary

| File | Change |
|------|--------|
| `package.json` | Build script, add `express-rate-limit` |
| `src/index.ts` | Remove debug route, add rate limiting middleware, add uid sanitization middleware |
| `src/utils/sanitize.ts` | New file -- uid sanitizer |
| `src/services/reminder.ts` | Persist to/load from `data/reminders.json` |
| `src/routes/webhook.ts` | Replace console.log with logger, add auth check |
| `src/routes/chat-tools.ts` | Update `NGROK_URL` ref to `BASE_URL` |
| `src/services/whatsapp.ts` | Replace console.log with logger |
| `.env.example` | Rename `NGROK_URL` to `BASE_URL` |
| `.gitignore` | Add `data/` |
| `ecosystem.config.cjs` | New file -- pm2 config |
