import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const LOCAL_API = 'http://127.0.0.1:3001';
const devApiProxy = {
  target: LOCAL_API,
  changeOrigin: true,
  timeout: 300_000,
  proxyTimeout: 300_000,
} as const;

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: ['src/devtools/**', 'src/test/**', '**/*.behaviorTests.ts'],
      thresholds: {
        statements: 35,
        branches: 17,
        functions: 50,
        lines: 38,
      },
    },
  },
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
