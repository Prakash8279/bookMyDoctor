// Vitest setup file (see vitest.config.js -> test.setupFiles).
// Adds jest-dom's DOM matchers (toBeInTheDocument, toHaveTextContent, ...)
// to vitest's `expect`.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react's auto-cleanup relies on test.globals being on;
// since this config keeps globals off, unmount after every test explicitly
// so one test's render doesn't leak into the next.
afterEach(() => {
  cleanup()
})
