// Playwright configuration for BookMyDoctor24's end-to-end suite.
//
// This drives the REAL client (client/, served by `npm run dev` — Vite, default
// http://localhost:5173) against the REAL backend (server/server/, served by its own
// `npm run dev` — Express + Prisma + PostgreSQL, default http://localhost:4000). See
// e2e/README.md for the full list of things that must be running/seeded locally first.
//
// This config intentionally does NOT declare a `webServer` entry: this suite needs TWO
// independent long-running processes (frontend dev server + backend dev server, the backend
// itself depending on a real Postgres/Redis) that the person running the tests should start
// and own themselves, not something Playwright should try to spawn/tear down on their behalf.
//
// NOTE: this suite cannot be executed inside the sandbox this file was authored in — there is
// no frontend/backend running here, no real database, and no Playwright browsers installed.
// It is a scaffold only, meant to be run later on a real developer machine (see README).
const { defineConfig, devices } = require('@playwright/test')

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
