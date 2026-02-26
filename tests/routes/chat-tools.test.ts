import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeContacts } from '../fixtures/contacts.js';

// ── Mock whatsapp service ─────────────────────────────────────────────────────
const mockIsConnected = vi.fn().mockReturnValue(true);
const mockSendSelfMessage = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);
const mockGetContacts = vi.fn().mockReturnValue(makeContacts());
const mockWaitForContacts = vi.fn().mockResolvedValue(true);

vi.mock('../../src/services/whatsapp.js', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  sendSelfMessage: (...args: any[]) => mockSendSelfMessage(...args),
  sendMessage: (...args: any[]) => mockSendMessage(...args),
  getContacts: (...args: any[]) => mockGetContacts(...args),
  waitForContacts: (...args: any[]) => mockWaitForContacts(...args),
}));

// ── Mock reminder service ─────────────────────────────────────────────────────
const mockScheduleReminder = vi.fn().mockReturnValue('r_1');

vi.mock('../../src/services/reminder.js', () => ({
  scheduleReminder: (...args: any[]) => mockScheduleReminder(...args),
  startReminderTick: vi.fn(),
}));

const { manifestRouter, toolsRouter } = await import(
  '../../src/routes/chat-tools.js'
);

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/.well-known', manifestRouter);
  app.use('/tools', toolsRouter);
  return app;
}

describe('Chat tools routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    mockGetContacts.mockReturnValue(makeContacts());
    mockWaitForContacts.mockResolvedValue(true);
  });

  // ── Manifest ──────────────────────────────────────────────────────────────

  describe('GET /.well-known/omi-tools.json', () => {
    it('returns tool manifest with at least 4 tools', async () => {
      const res = await request(app).get('/.well-known/omi-tools.json');
      expect(res.status).toBe(200);
      expect(res.body.tools).toBeInstanceOf(Array);
      expect(res.body.tools.length).toBeGreaterThanOrEqual(4);
    });

    it('each tool has name, description, endpoint, method', async () => {
      const res = await request(app).get('/.well-known/omi-tools.json');
      for (const tool of res.body.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('endpoint');
        expect(tool).toHaveProperty('method');
      }
    });
  });

  // ── send_message ──────────────────────────────────────────────────────────

  describe('POST /tools/send_message', () => {
    it('sends message to a matched contact', async () => {
      const res = await request(app)
        .post('/tools/send_message?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'John Smith', message: 'Hi John!' });

      expect(res.status).toBe(200);
      expect(res.body.result).toContain('John Smith');
      expect(mockSendMessage).toHaveBeenCalledWith(
        'test-user',
        '919876543210@s.whatsapp.net',
        'Hi John!',
      );
    });

    it('returns 400 when contact_name is missing', async () => {
      const res = await request(app)
        .post('/tools/send_message?uid=test-user')
        .send({ uid: 'test-user', message: 'Hi' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/contact_name/i);
    });

    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/tools/send_message?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'John' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/message/i);
    });

    it('returns 404 when contact is not found', async () => {
      const res = await request(app)
        .post('/tools/send_message?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'NonExistent Person XYZ', message: 'Hi' });

      expect(res.status).toBe(404);
    });

    it('returns 401 when WhatsApp is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await request(app)
        .post('/tools/send_message?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'John', message: 'Hi' });

      expect(res.status).toBe(401);
    });
  });

  // ── send_meeting_notes ────────────────────────────────────────────────────

  describe('POST /tools/send_meeting_notes', () => {
    it('sends meeting notes to self', async () => {
      const res = await request(app)
        .post('/tools/send_meeting_notes?uid=test-user')
        .send({ uid: 'test-user', summary: 'Notes from the meeting.' });

      expect(res.status).toBe(200);
      expect(res.body.result).toContain('WhatsApp');
      expect(mockSendSelfMessage).toHaveBeenCalledWith(
        'test-user',
        expect.stringContaining('Notes from the meeting'),
      );
    });

    it('returns 400 when summary is missing', async () => {
      const res = await request(app)
        .post('/tools/send_meeting_notes?uid=test-user')
        .send({ uid: 'test-user' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/summary/i);
    });

    it('returns 401 when not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await request(app)
        .post('/tools/send_meeting_notes?uid=test-user')
        .send({ uid: 'test-user', summary: 'Notes' });

      expect(res.status).toBe(401);
    });
  });

  // ── send_recap_to_contact ─────────────────────────────────────────────────

  describe('POST /tools/send_recap_to_contact', () => {
    it('sends recap to a matched contact', async () => {
      const res = await request(app)
        .post('/tools/send_recap_to_contact?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'Alice', summary: 'Recap text.' });

      expect(res.status).toBe(200);
      expect(mockSendMessage).toHaveBeenCalled();
    });

    it('returns 400 when contact_name is missing', async () => {
      const res = await request(app)
        .post('/tools/send_recap_to_contact?uid=test-user')
        .send({ uid: 'test-user', summary: 'Text' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when summary is missing', async () => {
      const res = await request(app)
        .post('/tools/send_recap_to_contact?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'Alice' });

      expect(res.status).toBe(400);
    });

    it('returns 404 when contact not found', async () => {
      const res = await request(app)
        .post('/tools/send_recap_to_contact?uid=test-user')
        .send({ uid: 'test-user', contact_name: 'NoBody XYZ', summary: 'Text' });

      expect(res.status).toBe(404);
    });
  });

  // ── set_reminder ──────────────────────────────────────────────────────────

  describe('POST /tools/set_reminder', () => {
    it('sets a self-reminder', async () => {
      const res = await request(app)
        .post('/tools/set_reminder?uid=test-user')
        .send({ uid: 'test-user', message: 'Call dentist', delay_minutes: 30 });

      expect(res.status).toBe(200);
      expect(res.body.result).toContain('Reminder set');
      expect(mockScheduleReminder).toHaveBeenCalledWith(
        'test-user', 'Call dentist', 30, 'self', 'yourself',
      );
    });

    it('sets a contact-reminder', async () => {
      const res = await request(app)
        .post('/tools/set_reminder?uid=test-user')
        .send({ uid: 'test-user', message: 'Meeting', delay_minutes: 10, contact_name: 'Mom' });

      expect(res.status).toBe(200);
      expect(mockScheduleReminder).toHaveBeenCalledWith(
        'test-user', 'Meeting', 10,
        '919876543213@s.whatsapp.net', 'Mom',
      );
    });

    it('returns 400 when delay_minutes is missing', async () => {
      const res = await request(app)
        .post('/tools/set_reminder?uid=test-user')
        .send({ uid: 'test-user', message: 'Test' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when message is missing', async () => {
      const res = await request(app)
        .post('/tools/set_reminder?uid=test-user')
        .send({ uid: 'test-user', delay_minutes: 5 });

      expect(res.status).toBe(400);
    });

    it('returns 401 when not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await request(app)
        .post('/tools/set_reminder?uid=test-user')
        .send({ uid: 'test-user', message: 'Test', delay_minutes: 5 });

      expect(res.status).toBe(401);
    });
  });
});
