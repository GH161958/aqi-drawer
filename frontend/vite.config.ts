import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend =
  'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [
    react(),
  ],

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,

    proxy: {
      /*
        IMPORTANT:

        Keep the browser's original Host header.

        Drawer browser authentication validates:

          Origin === protocol://Host

        With changeOrigin:true, Vite rewrites Host to
        127.0.0.1:8787 while Origin remains the LAN
        frontend origin, causing legitimate browser
        requests to fail same-origin validation.

        This is a development-proxy concern only.
        The backend security check remains unchanged.
      */

      '/api': {
        target: backend,
        changeOrigin: false,
      },

      '/drawer/session': {
        target: backend,
        changeOrigin: false,
      },
    },
  },

  build: {
    sourcemap: true,
  },
})
