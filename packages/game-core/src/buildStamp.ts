export type GameCoreBuildStamp = {
  /** sha256 over the sorted top-level `src/*.ts` (excluding `*.test.ts`). */
  readonly srcSha256: string;
  /** ISO-8601 timestamp of the build that produced this `dist/`. */
  readonly builtAt: string;
};

// game-core is deliberately browser-safe and carries no `@types/node`; declare
// the CommonJS `require` ambiently and guard every use.
declare const require: ((id: string) => unknown) | undefined;

/**
 * GC-1 (HARDENING_PLAN §7.3): the stamp emitted by
 * `scripts/write-build-stamp.mjs` (`postbuild`) into `dist/buildStamp.data.js`,
 * so a consumer can prove the compiled `dist/` it loaded was built from the
 * committed source.
 *
 * Returns `null` when loaded from `src/` (tests, the client bundle — there is no
 * generated data file there), when `require` is unavailable (browser), or when
 * the stamp is missing. Callers MUST treat `null` as "unverifiable", never as a
 * mismatch.
 */
export function readGameCoreBuildStamp(): GameCoreBuildStamp | null {
  try {
    if (typeof require !== 'function') return null;
    // Resolved at runtime relative to the compiled `dist/buildStamp.js`; the
    // sibling `dist/buildStamp.data.js` is written by the postbuild script.
    const data = require('./buildStamp.data.js') as Partial<GameCoreBuildStamp> | undefined;
    if (data && typeof data.srcSha256 === 'string' && typeof data.builtAt === 'string') {
      return { srcSha256: data.srcSha256, builtAt: data.builtAt };
    }
    return null;
  } catch {
    return null;
  }
}
