/**
 * The hand lifecycle fuzzer's tests: the properties (P1-P5) and the scenarios they are held under. The model and the properties themselves are in
 * handLifecycleFuzzWorld.ts, so a failure here reproduces from its seed alone (`runWorld(seed, options)`).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, runWorld, type FuzzOptions } from './handLifecycleFuzzWorld';

// ── the tests ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const envSeeds = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.HAND_LIFECYCLE_FUZZ_SEEDS;
/** HAND_LIFECYCLE_FUZZ_SEEDS=5000 for a long run; the default is quick enough for CI. */
const SEEDS = Number(envSeeds ?? 150);

function report(seed: number, result: ReturnType<typeof runWorld>): string {
  return [`seed ${seed}`, ...result.violations.map((v) => `${v.property} @${Math.round(v.at)}ms: ${v.detail}`), '--- trace tail ---', ...result.trace.slice(-40)].join('\n');
}

/** The scenarios the properties are held under. Each is run over SEEDS seeds. */
const SCENARIOS: Record<string, Partial<FuzzOptions>> = {
  'echoes, disconnects, resyncs and taps (the default)': {},
  'a flaky connection (a disconnect every 6 s)': { disconnectEveryMs: 6_000 },
  'a reconnect that always clears the reveal': { reconnectClearsReveal: 1 },
  'a reconnect that never clears the reveal': { reconnectClearsReveal: 0 },
  'a player who never taps Continue (the countdown does it)': { tapRate: 0 },
  'a player who always taps Continue, on a flaky connection': { tapRate: 1, disconnectEveryMs: 10_000 },
  'state updates silently dropped by the client (the dimmed-tiles scenario)': { silentDropRate: 0.05 },
  'state updates silently dropped on a flaky connection': { silentDropRate: 0.2, disconnectEveryMs: 8_000 },
};

describe('the hand lifecycle fuzzer', () => {
  it('is deterministic: a seed gives the same run', () => {
    const a = runWorld(7);
    const b = runWorld(7);
    expect(b.events).toBe(a.events);
    expect(b.trace).toEqual(a.trace);
  });

  it('plays whole matches', () => {
    const result = runWorld(11, { ...DEFAULT_OPTIONS, disconnectEveryMs: 0 });
    expect(result.hands).toBeGreaterThanOrEqual(2);
  });

  for (const [name, overrides] of Object.entries(SCENARIOS)) {
    it(`holds P1-P5 with ${name}`, { timeout: 120_000 }, () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed++) {
        const result = runWorld(seed, { ...DEFAULT_OPTIONS, ...overrides });
        if (result.violations.length > 0) failures.push(report(seed, result));
      }
      expect(failures.slice(0, 2).join('\n\n')).toBe('');
    });
  }
});
