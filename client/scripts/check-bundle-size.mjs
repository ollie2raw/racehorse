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
  // +4 kB (2026-11-01): the review overhaul puts the finished-game path on the match screen: the Analyze-again retry and
  // durable review save in usePostGamePivotalReview (now 11.2 kB of the chunk) and useGameRecordSave (0.8 kB). Measured:
  // the chunk is 268.8 kB against the previous 268.0 kB limit; the only review code left in it is the hooks, because the
  // outboxes, the record builder and the API calls live in the main bundle (App flushes them on load). The games
  // archive and the review-from-record screen are separate lazy routes and must NOT be imported by the match path.
  'BotMatchScreen': 272_000,
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
