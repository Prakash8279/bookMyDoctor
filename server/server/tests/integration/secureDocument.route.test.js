/**
 * Integration test for GET /uploads/documents/:filename — the authenticated replacement for
 * plain express.static serving of private doctor-verification documents (see
 * modules/uploads/secureDocument.routes.js's header comment for the full security rationale).
 * Real Express routing (via supertest) and real tokenService.js signing/verification; only the
 * Postgres/Redis infrastructure boundary is mocked, exactly as auth.flow.test.js documents.
 */
jest.mock('../../src/config/db', () => require('./helpers/mockPrisma')());
jest.mock('../../src/config/redis', () => require('./helpers/mockRedis')());
jest.mock('../../src/jobs/bookingQueue', () => ({
  enqueueBookingJob: jest.fn(),
  getJob: jest.fn(),
  getQueuePosition: jest.fn(),
  bookingQueue: { add: jest.fn() },
  QUEUE_NAME: 'appointment-booking',
}));

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const app = require('../../src/app');
const tokenService = require('../../src/services/tokenService');
const { DOCUMENTS_DIR } = require('../../src/services/fileUploadService');

const FILENAME = '11111111-1111-1111-1111-111111111111.pdf';
const OTHER_FILENAME = '22222222-2222-2222-2222-222222222222.pdf';
const FILE_PATH = path.join(DOCUMENTS_DIR, FILENAME);

beforeAll(() => {
  fs.mkdirSync(DOCUMENTS_DIR, { recursive: true });
  fs.writeFileSync(FILE_PATH, '%PDF-1.4 fake certificate bytes');
});

afterAll(() => {
  fs.rmSync(FILE_PATH, { force: true });
});

describe('GET /uploads/documents/:filename', () => {
  test('a valid, correctly-scoped token serves the file (and force-downloads a PDF)', async () => {
    const token = tokenService.signFileAccessToken(FILENAME);

    const res = await request(app).get(`/uploads/documents/${FILENAME}`).query({ token });

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.text).toContain('fake certificate bytes');
  });

  test('no token at all -> 404 (not 401/403 — avoids confirming the file exists to a prober)', async () => {
    const res = await request(app).get(`/uploads/documents/${FILENAME}`);

    expect(res.status).toBe(404);
  });

  test('an expired/garbage token -> 404', async () => {
    const res = await request(app).get(`/uploads/documents/${FILENAME}`).query({ token: 'not-a-real-token' });

    expect(res.status).toBe(404);
  });

  test("a token signed for a DIFFERENT filename can't be replayed against this one -> 404", async () => {
    const tokenForOtherFile = tokenService.signFileAccessToken(OTHER_FILENAME);

    const res = await request(app).get(`/uploads/documents/${FILENAME}`).query({ token: tokenForOtherFile });

    expect(res.status).toBe(404);
  });

  test('a path-traversal-shaped filename is rejected before ever touching the filesystem', async () => {
    const token = tokenService.signFileAccessToken(FILENAME);

    // supertest/superagent normalizes "../" in the URL path itself, so this asserts the intent
    // via an otherwise-invalid (non-UUID-shaped) filename instead — same SAFE_FILENAME allowlist
    // rejection path a raw "..%2f..%2f" attempt would hit.
    const res = await request(app).get('/uploads/documents/not-a-valid-filename.pdf').query({ token });

    expect(res.status).toBe(404);
  });
});
