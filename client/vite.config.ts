import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Injects <link rel="preload" fetchpriority="high"> for hero images used as
// CSS backgrounds on the home screen so Lighthouse discovers LCP resources
// from the initial HTML document (they aren't discoverable via CSS).
const HERO_IMAGE_PATTERNS = ['newHOMEdailyfritz', 'homefinalpuzzle'];

function preloadHeroImagePlugin(): Plugin {
  return {
    name: 'preload-hero-image',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      const preloads = HERO_IMAGE_PATTERNS.flatMap((pattern) => {
        const asset = Object.keys(ctx.bundle!).find(
          (k) => k.includes(pattern) && k.endsWith('.webp'),
        );
        return asset
          ? [`<link rel="preload" as="image" type="image/webp" href="/${asset}" fetchpriority="high">`]
          : [];
      });
      if (!preloads.length) return html;
      return html.replace('</head>', `  ${preloads.join('\n  ')}\n  </head>`);
    },
  };
}

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_API = 'http://127.0.0.1:3001';
const devApiProxy = {
  target: LOCAL_API,
  changeOrigin: true,
  timeout: 300_000,
  proxyTimeout: 300_000,
} as const;

export default defineConfig({
  resolve: {
    alias: {
      '@racehorse/game-core': path.resolve(repoRoot, '../packages/game-core/src/index.ts'),
      '@racehorse/match-protocol': path.resolve(repoRoot, '../packages/match-protocol/src/index.ts'),
    },
  },
  plugins: [react(), preloadHeroImagePlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
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
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('recharts')) return 'vendor-charts';
            if (id.includes('@supabase/supabase-js')) return 'vendor-supabase';
            if (id.includes('socket.io-client')) return 'vendor-socket';
            if (id.includes('canvas-confetti')) return 'vendor-confetti';
            return;
          }
          // Bot match screen — isolate heavy guided / review / analyzer graphs from the entry chunk
          // so BotMatchScreen stays under the CI size budget (behavior unchanged; same eager load).
          if (id.includes('/src/learn/lessonV2')) return 'lesson-v2';
          if (id.includes('/src/modules/guided/')) return 'bot-guided';
          if (id.includes('/src/modules/match/hand-lifecycle/')) return 'bot-hand-lifecycle';
          if (id.includes('/src/training/pivotalReview/')) return 'pivotal-review';
          // Game engine must not live in analyzer — moveAnalyzer imports botEngine for replay oracle.
          if (id.includes('/src/modules/match/runtime/botEngine')) return 'bot-engine';
          // Fritz heuristics shared by play + analysis — keep out of analyzer so bot match does not fetch analysis.
          if (id.includes('/src/modules/fritz/botHeuristics')) return 'bot-heuristics';
          if (id.includes('/src/modules/fritz/fritzConfig')) return 'fritz-config';
          // Move log helpers used during play — isolate from analyzer so bot match does not fetch analysis code.
          if (id.includes('/src/game/moveLogger')) return 'move-logger';
          // Review UI is lazy-loaded — keep Board/DominoTile out of the analysis engine chunk.
          if (id.includes('/src/analyzer/GameReviewer')) return 'game-reviewer';
          if (id.includes('/src/analyzer/reviewSidebarCopy')) return 'game-reviewer';
          if (id.includes('/src/analyzer/')) return 'analyzer';
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
