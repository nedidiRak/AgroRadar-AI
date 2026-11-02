import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// START_AGRORADAR.bat saves the chosen API port here. This lets Vite
// forward /api requests correctly even when port 8000 is blocked by Windows.
function apiPort(): number {
  try {
    const text = readFileSync(resolve(process.cwd(), '.agroradar-api-port'), 'utf8').trim()
    const port = Number(text)
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) return port
  } catch {
    // For manual startup without the launcher keep the original port.
  }
  return 8000
}

const port = apiPort()

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${port}`,
        changeOrigin: true,
      },
    },
  },
})
