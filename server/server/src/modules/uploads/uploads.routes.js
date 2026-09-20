/**
 * Route definitions for the uploads module.
 * Scope: multipart file uploads — profile photos (any authenticated user, own row), doctor
 * verification documents (doctor only), and clinic payment QR codes (doctor/receptionist,
 * scoped to a clinic they actually own/staff — see uploads.service.js#saveClinicQr).
 * Allowed roles: see per-route authorize(...) below; there is no "any role, any target" route.
 * Responsibility: wire path+method -> [authenticate, authorize(...), the matching multer
 * middleware from services/fileUploadService.js, validation chain, validateRequest, controller
 * fn]. No business logic here — persistence + ownership checks belong in uploads.service.js.
 *
 * MOUNT PATH NOTE: this router is mounted at '/media' in routes/index.js, NOT '/uploads' —
 * app.js already owns the literal '/uploads' path for `express.static` (serving the saved files
 * themselves back out, see app.js step 7). Mounting this API router at the same prefix would
 * either shadow the static file server or be shadowed by it depending on mount order, silently
 * breaking one or the other. '/media' was picked as a distinct, equally self-explanatory prefix —
 * there is nothing else "media"-shaped in this API to collide with.
 *
 * RATE LIMITING: every POST (upload) route below is behind uploadLimiter (middleware/
 * rateLimiter.js) — previously the only sensitive write path in this app with no dedicated
 * limiter at all, unlike login/booking/payment. Mounted AFTER authenticate (and, where present,
 * authorize) so the limiter's per-user keyGenerator has req.user available, and BEFORE the multer
 * middleware so an over-limit caller is rejected before this process spends any effort parsing/
 * buffering their multipart body.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const authorize = require('../../middleware/authorize');
const validateRequest = require('../../middleware/validateRequest');
const { uploadLimiter } = require('../../middleware/rateLimiter');
const fileUploadService = require('../../services/fileUploadService');
const validation = require('./uploads.validation');
const controller = require('./uploads.controller');

router.use(authenticate);

// Any authenticated user, own row only (matches PATCH /me's ownership model) — no authorize()
// role gate needed, req.user.id is the only id ever used downstream (uploads.service.js#savePhoto).
router.post('/photo', uploadLimiter, ...fileUploadService.photoUpload, controller.uploadPhoto);

// Doctor-only: appended to the CALLER's own doctor_profiles.verification_documents.
router.post(
  '/document',
  authorize('doctor'),
  uploadLimiter,
  ...fileUploadService.documentUpload,
  validation.uploadDocument,
  validateRequest,
  controller.uploadDocument
);

// Doctor or receptionist: clinicId (a multipart text field, validated below) says which clinic —
// uploads.service.js#saveClinicQr is what actually enforces "this doctor/receptionist may write
// to THIS clinic"; authorize() here only gates the role, not the specific clinic.
router.post(
  '/qr',
  authorize('doctor', 'receptionist'),
  uploadLimiter,
  ...fileUploadService.qrUpload,
  validation.uploadQr,
  validateRequest,
  controller.uploadQr
);

module.exports = router;
