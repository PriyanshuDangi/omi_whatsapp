import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { sanitizeUid } from '../src/utils/sanitize.js';

function createApp({ appSecret }: { appSecret?: string } = {}) {
  const app = express();
  app.use(express.json());

  // UID sanitization middleware
  app.use((req, res, next) => {
    const uid = (req.query.uid as string) || req.body?.uid;
    if (uid && !sanitizeUid(uid)) {
      res.status(400).json({ error: 'Invalid uid format' });
      return;
    }
    next();
  });

  // Webhook auth middleware
  app.use('/webhook', (req, res, next) => {
    const secret = appSecret;
    if (!secret) return next();
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });

  // Session validation middleware
  app.use('/tools', (req, res, next) => {
    const uid = (req.query.uid as string) || req.body?.uid;
    if (uid && !fs.existsSync(path.join('sessions', uid))) {
      res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
      return;
    }
    next();
  });
  app.use('/setup/tools', (req, res, next) => {
    const uid = (req.query.uid as string) || req.body?.uid;
    if (uid && !fs.existsSync(path.join('sessions', uid))) {
      res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
      return;
    }
    next();
  });
  app.use('/contacts', (req, res, next) => {
    const uid = (req.query.uid as string) || req.body?.uid;
    if (uid && !fs.existsSync(path.join('sessions', uid))) {
      res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
      return;
    }
    next();
  });
  app.use('/setup/contacts', (req, res, next) => {
    const uid = (req.query.uid as string) || req.body?.uid;
    if (uid && !fs.existsSync(path.join('sessions', uid))) {
      res.status(403).json({ error: 'Unknown session. Please set up WhatsApp first.' });
      return;
    }
    next();
  });

  // Dummy endpoints that pass through middleware
  app.get('/test', (_req, res) => res.json({ ok: true }));
  app.post('/webhook/test', (_req, res) => res.json({ ok: true }));
  app.post('/tools/test', (_req, res) => res.json({ ok: true }));
  app.post('/setup/tools/test', (_req, res) => res.json({ ok: true }));
  app.get('/contacts/test', (_req, res) => res.json({ ok: true }));
  app.get('/setup/contacts/test', (_req, res) => res.json({ ok: true }));

  return app;
}

describe('UID sanitization middleware', () => {
  const app = createApp();

  it('passes valid uid through', async () => {
    const res = await request(app).get('/test?uid=valid-uid-123');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects path traversal uid', async () => {
    const res = await request(app).get('/test?uid=../../../etc/passwd');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid/i);
  });

  it('rejects uid with special characters', async () => {
    const res = await request(app).get('/test?uid=bad@uid!');
    expect(res.status).toBe(400);
  });

  it('passes request without uid', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
  });

  it('validates uid from request body', async () => {
    const res = await request(app)
      .post('/webhook/test')
      .send({ uid: '../../hack' });
    expect(res.status).toBe(400);
  });
});

describe('Webhook auth middleware', () => {
  it('passes through when no secret is configured (dev mode)', async () => {
    const app = createApp();
    const res = await request(app).post('/webhook/test').send({});
    expect(res.status).toBe(200);
  });

  it('rejects request with wrong Bearer token', async () => {
    const app = createApp({ appSecret: 'correct-secret' });
    const res = await request(app)
      .post('/webhook/test')
      .set('Authorization', 'Bearer wrong-secret')
      .send({});
    expect(res.status).toBe(401);
  });

  it('rejects request with no Authorization header', async () => {
    const app = createApp({ appSecret: 'correct-secret' });
    const res = await request(app).post('/webhook/test').send({});
    expect(res.status).toBe(401);
  });

  it('passes request with correct Bearer token', async () => {
    const app = createApp({ appSecret: 'correct-secret' });
    const res = await request(app)
      .post('/webhook/test')
      .set('Authorization', 'Bearer correct-secret')
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('Session validation middleware on /tools', () => {
  it('rejects uid with no session directory', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/tools/test')
      .send({ uid: 'no-session-here' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/session/i);
  });

  it('passes when session directory exists', async () => {
    const existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    const app = createApp();

    const res = await request(app)
      .post('/tools/test')
      .send({ uid: 'has-session' });

    expect(res.status).toBe(200);
    existsSpy.mockRestore();
  });

  it('applies same validation on /setup/tools', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/setup/tools/test')
      .send({ uid: 'no-session-here' });
    expect(res.status).toBe(403);
  });

  it('applies same validation on /contacts and /setup/contacts', async () => {
    const app = createApp();
    const res1 = await request(app).get('/contacts/test?uid=no-session-here');
    const res2 = await request(app).get('/setup/contacts/test?uid=no-session-here');
    expect(res1.status).toBe(403);
    expect(res2.status).toBe(403);
  });
});
