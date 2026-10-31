import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const LIMITS = {
  // Individual chunk limits (bytes)
  'AppRoutes': 200_000,      // was 1.4MB, now 73kB — guard against regression
  // A3 pulled reviewContracts into the match path via live snapshot capture.
  // +4 kB (2026-10-03): on-demand review start + funnel counter added 1.1 kB
  // when the chunk was already at 259.2 kB of 260 kB.
  // +4 kB (2026-10-23): Journey attempt recording on the match path (useJourneyTrialAttempt -> journeyAttempts /
  // journeyMatchOutcome / pending completions, plus the Journey HUD chip). Measured: the release branch tip was
  // 263.4 kB of 264 kB; the Journey work adds ~2.5 kB. Lesson content, the resolver and the lesson controller are NOT in
  // this chunk (journeyModuleBoundary.test.ts pins that).
  // +3 kB (2026-10-31): the staged deal's shell (components/deal/useHandDeal + the pick-a-tile pile recorder + the
  // dealGate that makes Fritz wait for it). Measured: main's chunk is 267,288 B of 268,000 B and the shell adds ~2.3 kB.
  // The staging itself (dealRuntime: choreography, scramble, cards, ~7 kB) is a SEPARATE lazily-loaded chunk, fetched
  // when the match screen mounts, so it is not counted here and does not weigh on the match screen's first load.
  'BotMatchScreen': 271_000,
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
