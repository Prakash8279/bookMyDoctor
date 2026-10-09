/**
 * Jest global setup (wired via jest.config.js's `setupFiles`): seeds the minimum environment
 * variables config/env.js requires to boot (see src/config/env.js's REQUIRED_VARS) before any
 * test file — and therefore any app module it `require()`s — is loaded. This file runs once per
 * test file's module sandbox, before the test file itself executes, which is what makes
 * `require('.../src/config/env')` (transitively pulled in by almost every module under test)
 * succeed instead of logging an error and calling process.exit(1) for a missing var.
 *
 * These are throwaway values for the test process only, never used to reach a real Postgres/
 * Redis instance — no such instance exists in this sandbox. Any test file whose subject
 * transitively requires config/db or config/redis (e.g. tokenService.js, auth.service.js) mocks
 * that module out directly with jest.mock(...) rather than letting it try to connect for real;
 * see those test files' own header comments.
 *
 * `process.env.X || default` (not a flat overwrite) so a real CI/dev environment that already
 * exports one of these for its own reasons can still take priority over the fallback here.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-only-access-secret-do-not-use-in-real-deploys';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-only-refresh-secret-do-not-use-in-real-deploys';
// Populated so tests can exercise tokenService's secret-rotation fallback (verifyWithSecrets
// trying accessVerifySecrets[1] after the current secret) — see tokenService.test.js.
process.env.JWT_ACCESS_SECRET_PREVIOUS = process.env.JWT_ACCESS_SECRET_PREVIOUS || 'test-only-PREVIOUS-access-secret';

process.env.CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/doctor_connect_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';

// Low cost factor so bcrypt-backed tests (auth.service.test.js) run in milliseconds instead of
// the production default (12 rounds, ~200-300ms per hash, paid at module-load time too — see
// auth.service.js's DUMMY_PASSWORD_HASH). Cost factor only controls how expensive a hash is to
// brute-force for real; it has zero effect on whether hash/compare correctly round-trip, which
// is the only thing these tests care about.
process.env.BCRYPT_SALT_ROUNDS = process.env.BCRYPT_SALT_ROUNDS || '4';

// GOOGLE SIGN-IN FEATURE — set so config/env.js's env.google.clientId is truthy by default,
// letting auth.service.test.js exercise the real googleAuth() code path (it mocks
// googleIdTokenVerifier.js directly rather than making a real network call, same as every other
// external dependency in that suite). Individual tests still override env.google.clientId = ''
// to cover the "not configured" case.
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-only-google-client-id.apps.googleusercontent.com';

// BANK-DETAIL ENCRYPTION (services/encryptionService.js) — a throwaway 32-byte hex key so
// env.bankDetailsEncryptionKey is truthy by default, letting me.service.test.js /
// doctors.service.test.js / encryptionService.test.js exercise the real encrypt/decrypt code
// path instead of every test needing to set this itself. NEVER use this value anywhere real.
process.env.BANK_DETAILS_ENCRYPTION_KEY =
  process.env.BANK_DETAILS_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Test-isolated providers (never send live external SMS or emails during unit tests)
process.env.EMAIL_PROVIDER = 'log';
process.env.SMS_PROVIDER = 'log';
