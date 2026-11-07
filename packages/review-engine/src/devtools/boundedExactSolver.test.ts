import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import {
  buildHandUniverse,
  handOrder,
  liveHandSource,
  recordedHandSource,
  runBounded,
  type HandSource,
  type HandValues,
} from './boundedExactSolver';

/** A synthetic source: hand i has value d[a] = base[a] + noise(i, a); fully deterministic. */
function synthetic(base: number[], playedIndex: number, total: number, noise = (i: number, a: number) => ((i * 7 + a * 13) % 11) / 20 - 0.25): { source: HandSource; hands: HandValues[] } {
  const hands: HandValues[] = Array.from({ length: total }, (_, i) => ({ d: base.map((b, a) => b + noise(i, a)), nodes: base.map((_, a) => 100 + a), ms: 1 }));
  const actionKeys = base.map((_, a) => `a${a}`);
  return { source: recordedHandSource({ actionKeys, playedIndex, hands }), hands };
}

describe('bounded exact engine on a synthetic source', () => {
  it('visiting every hand gives the exact means and an interval of exactly zero (finite-population correction), reason complete, not partial', () => {
    const { source, hands } = synthetic([1, 0, -1], 1, 400);
    const result = runBounded(source, { maxHands: 10_000, earlyStop: false });
    expect(result.reason).toBe('complete');
    expect(result.partial).toBe(false);
    expect(result.handsVisited).toBe(400);
    const exact = [0, 1, 2].map((a) => hands.reduce((s, h) => s + h.d[a]!, 0) / hands.length);
    result.means.forEach((m, a) => expect(m).toBeCloseTo(exact[a]!, 9));
    expect(result.lossInterval[0]).toBeCloseTo(result.lossInterval[1], 12);
    expect(result.loss).toBeCloseTo(exact[0]! - exact[1]!, 9);
  });

  it('stops at the minimum of 20 hands when the played move is clearly best (no loss to resolve), and the strict variant waits for the top move', () => {
    const { source } = synthetic([5, 0, -3], 0, 2000);
    expect(runBounded(source, { maxHands: 2000 }).handsVisited).toBe(20);
    const strict = runBounded(source, { maxHands: 2000, requireTopMove: true });
    expect(strict.reason).toBe('resolved');
    expect(strict.handsVisited).toBeGreaterThanOrEqual(20);
    expect(strict.topIndex).toBe(0);
  });

  it('resolves a clearly-bad played move inside one grade band quickly, and the answer is the right band', () => {
    const { source } = synthetic([8, 0], 1, 2000);
    const result = runBounded(source, { maxHands: 2000 });
    expect(result.reason).toBe('resolved');
    expect(result.grade).toBe('blunder');
    expect(result.handsVisited).toBeLessThan(200);
  });

  it('variant D: a hand cap ends it with the best-so-far verdict and an interval, flagged partial, never with no result', () => {
    const { source } = synthetic([0.3, 0.28, 0], 1, 5000, (i, a) => (((i * 31 + a * 17) % 41) - 20) / 4);
    const result = runBounded(source, { maxHands: 30, earlyStop: false });
    expect(result.reason).toBe('cap');
    expect(result.partial).toBe(true);
    expect(result.handsVisited).toBe(30);
    expect(Number.isFinite(result.lossInterval[0])).toBe(true);
    expect(result.lossInterval[0]).toBeLessThanOrEqual(result.loss);
    expect(result.lossInterval[1]).toBeGreaterThanOrEqual(result.loss);
    expect(result.topIndex).toBeGreaterThanOrEqual(0);
  });

  it('variant D: a time budget does the same (the recorded ms stand in for the wall clock)', () => {
    const { source } = synthetic([0.3, 0.28, 0], 1, 5000, (i, a) => (((i * 31 + a * 17) % 41) - 20) / 4);
    const result = runBounded(source, { maxHands: 5000, maxMs: 25, earlyStop: false });
    expect(result.reason).toBe('time');
    expect(result.partial).toBe(true);
    expect(result.handsVisited).toBe(25);
  });

  it('variant C: racing drops hopeless candidates, never the best or the played move, and saves node work without changing a clear answer', () => {
    const { source } = synthetic([2, 1.9, 0.5, -4, -5], 1, 3000);
    const raced = runBounded(source, { maxHands: 3000, racing: true, requireTopMove: true, halfWidth: 0.05 });
    const plain = runBounded(source, { maxHands: 3000, requireTopMove: true, halfWidth: 0.05 });
    expect(raced.dropped).toBeGreaterThanOrEqual(1);
    expect(raced.nodesSavedShare).toBeGreaterThan(0);
    expect(raced.topIndex).toBe(plain.topIndex);
    expect(raced.grade).toBe(plain.grade);
    expect(raced.ms).toBeLessThanOrEqual(plain.ms);
  });

  it('racing never drops the played move even when it is far behind', () => {
    const { source } = synthetic([6, 5, -8], 2, 3000);
    const result = runBounded(source, { maxHands: 3000, racing: true, halfWidth: 0.001, z: 100 });
    expect(Number.isFinite(result.means[2]!)).toBe(true);
    expect(result.grade).toBe('blunder');
  });
});

