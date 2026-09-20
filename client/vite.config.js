import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Keep large, slow-changing third-party libraries in their own chunks, separate
        // from app code, so browsers can cache them across deploys instead of
        // re-downloading them whenever app code changes.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Order matters here: check the more specific package names (react-router-dom,
          // react-chartjs-2) before the generic `id.includes('react')` check below, since
          // that generic check would otherwise also match those packages' own paths (they
          // contain the substring "react") and misroute them into vendor-react instead of
          // their own, more specific chunk.
          if (id.includes('react-router-dom')) return 'vendor-router'
          if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'vendor-charts'
          if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
          return undefined
        },
      },
    },
  },
})
