/**
 * express-validator chains for every auth endpoint's request body/params/query.
 * Responsibility: shape + type validation ONLY (required fields, string lengths, enums,
 * numeric ranges). Business-rule validation (e.g. "slot already booked") belongs in the service layer.
 */
const { body } = require('express-validator');

const register = [
  body('name').trim().notEmpty().withMessage('Name is required.').isLength({ max: 150 }).withMessage('Name must be at most 150 characters.'),
  body('email').trim().notEmpty().withMessage('Email is required.').isEmail().withMessage('A valid email is required.').isLength({ max: 255 }),
  body('password').notEmpty().withMessage('Password is required.').isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters.'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ max: 20 }).withMessage('Phone must be at most 20 characters.'),
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

const logout = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required.').isString(),
];

const refresh = [
  body('refreshToken').notEmpty().withMessage('refreshToken is required.').isString(),
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

module.exports = { register, login, googleAuth, logout, refresh, forgotPassword, resetPassword };
