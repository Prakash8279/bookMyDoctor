/**
 * Authenticated serving for private uploaded documents (doctor verification documents).
 *
 * SECURITY FIX (audit finding: "uploaded documents served without authentication" — these files
 * used to sit under app.js's plain `express.static('/uploads', ...)` mount, so anyone who ever
 * saw the URL — browser history, a server/analytics log, a link pasted into a support ticket —
 * could fetch it forever, with no login required. Filenames are unguessable crypto.randomUUID()
 * values, which is something, but relying on that alone is security-through-obscurity, not
 * access control).
 *
 * This route is mounted in app.js at '/uploads/documents', BEFORE the express.static mount at
 * '/uploads' — Express matches routes in registration order, so a request here is always
 * handled by this file and never falls through to the static server, even though the physical
 * directory (fileUploadService.js's DOCUMENTS_DIR) technically sits inside UPLOAD_DIR.
 *
 * Why a query-param TOKEN instead of the normal `authenticate` middleware (Authorization
 * header)? This URL is opened directly by the browser — AdminPages.jsx renders it as a plain
 * `<a href={doc.url} target="_blank">` — and a browser's own navigation/new-tab-open never
 * attaches a custom header the way an axios/fetch API call does. A short-lived, filename-scoped
 * signed token in the URL itself (the same shape S3/GCS "pre-signed URLs" use) is mintable only
 * by doctors.service.js's shapeDoctor, and only inside its includeContact gate (i.e. only for a
 * caller already confirmed to be the owning doctor or an admin/superadmin) — so this route
 * doesn't need to re-derive ownership itself, only verify the token that gate already produced.
 */
const path = require('path');
const router = require('express').Router();

const tokenService = require('../../services/tokenService');
const { DOCUMENTS_DIR } = require('../../services/fileUploadService');
const ApiError = require('../../utils/ApiError');
const asyncHandler = require('../../utils/asyncHandler');

// Server-generated filenames are always crypto.randomUUID() + one of a handful of known
// extensions (see fileUploadService.js's DOCUMENT_MIME_EXTENSIONS) — never the client's
// original filename. This allowlist is defense-in-depth against path traversal on top of
// path.basename below; a request for anything else is a 404, not a 400, to avoid confirming to
// a prober which shape of filename might exist.
const SAFE_FILENAME = /^[0-9a-f-]{36}\.(?:jpg|png|webp|pdf)$/i;

router.get(
  '/:filename',
  asyncHandler(async (req, res) => {
    // path.basename strips any directory component a crafted `:filename` might contain (e.g.
    // "../../etc/passwd") before it's ever used to build a filesystem path — belt-and-braces
    // alongside the SAFE_FILENAME allowlist check right after.
    const filename = path.basename(req.params.filename);

    if (!SAFE_FILENAME.test(filename)) {
      throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
    }

    // 404 (not 401/403) on a missing/expired/wrong-filename token — same anti-enumeration
    // reasoning the rest of this app uses for ownership checks (see IDOR notes across
    // appointments/payments/medicalRecords services): a prober guessing filenames should not be
    // able to tell "wrong token" apart from "file doesn't exist" from the response alone.
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!tokenService.verifyFileAccessToken(token, filename)) {
      throw new ApiError(404, 'NOT_FOUND', 'Document not found.');
    }

    const filePath = path.join(DOCUMENTS_DIR, filename);

    // Scanned certificates/IDs are just as viewable as a PDF export — inline is fine for
    // images. PDFs force-download, mirroring app.js's existing express.static setHeaders logic
    // for the same reason (avoid rendering an untrusted PDF inline in the browser's own
    // PDF-viewer, a real exploit surface in some browsers).
    if (filename.toLowerCase().endsWith('.pdf')) {
      res.setHeader('Content-Disposition', 'attachment');
    }

    res.sendFile(filePath, (err) => {
      // sendFile already sent headers/a partial response by the time a stream error can occur,
      // so this can't cleanly become an ApiError through asyncHandler's catch — just let
      // Express's default handling take it if headers weren't sent yet (e.g. ENOENT).
      if (err && !res.headersSent) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Document not found.' } });
      }
    });
  })
);

module.exports = router;
