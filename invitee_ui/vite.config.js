import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // '/invite/:id' and '/event/:id' are both API routes and SPA routes —
      // a browser navigation (Accept: text/html) must get the React shell,
      // while the SPA's own fetch() calls must reach the backend. Mirrors
      // the Accept-based split in deploy/nginx/public.conf; without it,
      // opening an invite link in dev renders raw JSON instead of the page.
      '/invite': {
        target: 'http://localhost:8080',
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
      '/event': {
        target: 'http://localhost:8080',
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) return '/index.html'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    coverage: { provider: 'v8', include: ['src/**'] },
  },
})
