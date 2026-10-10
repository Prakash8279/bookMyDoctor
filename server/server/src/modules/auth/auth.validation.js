/**
 * express-validator chains for every auth endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "slot already booked") belongs in the service layer.
 */
const { body } = require('express-validator');

// MANDATORY-FIELDS FIX (user request: "create account jo hai ushme jo v data hai oo compalasari
// proper validation varification") — the web/mobile "Create account" forms collect an Indian
// mobile number and (for patients) always render the field as required, but this endpoint used to
// accept it as a completely optional, unvalidated string. 10 digits, first digit 6-9, same rule
// used on every other phone field this fix touches (doctors.validation.js#registerDoctor/#createDoctor).
const PHONE_RE = /^[6-9]\d{9}$/;
// A password of just digits or just letters is technically 8+ characters but not a "proper"
// password by any real standard — require at least one letter AND one digit, same bound (8-72,
// bcrypt's own byte limit) as before.
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
// Letters, spaces, apostrophes, hyphens and dots only (covers names like "Mary-Jane O'Brien") —
// rejects a name that's only digits/symbols, which the plain notEmpty() below let through.
const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,149}$/;

const register = [
  body('name').trim().notEmpty().withMessage('Name is required.').matches(NAME_RE).withMessage('Name must contain letters only (at least 2 characters).'),
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('A valid email is required.').isLength({ max: 255 }),
  body('password')
    .notEmpty()
    .withMessage('Password is required.')
    .isLength({ min: 8, max: 72 })
    .withMessage('Password must be between 8 and 72 characters.')
    .matches(PASSWORD_RE)
    .withMessage('Password must include at least one letter and one number.'),
  body('emailOtp').trim().notEmpty().withMessage('Email verification code is required.').isLength({ min: 6, max: 6 }).isNumeric().withMessage('Enter the 6-digit code sent to your email.'),
  // COMPLETENESS FIX (this same request) — was `.optional({values:'falsy'})`; the "Create
  // account" form always renders phone as a required field, so the backend now actually enforces
  // that instead of silently accepting its absence.
  body('phone').trim().notEmpty().withMessage('Phone number is required.').matches(PHONE_RE).withMessage('Enter a valid 10-digit mobile number.'),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 100 }).withMessage('City must be at most 100 characters.'),
  // Self-registration may only ever produce a patient account. Any other value is rejected
  // here at the shape layer; the service layer also hard-codes role:'patient' regardless
  // (belt-and-suspenders against a client that bypasses this validation).
  body('role')
    .optional()
    .custom((value) => value === 'patient')
    .withMessage('role must be "patient".'),
];

const login = [
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('A valid email is required.'),
  body('password').notEmpty().withMessage('Password is required.'),
];

// GOOGLE SIGN-IN (user request: "google work nahi kar rah hai fix kro"). idToken is the signed
// JWT ("credential") Google Identity Services hands the frontend — shape validation only, no
// length bound (a real Google ID token easily runs past a few hundred characters); the actual
// signature/audience/issuer verification happens in googleIdTokenVerifier.js.
const googleAuth = [
  body('idToken').notEmpty().withMessage('idToken is required.').isString(),
];

// WEB-ONLY REFRESH-COOKIE FIX (risky-item #2, docs/risky-fixes-plan-2026-09-20.md) — refreshToken
// is now OPTIONAL in the body for both of these: a web caller never sends it here at all (it
// lives only in the httpOnly cookie — see utils/webClientAuth.js), while mobile keeps sending it
// in the body exactly as before. A request with neither a body token nor a cookie still fails,
// just later and with a slightly different (but equally clear) error — auth.controller.js's
// resolveIncomingRefreshToken() finds nothing, and tokenService rejects an undefined token as
// invalid (401 INVALID_REFRESH_TOKEN for /refresh; a no-op for the already-idempotent /logout).
const logout = [
  body('refreshToken').optional({ values: 'falsy' }).isString().withMessage('refreshToken must be a string.'),
];

const refresh = [
  body('refreshToken').optional({ values: 'falsy' }).isString().withMessage('refreshToken must be a string.'),
];

const forgotPassword = [
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('A valid email is required.').isLength({ max: 255 }),
];

const resetPassword = [
  body('token').notEmpty().withMessage('token is required.').isString(),
  // Same bounds as register's password field — this is the same bcrypt-hashed credential,
  // just arriving via the reset flow instead of registration.
  body('newPassword').notEmpty().withMessage('newPassword is required.').isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters.'),
];

const sendRegistrationEmailOtp = [
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('A valid email is required.').isLength({ max: 255 }),
];

module.exports = {
  register,
  login,
  googleAuth,
  logout,
  refresh,
  forgotPassword,
  resetPassword,
  sendRegistrationEmailOtp,
};
