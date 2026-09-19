/**
 * Handles multipart file uploads (profile photos, doctor verification documents, clinic QR codes)
 * via multer, storing to local disk under /uploads in dev (swap for S3-compatible storage in prod
 * by changing only this file). Responsibility: return a served URL, never store raw bytes/base64 in Postgres.
 *
 * Every exported *Upload middleware array does three things, in order, before a controller ever
 * runs (see modules/uploads/uploads.routes.js for where they're wired in):
 *   1. multer (memoryStorage — see saveBufferToDisk below for why memory, not disk, storage)
 *      parses the multipart body, enforces a hard `limits.fileSize` cap, and rejects (via
 *      fileFilter) any mimetype outside that use case's allowlist with a clean ApiError.
 *   2. translateMulterError — a 4-arg (error-handling) middleware that turns multer's OWN
 *      LIMIT_FILE_SIZE/LIMIT_UNEXPECTED_FILE errors into the same {success:false,error:{code,
 *      message}} envelope every other error in this app produces, instead of falling through to
 *      errorHandler.js's generic 500 INTERNAL_ERROR. Express routes an error straight to the next
 *      error-handling (4-arg) middleware in the stack, skipping normal middleware in between, so
 *      this catches whatever multer itself raised without any extra wiring in routes.js.
 *   3. attachUploadedFileUrl — writes the buffered file to disk under a server-generated
 *      crypto.randomUUID() filename (NEVER the client-supplied original filename/extension —
 *      that's attacker-controlled input, and trusting it as a filesystem path/extension is
 *      exactly the bug class this avoids) and sets req.uploadedFile = {filename, url} for the
 *      controller to persist onto the right Prisma row.
 *
 * Controllers/services never touch multer, disk paths, or env.upload.* directly — they only
 * read req.uploadedFile.url after these middlewares have already run.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const env = require('../config/env');
const ApiError = require('../utils/ApiError');

// Same directory app.js's static mount (`app.use('/uploads', express.static(...))`, step 7)
// serves back out — resolved once, identically (path.resolve against env.upload.dir), so a file
// this service writes is guaranteed to be reachable at env.upload.baseUrl the instant the write
// finishes. Created eagerly at require-time (not lazily on first upload) so a broken UPLOAD_DIR
// (bad permissions, path under a read-only mount) fails loudly at boot rather than on some
// unlucky user's first upload attempt.
const UPLOAD_DIR = path.resolve(env.upload.dir);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// mimetype -> file extension. This is the ONLY source of truth for both (a) which mimetypes an
// upload use case accepts and (b) what extension a saved file gets — the client's original
// filename/extension is never consulted for either purpose.
const IMAGE_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// Doctor verification documents may be a photographed/scanned certificate (image) or an actual
// PDF export — everything photos/QR codes accept, plus application/pdf.
const DOCUMENT_MIME_EXTENSIONS = { ...IMAGE_MIME_EXTENSIONS, 'application/pdf': 'pdf' };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB — profile photos and clinic QR codes.
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10MB — verification documents (scanned PDFs run larger).

/**
 * The ONE function that actually puts bytes somewhere durable. Everything above this line in
 * the eventual middleware chain is multer/validation plumbing that is storage-backend-agnostic;
 * everything that calls this only ever deals in `filename`/`url` strings. Swapping local disk
 * for S3-compatible object storage later means replacing this function's body with a
 * `PutObjectCommand`-style call (and buildFileUrl below with the bucket's public base URL) —
 * nothing else in this file, and nothing in modules/uploads/*, needs to change.
 * @param {Buffer} buffer
 * @param {string} filename - already server-generated (crypto.randomUUID() + validated ext).
 */
async function saveBufferToDisk(buffer, filename) {
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), buffer);
}

/**
 * @param {string} filename
 * @returns {string} the URL a browser can load this file from (app.js's `/uploads` static mount).
 */
function buildFileUrl(filename) {
  return `${env.upload.baseUrl}/${filename}`;
}

/**
 * @param {Record<string,string>} mimeExtensions - allowlist for this use case, mimetype -> ext.
 */
function fileFilterFor(mimeExtensions) {
  return function fileFilter(req, file, cb) {
    if (!Object.prototype.hasOwnProperty.call(mimeExtensions, file.mimetype)) {
      cb(
        new ApiError(
          400,
          'INVALID_FILE_TYPE',
          `Unsupported file type "${file.mimetype}". Allowed: ${Object.keys(mimeExtensions).join(', ')}.`
        )
      );
      return;
    }
    cb(null, true);
  };
}

/**
 * 4-arg (error-handling) middleware, placed immediately after a multer instance in every
 * exported *Upload array — see this file's header comment for why that alone is enough for
 * Express to route a multer error straight here. Only multer's OWN errors are translated; an
 * ApiError raised from fileFilterFor above is passed through unchanged (it's already in the
 * app's standard shape, errorHandler.js handles it directly).
 * @param {number} maxBytes - the limits.fileSize this multer instance was configured with, only
 *   used to phrase the LIMIT_FILE_SIZE message in the same units the caller configured.
 */
function translateMulterError(maxBytes) {
  const maxMb = Math.round(maxBytes / (1024 * 1024));
  // eslint-disable-next-line no-unused-vars
  return function multerErrorHandler(err, req, res, next) {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, 'FILE_TOO_LARGE', `File is too large. Maximum allowed size is ${maxMb}MB.`));
      }
      return next(new ApiError(400, 'UPLOAD_ERROR', err.message));
    }
    return next(err);
  };
}

/**
 * The final 3-arg middleware in every exported *Upload array — runs only once multer has
 * already accepted the file (right mimetype, under the size limit). Generates the server-side
 * filename/extension, writes the file, and hands the controller a ready-to-persist URL. Every
 * route wired to one of these arrays treats the file as required.
 */
function attachUploadedFileUrl(mimeExtensions) {
  return async function attachUploadedFileUrlMiddleware(req, res, next) {
    try {
      if (!req.file) {
        throw new ApiError(400, 'FILE_REQUIRED', 'A file is required.');
      }

      // fileFilterFor above already rejected anything not in mimeExtensions, so this lookup
      // cannot miss in practice — the `|| 'bin'` fallback is defense-in-depth only, never
      // expected to actually be hit.
      const ext = mimeExtensions[req.file.mimetype] || 'bin';
      const filename = `${crypto.randomUUID()}.${ext}`;

      await saveBufferToDisk(req.file.buffer, filename);

      req.uploadedFile = { filename, url: buildFileUrl(filename) };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Builds one exported *Upload middleware array for a given use case.
 * @param {Record<string,string>} mimeExtensions
 * @param {number} maxBytes
 */
function buildUploadMiddleware(mimeExtensions, maxBytes) {
  const multerInstance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: fileFilterFor(mimeExtensions),
  });

  // Multipart field name is always 'file' across all three upload endpoints — one convention,
  // documented once here rather than per-route.
  return [multerInstance.single('file'), translateMulterError(maxBytes), attachUploadedFileUrl(mimeExtensions)];
}

module.exports = {
  photoUpload: buildUploadMiddleware(IMAGE_MIME_EXTENSIONS, MAX_IMAGE_BYTES),
  documentUpload: buildUploadMiddleware(DOCUMENT_MIME_EXTENSIONS, MAX_DOCUMENT_BYTES),
  qrUpload: buildUploadMiddleware(IMAGE_MIME_EXTENSIONS, MAX_IMAGE_BYTES),
};
