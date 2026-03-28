import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockIsConnected = vi.fn().mockReturnValue(true);
const mockCheckWhatsAppNumber = vi.fn().mockResolvedValue({
  exists: true,
  jid: '14155551234@s.whatsapp.net',
});

vi.mock('../../src/services/whatsapp.js', () => ({
  isConnected: (...args: any[]) => mockIsConnected(...args),
  checkWhatsAppNumber: (...args: any[]) => mockCheckWhatsAppNumber(...args),
}));

const mockGetSavedContacts = vi.fn().mockReturnValue(new Map());
const mockSaveContact = vi.fn().mockImplementation((_uid: string, name: string, jid: string) => ({
  id: jid,
  name,
  addedAt: '2026-01-01T00:00:00.000Z',
}));
const mockDeleteContact = vi.fn().mockReturnValue(true);

const mockImportContacts = vi.fn().mockReturnValue({ upserted: 0, skipped: 0, invalid: 0, manualPreserved: 0 });

vi.mock('../../src/services/saved-contacts.js', () => ({
  getSavedContacts: (...args: any[]) => mockGetSavedContacts(...args),
  saveContact: (...args: any[]) => mockSaveContact(...args),
  deleteContact: (...args: any[]) => mockDeleteContact(...args),
  importContacts: (...args: any[]) => mockImportContacts(...args),
}));

const { contactsRouter } = await import('../../src/routes/contacts.js');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/contacts', contactsRouter);
  return app;
}

describe('Contacts routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    vi.clearAllMocks();
    mockIsConnected.mockReturnValue(true);
    mockCheckWhatsAppNumber.mockResolvedValue({
      exists: true,
      jid: '14155551234@s.whatsapp.net',
    });
    mockGetSavedContacts.mockReturnValue(new Map());
    mockDeleteContact.mockReturnValue(true);
  });

  describe('POST /contacts/save', () => {
    it('saves a contact with valid payload', async () => {
      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom', phone: '+1 (415) 555-1234' });

      expect(res.status).toBe(200);
      expect(mockCheckWhatsAppNumber).toHaveBeenCalledWith('test-user', '+14155551234');
      expect(mockSaveContact).toHaveBeenCalledWith('test-user', 'Mom', '14155551234@s.whatsapp.net', 'manual');
    });

    it('returns 400 when uid is missing', async () => {
      const res = await request(app)
        .post('/contacts/save')
        .send({ name: 'Mom', phone: '+14155551234' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/uid/i);
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ phone: '+14155551234' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });

    it('returns 400 when phone is missing', async () => {
      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/phone/i);
    });

    it('returns 400 when phone format is invalid', async () => {
      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom', phone: '4155551234' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid phone number/i);
    });

    it('returns 401 when WhatsApp is not connected', async () => {
      mockIsConnected.mockReturnValue(false);

      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom', phone: '+14155551234' });

      expect(res.status).toBe(401);
    });

    it('returns 404 when number is not on WhatsApp', async () => {
      mockCheckWhatsAppNumber.mockResolvedValueOnce({ exists: false });

      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom', phone: '+14155551234' });

      expect(res.status).toBe(404);
    });

    it('returns 500 when lookup throws', async () => {
      mockCheckWhatsAppNumber.mockRejectedValueOnce(new Error('lookup failed'));

      const res = await request(app)
        .post('/contacts/save?uid=test-user')
        .send({ name: 'Mom', phone: '+14155551234' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /contacts', () => {
    it('returns mapped saved contacts', async () => {
      mockGetSavedContacts.mockReturnValue(new Map([
        ['14155551234@s.whatsapp.net', {
          id: '14155551234@s.whatsapp.net',
          name: 'Mom',
          addedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }],
      ]));

      const res = await request(app).get('/contacts?uid=test-user');

      expect(res.status).toBe(200);
      expect(res.body.contacts).toHaveLength(1);
      expect(res.body.contacts[0]).toMatchObject({
        jid: '14155551234@s.whatsapp.net',
        name: 'Mom',
        phone: '+14155551234',
      });
    });

    it('returns 400 when uid is missing', async () => {
      const res = await request(app).get('/contacts');
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /contacts', () => {
    it('deletes by jid', async () => {
      const res = await request(app)
        .delete('/contacts?uid=test-user')
        .send({ jid: '14155551234@s.whatsapp.net' });

      expect(res.status).toBe(200);
      expect(mockDeleteContact).toHaveBeenCalledWith('test-user', '14155551234@s.whatsapp.net');
    });

    it('deletes by phone by converting to jid', async () => {
      const res = await request(app)
        .delete('/contacts?uid=test-user')
        .send({ phone: '+1 (415) 555-1234' });

      expect(res.status).toBe(200);
      expect(mockDeleteContact).toHaveBeenCalledWith('test-user', '14155551234@s.whatsapp.net');
    });

    it('returns 400 when uid is missing', async () => {
      const res = await request(app)
        .delete('/contacts')
        .send({ jid: '14155551234@s.whatsapp.net' });

      expect(res.status).toBe(400);
    });

    it('returns 400 when neither phone nor jid is provided', async () => {
      const res = await request(app)
        .delete('/contacts?uid=test-user')
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 when contact does not exist', async () => {
      mockDeleteContact.mockReturnValueOnce(false);

      const res = await request(app)
        .delete('/contacts?uid=test-user')
        .send({ jid: '14155550000@s.whatsapp.net' });

      expect(res.status).toBe(404);
    });
  });
});