describe('on real exact-path positions from the corpus', () => {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
  const universes = replayRecordedSelfPlay(dir)
    .filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount > 0 && evaluation.candidates.length > 1)
    .map(({ snapshot }) => buildHandUniverse(snapshot))
    .filter((universe): universe is NonNullable<typeof universe> => universe !== null && universe.combinations.length >= 21 && universe.combinations.length <= 200)
    .slice(0, 3);

  it('has positions to check', () => {
    expect(universes.length).toBe(3);
  });

  it('the visiting order is a permutation of the distinct hands: every hand exactly once, and the same for the same seed', () => {
    for (const universe of universes) {
      const order = handOrder(universe, 'order-test');
      expect(order).toHaveLength(universe.combinations.length);
      expect(new Set(order).size).toBe(universe.combinations.length);
      expect(handOrder(universe, 'order-test')).toEqual(order);
      expect(handOrder(universe, 'another-seed')).not.toEqual(order);
    }
  });

  it('a complete live run equals the same run replayed from its recording (the offline study and the live engine are one thing)', { timeout: 120_000 }, () => {
    for (const universe of universes) {
      const live = liveHandSource(universe, 'parity');
      const hands: HandValues[] = [];
      const all = new Array<boolean>(live.actions).fill(true);
      for (let i = 0; i < live.total; i += 1) hands.push(live.hand(i, all));
      const replay = recordedHandSource({ actionKeys: live.actionKeys, playedIndex: live.playedIndex, hands });
      const fromLive = runBounded(liveHandSource(universe, 'parity'), { maxHands: 10_000, earlyStop: false });
      const fromRecording = runBounded(replay, { maxHands: 10_000, earlyStop: false });
      expect(fromLive.reason).toBe('complete');
      expect(fromRecording.means).toEqual(fromLive.means);
      expect(fromRecording.topIndex).toBe(fromLive.topIndex);
      expect(fromRecording.loss).toBeCloseTo(fromLive.loss, 12);
    }
  });

  it('a stopped live run agrees with the same prefix of the recording', { timeout: 120_000 }, () => {
    const universe = universes[0]!;
    const live = liveHandSource(universe, 'prefix');
    const all = new Array<boolean>(live.actions).fill(true);
    const hands: HandValues[] = Array.from({ length: live.total }, (_, i) => live.hand(i, all));
    const options = { maxHands: 10_000, requireTopMove: true } as const;
    const a = runBounded(liveHandSource(universe, 'prefix'), options);
    const b = runBounded(recordedHandSource({ actionKeys: live.actionKeys, playedIndex: live.playedIndex, hands }), options);
    expect(b.handsVisited).toBe(a.handsVisited);
    expect(b.reason).toBe(a.reason);
    expect(b.loss).toBeCloseTo(a.loss, 12);
  });
});
