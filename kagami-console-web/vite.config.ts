import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/kagami/',
  server: {
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'home.kisin.xyz',
      '.kisin.xyz'
    ]
  }
})
