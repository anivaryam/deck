import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackRouter } from '@tanstack/router-plugin/vite';

// Backend the dev server proxies /api /auth /ws to. Override with DECK_API_TARGET.
const apiTarget = process.env.DECK_API_TARGET || 'http://127.0.0.1:8787';
const wsTarget = apiTarget.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    host: true, // bind 0.0.0.0 + :: so merge-port (IPv4) can reach it
    port: 3000,
    allowedHosts: true, // merge-port forwards the public tunnel Host header
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/auth': { target: apiTarget, changeOrigin: true },
      '/ws': { target: wsTarget, ws: true },
    },
  },
});
