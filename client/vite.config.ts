import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
/** Dev proxy → Express. Use 127.0.0.1 (not "localhost") to avoid IPv6/::1 mismatches on macOS. */
const LOCAL_API = 'http://127.0.0.1:3001';
const devApiProxy = {
  target: LOCAL_API,
  changeOrigin: true,
  /** Ladder seeding can run 30–120s+ of CPU; short defaults cause read ECONNRESET in the proxy. */
  timeout: 300_000,
  proxyTimeout: 300_000,
} as const;

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts')) return 'vendor-charts';
          if (id.includes('@supabase/supabase-js')) return 'vendor-supabase';
          if (id.includes('socket.io-client')) return 'vendor-socket';
          if (id.includes('canvas-confetti')) return 'vendor-confetti';
        },
      },
    },
  },
  server: {
    strictPort: true,
    proxy: {
      '/api': devApiProxy,
      '/league': devApiProxy,
      '/health': devApiProxy,
    },
    headers: {
      'Content-Security-Policy':
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'; worker-src 'self' blob:;",
    },
  },
});
