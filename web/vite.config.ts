/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express server listens on PORT (default 3000, see server/src/config.ts).
const server = 'http://localhost:3000';
const proxied = { target: server, changeOrigin: false };

export default defineConfig({
  plugins: [react()],
  // VITE_* values (judge and sandbox buyer logins for the guide) live in the root .env.
  envDir: '..',
  server: {
    proxy: {
      '/auth': proxied,
      '/api': proxied,
      '/health': proxied,
      '/store': proxied,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
