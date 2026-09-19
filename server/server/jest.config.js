/**
 * Jest configuration. Responsibility: point Jest at tests/, wire the env-var bootstrap every
 * test needs (config/env.js fails fast at require-time without it — see tests/setupEnv.js), and
 * nothing else.
 *
 * No babel/ts transform config here on purpose: package.json's "type": "commonjs" means this
 * whole backend is plain Node CommonJS (require/module.exports, no ESM, no JSX, no TypeScript),
 * which Jest's default (untransformed) require-based module loading already handles natively —
 * adding babel-jest/ts-jest would be pure overhead for a codebase that doesn't need it.
 */
module.exports = {
  testEnvironment: 'node',

  // Every *.test.js file under tests/ — keeps test files out of src/ entirely so `require`
  // paths inside app code never accidentally pick up a test file, and so a future coverage
  // report's `collectCoverageFrom` (src/**/*.js) cleanly excludes this directory by construction.
  testMatch: ['<rootDir>/tests/**/*.test.js'],

  // Seeds the minimum env vars config/env.js requires to boot (JWT secrets, DATABASE_URL,
  // REDIS_URL, CLIENT_ORIGIN) before any test file — and therefore any app module it requires —
  // is loaded. See tests/setupEnv.js's header comment for why these are safe throwaway values.
  setupFiles: ['<rootDir>/tests/setupEnv.js'],

  // Auto-reset jest.fn() mock call history between every test (not just per-file) so one test's
  // mock.calls/mockResolvedValue leftovers can never leak into the next test in the same file.
  clearMocks: true,

  verbose: true,
};
