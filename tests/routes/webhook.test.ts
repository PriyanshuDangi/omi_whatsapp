import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeMemory } from '../fixtures/memory.js';

// ── Mock whatsapp service ─────────────────────────────────────────────────────
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockSendSelfMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/whatsapp.js', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  sendSelfMessage: (...args: any[]) => mockSendSelfMessage(...args),
}));

const { webhookRouter } = await import('../../src/routes/webhook.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRouter);
  return app;
}

describe('POST /webhook/memory', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
  });

  it('returns 200 for valid memory', async () => {
    const res = await request(app)
      .post('/webhook/memory?uid=test-user')
      .send(makeMemory());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('calls sendSelfMessage for valid connected memory', async () => {
    await request(app)
      .post('/webhook/memory?uid=test-user')
      .send(makeMemory());

    // sendSelfMessage is called asynchronously; give it a tick
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSendSelfMessage).toHaveBeenCalledWith(
      'test-user',
      expect.stringContaining('Team Standup'),
    );
  });

  it('does NOT call sendSelfMessage for discarded memory', async () => {
    await request(app)
      .post('/webhook/memory?uid=test-user')
      .send(makeMemory({ discarded: true }));

    await new Promise((r) => setTimeout(r, 50));
    expect(mockSendSelfMessage).not.toHaveBeenCalled();
  });

  it('returns 400 when uid is missing', async () => {
    const res = await request(app)
      .post('/webhook/memory')
      .send(makeMemory());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid/i);
  });

  it('does NOT send when WhatsApp is not connected', async () => {
    mockIsConnected.mockReturnValue(false);

    await request(app)
      .post('/webhook/memory?uid=test-user')
      .send(makeMemory());

    await new Promise((r) => setTimeout(r, 50));
    expect(mockSendSelfMessage).not.toHaveBeenCalled();
  });
});
