/**
 * Route definitions for the auth module.
 * Scope: Authentication: register, login, logout, refresh-token, get-current-user,
 * forgot-password, reset-password.
 * Allowed roles: public + self
 * Responsibility: wire path+method -> [authenticate, authorize(...), validation chain, validateRequest, controller fn].
 * No business logic here — that belongs in auth.service.js.
 */
const router = require('express').Router();

const authenticate = require('../../middleware/authenticate');
const validateRequest = require('../../middleware/validateRequest');
const { authLimiter, refreshLimiter } = require('../../middleware/rateLimiter');
const validation = require('./auth.validation');
const controller = require('./auth.controller');

// ── OpenAPI worked example ────────────────────────────────────────────────────────────────────
// The four blocks below (register/login/refresh/me) are the reference example for annotating a
// route file for config/swagger.js's swagger-jsdoc scan (globbed against every modules/**/*.routes.js
// — see that file's header comment). No other module is annotated yet; copy this same shape
// (operationId, requestBody/responses referencing the real field names from *.validation.js and
// the real response shape from *.service.js) when documenting another module's routes.

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Self-register a new patient account.
 *     description: >
 *       Always creates a `patient` role account regardless of what the request body contains —
 *       role is hard-coded server-side (see auth.service.js#register) even though `role` is
 *       accepted in the body and validated to only ever be the literal string "patient".
 *       Rate-limited by IP (authLimiter) same as /auth/login, for brute-force/abuse protection.
 *     operationId: authRegister
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, maxLength: 150, example: 'Asha Rao' }
 *               email: { type: string, format: email, maxLength: 255, example: 'asha@example.com' }
 *               password: { type: string, minLength: 8, maxLength: 72, format: password }
 *               phone: { type: string, maxLength: 20, nullable: true, example: '9876543210' }
 *               city: { type: string, maxLength: 100, nullable: true, example: 'Pune' }
 *     responses:
 *       201:
 *         description: Account created; access + refresh tokens issued immediately (no separate login step needed).
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string, example: 'Registration successful' }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         email: { type: string, format: email }
 *                         role: { type: string, example: 'patient' }
 *                         phone: { type: string, nullable: true }
 *                         city: { type: string, nullable: true }
 *                         photoUrl: { type: string, nullable: true }
 *                         status: { type: string, example: 'active' }
 *                         createdAt: { type: string, format: date-time }
 *                     accessToken: { type: string, description: 'Short-lived JWT (default 15m), see config/env.js JWT_ACCESS_EXPIRES_IN.' }
 *                     refreshToken: { type: string, description: 'Long-lived JWT (default 30d), see config/env.js JWT_REFRESH_EXPIRES_IN.' }
 *       409:
 *         description: An account with this email already exists.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       422:
 *         description: Request body failed shape validation (see auth.validation.js#register).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       429:
 *         description: Too many requests from this IP (authLimiter — see config/env.js AUTH_RATE_LIMIT_MAX/WINDOW).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
// Public — brute-force-protected.
router.post('/register', authLimiter, validation.register, validateRequest, controller.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email + password.
 *     description: >
 *       Always runs a real bcrypt.compare(), even when no account matches the given email
 *       (against a precomputed dummy hash — see auth.service.js's DUMMY_PASSWORD_HASH), so
 *       response timing can't be used to distinguish "no such email" from "wrong password".
 *       For the same reason, an unknown email and a wrong password both return the identical
 *       401 INVALID_CREDENTIALS below.
 *     operationId: authLogin
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Login successful; fresh access + refresh tokens issued.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       description: Never includes passwordHash or createdAt.
 *                       properties:
 *                         id: { type: string, format: uuid }
 *                         name: { type: string }
 *                         email: { type: string, format: email }
 *                         role: { type: string, enum: [patient, doctor, receptionist, admin, superadmin] }
 *                         phone: { type: string, nullable: true }
 *                         city: { type: string, nullable: true }
 *                         photoUrl: { type: string, nullable: true }
 *                         status: { type: string, example: 'active' }
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *       401:
 *         description: Invalid email or password (identical response whether the account exists or not).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       403:
 *         description: The account exists and the password matched, but the account has been disabled.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       429:
 *         description: Too many requests from this IP (authLimiter).
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.post('/login', authLimiter, validation.login, validateRequest, controller.login);

// Public — same authLimiter as login/register: forgot-password lets a caller trigger a lookup
// by email (a coarse enumeration/spam surface) and reset-password lets a caller brute-force a
// token (a credential-guessing surface functionally like login), so both get the same
// brute-force protection as the rest of this module rather than only the global defaultLimiter.
router.post('/forgot-password', authLimiter, validation.forgotPassword, validateRequest, controller.forgotPassword);
router.post('/reset-password', authLimiter, validation.resetPassword, validateRequest, controller.resetPassword);

// Requires a currently-valid access token (revokes the caller's own refresh token).
router.post('/logout', authenticate, validation.logout, validateRequest, controller.logout);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Rotate a refresh token for a new access + refresh token pair.
 *     description: >
 *       Deliberately NOT behind `authenticate` (see route definition below) — the whole point is
 *       to mint a new access token once the old one has already expired. The presented
 *       refreshToken is always revoked as part of this call (single-use, rotating): reusing an
 *       already-rotated token is treated as theft and revokes every active session for that user
 *       (see tokenService.js#rotateRefreshToken). Not behind authLimiter (that's IP+account
 *       login/register specific) but does carry its own dedicated refreshLimiter, plus the
 *       global defaultLimiter, plus this rotation/reuse detection.
 *     operationId: authRefresh
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refreshToken]
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: A new access + refresh token pair. The old refreshToken is now revoked.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     accessToken: { type: string }
 *                     refreshToken: { type: string }
 *       401:
 *         description: >
 *           Refresh token is invalid/expired/unknown (INVALID_REFRESH_TOKEN), OR it was already
 *           used once before (REFRESH_TOKEN_REUSED) — in the reuse case every refresh token for
 *           this user has just been revoked and the client must force a full re-login.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 *       403:
 *         description: The token is otherwise valid but the account has since been disabled.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
// Public — deliberately NOT behind `authenticate`: the whole point of this endpoint is to
// mint a new access token when the old one has already expired. Protected by its own
// refreshLimiter (see middleware/rateLimiter.js), the global defaultLimiter (mounted in
// app.js), and the refresh token's own rotation/reuse detection in tokenService.
router.post('/refresh', refreshLimiter, validation.refresh, validateRequest, controller.refresh);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Cheap "who am I" / session check for the current access token.
 *     description: >
 *       Base User columns only (id/name/email/role/phone/city/photoUrl/status/createdAt) —
 *       never passwordHash. For the fuller role-profile-joined view, see GET /me in the me
 *       module instead; this endpoint exists purely to let a client validate its current access
 *       token cheaply.
 *     operationId: authMe
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: The authenticated user's basic identity/session info.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                     email: { type: string, format: email }
 *                     role: { type: string, enum: [patient, doctor, receptionist, admin, superadmin] }
 *                     phone: { type: string, nullable: true }
 *                     city: { type: string, nullable: true }
 *                     photoUrl: { type: string, nullable: true }
 *                     status: { type: string, example: 'active' }
 *                     createdAt: { type: string, format: date-time }
 *       401:
 *         description: Missing/invalid/expired access token.
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ApiError' }
 */
router.get('/me', authenticate, controller.me);

module.exports = router;
