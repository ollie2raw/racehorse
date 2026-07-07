import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const LIMITS = {
  // Individual chunk limits (bytes)
  'AppRoutes': 200_000,      // was 1.4MB, now 73kB — guard against regression
  'BotMatchScreen': 250_000, // 196kB currently
  'index': 700_000,          // main bundle
  'lesson-v2': 1_400_000,    // huge lessonV2 chunk
};

const distAssets = 'dist/assets';
let failed = false;

try {
  const files = readdirSync(distAssets).filter(f => f.endsWith('.js'));
  
  for (const [name, limit] of Object.entries(LIMITS)) {
    const match = files.find(f => f.startsWith(name));
    if (!match) continue;
    const size = statSync(join(distAssets, match)).size;
    const kb = Math.round(size / 1024);
    const limitKb = Math.round(limit / 1024);
    if (size > limit) {
      console.error(`❌ ${name}: ${kb}kB exceeds ${limitKb}kB limit`);
      failed = true;
    } else {
      console.log(`✓ ${name}: ${kb}kB (limit ${limitKb}kB)`);
    }
  }
} catch (e) {
  console.error('Bundle check failed:', e.message);
  process.exit(1);
}

if (failed) process.exit(1);
console.log('All bundle size checks passed.');
