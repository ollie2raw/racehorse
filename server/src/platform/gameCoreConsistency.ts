import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { readGameCoreBuildStamp, type GameCoreBuildStamp } from '@racehorse/game-core/build-stamp';

/**
 * GC-1 / GC-9 (HARDENING_PLAN §7.3). The server prod runtime loads
 * `@racehorse/game-core` from its compiled `dist/`; every test path and the
 * client bundle load `src/`. Nothing else asserts that the `dist/` running in
 * prod was built from the committed source. This recomputes the source hash
 * from `packages/game-core/src` on disk (present in the Render checkout — the
 * build does not prune source) and compares it to the hash the build stamped
 * into `dist/`.
 */
export type GameCoreConsistency = {
  /** true = dist matches src; false = MISMATCH; 'unverifiable' = no stamp or no src on disk. */
  consistent: true | false | 'unverifiable';
  reason: 'match' | 'sha-mismatch' | 'no-build-stamp' | 'no-src';
  srcSha256: string | null;
  distSrcSha256: string | null;
  builtAt: string | null;
  /** GC-9: whether the game-state corruption guard is downgraded to log-only in this process. */
  softInvariants: boolean;
};

// From `{server/src,server/dist}/platform/` up to the repo root, then into the package.
const DEFAULT_SRC_DIR = path.resolve(__dirname, '../../../packages/game-core/src');

/**
 * Hash contract — mirrored EXACTLY by
 * `packages/game-core/scripts/write-build-stamp.mjs`: sorted top-level `*.ts`
 * (excluding `*.test.ts`), each contribution = filename + NUL + raw bytes + NUL.
 */
export function hashGameCoreSrc(srcDir: string): string | null {
  try {
    const files = readdirSync(srcDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .sort();
    if (files.length === 0) return null;
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(file);
      hash.update('\0');
      hash.update(readFileSync(path.join(srcDir, file)));
      hash.update('\0');
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function resolveGameCoreConsistency(deps?: {
  stamp?: GameCoreBuildStamp | null;
  srcDir?: string;
  softInvariants?: boolean;
}): GameCoreConsistency {
  const stamp = deps && 'stamp' in deps ? deps.stamp ?? null : readGameCoreBuildStamp();
  const srcDir = deps?.srcDir ?? DEFAULT_SRC_DIR;
  const softInvariants = deps?.softInvariants ?? process.env.SOFT_GAME_INVARIANTS === 'true';

  const srcSha256 = hashGameCoreSrc(srcDir);
  const distSrcSha256 = stamp?.srcSha256 ?? null;
  const builtAt = stamp?.builtAt ?? null;
  const base = { srcSha256, distSrcSha256, builtAt, softInvariants };

  if (!stamp) return { ...base, consistent: 'unverifiable', reason: 'no-build-stamp' };
  if (!srcSha256) return { ...base, consistent: 'unverifiable', reason: 'no-src' };
  if (srcSha256 === distSrcSha256) return { ...base, consistent: true, reason: 'match' };
  return { ...base, consistent: false, reason: 'sha-mismatch' };
}

let cached: GameCoreConsistency | null = null;

/**
 * Cached — the on-disk `src/`, the `dist/` stamp and `SOFT_GAME_INVARIANTS`
 * cannot change during the process lifetime, so `/ready` need not re-hash on
 * every hit.
 */
export function getGameCoreConsistency(): GameCoreConsistency {
  if (!cached) cached = resolveGameCoreConsistency();
  return cached;
}

/** For `/ready` — a compact projection. */
export function gameCoreReadyReport(c: GameCoreConsistency = getGameCoreConsistency()) {
  return {
    consistent: c.consistent,
    reason: c.reason,
    srcSha256: c.srcSha256 ? c.srcSha256.slice(0, 12) : null,
    builtAt: c.builtAt,
    softInvariants: c.softInvariants,
  };
}
