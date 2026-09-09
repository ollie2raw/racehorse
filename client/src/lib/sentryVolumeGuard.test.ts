import { describe, expect, it } from 'vitest';
import {
  createSentryVolumeGuard,
  sentryEventSignature,
  type VolumeGuardEvent,
} from './sentryVolumeGuard';

const err = (type: string, value: string): VolumeGuardEvent => ({
  exception: { values: [{ type, value }] },
});

describe('sentryEventSignature', () => {
  it('prefers an explicit fingerprint', () => {
    expect(sentryEventSignature({ fingerprint: ['a', 'b'], message: 'ignored' })).toBe('a|b');
  });
  it('falls back to exception type + a message slice', () => {
    expect(sentryEventSignature(err('TypeError', 'x is not a function'))).toBe('TypeError:x is not a function');
  });
  it('falls back to the top-level message', () => {
    expect(sentryEventSignature({ message: 'plain string' })).toBe(':plain string');
  });
  it('truncates a long value so a variable suffix does not defeat grouping', () => {
    const long = 'boom ' + 'x'.repeat(500);
    expect(sentryEventSignature(err('E', long)).length).toBeLessThanOrEqual(130);
  });
});

describe('createSentryVolumeGuard', () => {
  const cfg = { windowMs: 60_000, globalMax: 10, perSignatureMax: 3, sampleEvery: 5 };

  it('forwards everything under both caps', () => {
    const g = createSentryVolumeGuard(cfg);
    for (let i = 0; i < 3; i += 1) {
      expect(g.shouldForward(err('A', `msg ${i}`), 1000)).toBe(true);
    }
  });

  it('caps one noisy signature and then only heartbeats past it', () => {
    const g = createSentryVolumeGuard(cfg);
    const results: boolean[] = [];
    for (let i = 0; i < 12; i += 1) results.push(g.shouldForward(err('Loop', 'same'), 1000));
    // first 3 forwarded, then only every 5th (seen == 5, 10) as a heartbeat
    expect(results.slice(0, 3)).toEqual([true, true, true]);
    expect(results.filter(Boolean)).toHaveLength(3 + 2);
  });

  it('a capped signature only spends its first perSignatureMax against the global budget', () => {
    const g = createSentryVolumeGuard(cfg);
    for (let i = 0; i < 100; i += 1) g.shouldForward(err('Loop', 'same'), 1000);
    // The loop's first 3 (perSignatureMax) counted; the ~19 heartbeats past the
    // cap did not — so other errors still have globalMax - perSignatureMax left.
    let realForwarded = 0;
    for (let i = 0; i < 20; i += 1) {
      if (g.shouldForward(err('Real', `distinct ${i}`), 1000)) realForwarded += 1;
    }
    expect(realForwarded).toBe(cfg.globalMax - cfg.perSignatureMax);
  });

  it('bounds a diverse storm at globalMax forwarded events', () => {
    const g = createSentryVolumeGuard(cfg);
    let forwarded = 0;
    for (let i = 0; i < 50; i += 1) {
      if (g.shouldForward(err('Storm', `unique ${i}`), 1000)) forwarded += 1;
    }
    expect(forwarded).toBe(cfg.globalMax);
  });

  it('resets when the window rolls over', () => {
    const g = createSentryVolumeGuard(cfg);
    for (let i = 0; i < 50; i += 1) g.shouldForward(err('X', `a ${i}`), 1000);
    expect(g.shouldForward(err('X', 'a new'), 1000)).toBe(false);
    // next window
    expect(g.shouldForward(err('X', 'a new'), 1000 + cfg.windowMs)).toBe(true);
  });
});
