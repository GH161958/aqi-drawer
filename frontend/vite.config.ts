import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend =
  'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,

    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
      },

      '/drawer/session': {
        target: backend,
        changeOrigin: true,
      },
    },
  },

  build: {
    sourcemap: true,
  },
})
