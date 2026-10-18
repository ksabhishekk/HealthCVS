import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app talks only to its own origin; /api is forwarded to the insurer
// backend, so no CORS setup is needed and a phone on the same Wi-Fi can use it.
const api = {
  '/api': { target: process.env.INSURER_API_URL || 'http://localhost:5001', changeOrigin: true },
}

export default defineConfig({
  plugins: [react()],
  server: { port: 5175, host: true, proxy: api },
  preview: { port: 5175, host: true, proxy: api },
})
