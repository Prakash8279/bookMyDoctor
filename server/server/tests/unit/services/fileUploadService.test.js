/**
 * Unit tests for services/fileUploadService.js — focused on the one documented security property
 * (see the file's own header comment, step 3): a saved file's name/extension is ALWAYS
 * server-generated from crypto.randomUUID() + a mimetype lookup, and the client-supplied original
 * filename/extension is NEVER consulted for either purpose — trusting attacker-controlled input
 * as a filesystem path/extension is exactly the bug class this design avoids. Also covers the
 * mimetype -> extension allowlist mapping and the multer-error -> ApiError translation (size
 * limits / unexpected-file-type surfaced as this app's standard {code,message} shape).
 *
 * Only `photoUpload`/`documentUpload`/`qrUpload` are exported, each a 3-element middleware array
 * `[multerInstance, translateMulterErrorMiddleware, attachUploadedFileUrlMiddleware]` — the two
 * plain-function middlewares (index 1 and 2) are exercised directly here with fake req/res/next,
 * since invoking the actual multer instance would require a real multipart HTTP body.
 *
 * `fs` is mocked with mkdirSync/promises.writeFile replaced by jest.fn()s but everything else
 * left as the REAL module (via jest.requireActual) — multer itself transitively uses real `fs`
 * internals that must keep working, and this module's own `fs.mkdirSync(UPLOAD_DIR, ...)` call
 * at require-time must not touch the real filesystem in this sandbox.
 */
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    mkdirSync: jest.fn(),
    promises: { ...actualFs.promises, writeFile: jest.fn().mockResolvedValue(undefined) },
  };
});

const fs = require('fs');
const multer = require('multer');
const { photoUpload, documentUpload, qrUpload } = require('../../../src/services/fileUploadService');

// Captured immediately after require (module-load time), BEFORE any test runs — jest.config.js's
// global `clearMocks: true` wipes every mock's call history before each test executes, which
// would otherwise erase the record of this require-time call before the first test could observe
// it.
const mkdirSyncCallsAtRequireTime = [...fs.mkdirSync.mock.calls];

function fakeReq(file) {
  return { file };
}

function runMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    const res = {};
    middleware(req, res, (err) => {
      resolve(err);
    });
  });
}

describe('fileUploadService — require-time directory setup never touches the real filesystem', () => {
  test('fs.mkdirSync was called (mocked) instead of creating a real directory', () => {
    expect(mkdirSyncCallsAtRequireTime).toHaveLength(1);
    expect(mkdirSyncCallsAtRequireTime[0]).toEqual([expect.any(String), { recursive: true }]);
  });
});

describe('fileUploadService — attachUploadedFileUrl: server-generated filename, never the client\'s', () => {
  const attachPhoto = photoUpload[2];
  const attachDocument = documentUpload[2];

  test('the ORIGINAL client filename/extension is never used for the saved filename', async () => {
    const req = fakeReq({ mimetype: 'image/png', buffer: Buffer.from('fake-image-bytes'), originalname: '../../etc/passwd.exe' });

    const err = await runMiddleware(attachPhoto, req);

    expect(err).toBeUndefined(); // next() called with no error
    expect(req.uploadedFile.filename).not.toContain('passwd');
    expect(req.uploadedFile.filename).not.toContain('etc');
    expect(req.uploadedFile.filename).not.toMatch(/\.exe$/);
    // Server-generated: a UUID followed by the mimetype-derived extension, nothing else.
    expect(req.uploadedFile.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(req.uploadedFile.url).toContain(req.uploadedFile.filename);
  });

  test('the extension is derived purely from the mimetype allowlist, e.g. image/jpeg -> .jpg', async () => {
    const req = fakeReq({ mimetype: 'image/jpeg', buffer: Buffer.from('x'), originalname: 'whatever.png' });

    await runMiddleware(attachPhoto, req);

    expect(req.uploadedFile.filename).toMatch(/\.jpg$/);
  });

  test('document uploads additionally accept application/pdf -> .pdf', async () => {
    const req = fakeReq({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4'), originalname: 'cert.pdf' });

    await runMiddleware(attachDocument, req);

    expect(req.uploadedFile.filename).toMatch(/^[0-9a-f-]{36}\.pdf$/);
  });

  test('writes the buffer to disk under the server-generated filename (mocked, no real I/O)', async () => {
    fs.promises.writeFile.mockClear();
    const req = fakeReq({ mimetype: 'image/webp', buffer: Buffer.from('bytes'), originalname: 'anything.webp' });

    await runMiddleware(attachPhoto, req);

    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenBuffer] = fs.promises.writeFile.mock.calls[0];
    expect(writtenPath).toContain(req.uploadedFile.filename);
    expect(writtenBuffer).toEqual(Buffer.from('bytes'));
  });

  test('400 FILE_REQUIRED when no file was attached at all', async () => {
    const req = fakeReq(undefined);

    const err = await runMiddleware(attachPhoto, req);

    expect(err).toMatchObject({ statusCode: 400, code: 'FILE_REQUIRED' });
  });
});

describe('fileUploadService — translateMulterError: multer errors mapped to this app\'s ApiError shape', () => {
  const translatePhoto = photoUpload[1]; // configured with MAX_IMAGE_BYTES (5MB)
  const translateDocument = documentUpload[1]; // configured with MAX_DOCUMENT_BYTES (10MB)

  function runErrorMiddleware(middleware, err) {
    return new Promise((resolve) => {
      middleware(err, {}, {}, (nextErr) => resolve(nextErr));
    });
  }

  test('LIMIT_FILE_SIZE is translated to 400 FILE_TOO_LARGE, phrased in the configured limit\'s MB', async () => {
    const multerErr = new multer.MulterError('LIMIT_FILE_SIZE');

    const translated = await runErrorMiddleware(translatePhoto, multerErr);

    expect(translated).toMatchObject({ statusCode: 400, code: 'FILE_TOO_LARGE' });
    expect(translated.message).toContain('5MB');
  });

  test('the document upload\'s size-limit message reflects ITS OWN (larger) configured limit', async () => {
    const multerErr = new multer.MulterError('LIMIT_FILE_SIZE');

    const translated = await runErrorMiddleware(translateDocument, multerErr);

    expect(translated.message).toContain('10MB');
  });

  test('a different multer error code (e.g. unexpected field) maps to 400 UPLOAD_ERROR', async () => {
    const multerErr = new multer.MulterError('LIMIT_UNEXPECTED_FILE');

    const translated = await runErrorMiddleware(translatePhoto, multerErr);

    expect(translated).toMatchObject({ statusCode: 400, code: 'UPLOAD_ERROR' });
  });

  test('a non-multer error (e.g. the ApiError fileFilterFor already threw) passes through unchanged', async () => {
    const ApiError = require('../../../src/utils/ApiError');
    const originalError = new ApiError(400, 'INVALID_FILE_TYPE', 'nope');

    const translated = await runErrorMiddleware(translatePhoto, originalError);

    expect(translated).toBe(originalError);
  });
});

describe('fileUploadService — qrUpload uses the same image-only mimetype allowlist as photoUpload', () => {
  test('qrUpload\'s attach middleware also derives extension from mimetype (image/png -> .png)', async () => {
    const attachQr = qrUpload[2];
    const req = fakeReq({ mimetype: 'image/png', buffer: Buffer.from('x'), originalname: 'qr-original.png' });

    await runMiddleware(attachQr, req);

    expect(req.uploadedFile.filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(req.uploadedFile.filename).not.toBe('qr-original.png');
  });
});
