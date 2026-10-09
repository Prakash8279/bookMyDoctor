/**
 * ESLint flat config (ESLint 9+ config format) for the backend — plain Node.js/Express CommonJS
 * codebase (see package.json's "type": "commonjs"; no ESM, no JSX, no TypeScript, no bundler —
 * same reasoning as jest.config.js's own header comment for why there's no transform step here).
 *
 * Scope on purpose: correctness/likely-bug rules only (unused vars, undefined references,
 * duplicate keys/cases, unreachable code, etc.) — no stylistic/formatting rules (quotes, semi,
 * indent, line length, ...) so this doesn't fight the codebase's existing formatting or force a
 * repo-wide reformat. There's no Prettier/stylistic setup here to defer to either, so this stays
 * deliberately narrow rather than inventing a style policy.
 *
 * ESLint itself is pinned in devDependencies; no helper package is needed for this hand-picked
 * correctness-focused rule set.
 */
'use strict';

// Minimal Node.js global set (this project has no `env: { node: true }` shorthand under flat
// config — languageOptions.globals is the flat-config replacement). Kept short and hand-picked
// rather than pulling in the separate `globals` npm package, which also isn't installed here.
const nodeGlobals = {
  process: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  module: 'writable',
  exports: 'writable',
  require: 'readonly',
  global: 'readonly',
  console: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  queueMicrotask: 'readonly',
};

// Jest globals, for tests/**/*.js only — see jest.config.js (testMatch: tests/**/*.test.js).
const jestGlobals = {
  describe: 'readonly',
  test: 'readonly',
  it: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
  jest: 'readonly',
};

module.exports = [
  {
    // prisma/manual_sql/** is frozen (already applied to a real database) and prisma/migrations/**
    // is Prisma-generated SQL history — neither is hand-written JS this config needs to look at
    // anyway, but excluded explicitly so a future generated .js under either is never linted.
    ignores: ['node_modules/**', 'coverage/**', 'prisma/manual_sql/**', 'prisma/migrations/**'],
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...nodeGlobals },
    },
    rules: {
      // --- Likely bugs / correctness (roughly eslint:recommended's non-stylistic subset) ---
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'no-unreachable': 'error',
      'no-unsafe-negation': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-self-compare': 'error',
      'no-self-assign': 'error',
      'no-shadow-restricted-names': 'error',
      'no-import-assign': 'error',
      'no-async-promise-executor': 'error',
      'no-compare-neg-zero': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-ex-assign': 'error',
      'no-func-assign': 'error',
      'no-irregular-whitespace': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-template-curly-in-string': 'warn',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...nodeGlobals, ...jestGlobals },
    },
  },
];
