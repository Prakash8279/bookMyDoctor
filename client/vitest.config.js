import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Separate from vite.config.js (build config) so the test runner's own
// settings don't leak into `vite build`/`vite dev`.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    globals: false,
  },
})
