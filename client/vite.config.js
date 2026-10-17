import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Keep the local web app on one origin. Vite forwards API calls to the live
      // backend, so code changes appear immediately without rebuilding on AWS.
      '/api': {
        target: 'https://bookadoctors.com',
        changeOrigin: true,
        secure: true,
        // The API sets its refresh cookie on /auth. From localhost its matching
        // path is /api/auth, otherwise login expires after the access token does.
        cookiePathRewrite: { '/auth': '/api/auth' },
      },
    },
  },
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
