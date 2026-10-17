import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev, /api and /ws are proxied to Django on :8000 so no env vars are required.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
})
