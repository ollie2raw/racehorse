import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
});

import { handleFenceRequest, newFenceStore, jsonResponse } from '../../test/support/cutoverFenceStub';

type Gate = typeof import('./ratingCutoverGate');
let store = newFenceStore();
let gate: Gate;

async function freshGate(legacy = true): Promise<Gate> {
  vi.resetModules();
  const mod = await import('./ratingCutoverGate');
  mod.setLegacyRatingWritersEnforcedForTests(legacy);
  return mod;
}

beforeEach(async () => {
  store = newFenceStore();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) =>
    handleFenceRequest(store, String(input), init) ?? jsonResponse([], 404)));
  gate = await freshGate();
});
afterEach(() => vi.unstubAllGlobals());

describe('rating cutover gate — drain semantics', () => {
  it('is ready immediately when enabled with zero operations in flight', async () => {
    await gate.setRatingCutoverQuiesced(true, 'cutover');
    const status = await gate.getRatingCutoverStatus('sha-old');
    expect(status).toMatchObject({
      quiesced: true, completionsInFlight: 0, deferredGhostWritesInFlight: 0, decayInFlight: false,
      newUnsafeOperationsCanStart: false, readyForExpand: true, enforcement: 'legacy_writers', release: 'sha-old',
    });
  });

  it('is not ready while the gate is open, even with nothing in flight', async () => {
    const status = await gate.getRatingCutoverStatus();
    expect(status.readyForExpand).toBe(false);
    expect(status.newUnsafeOperationsCanStart).toBe(true);
    expect(status.notReadyReasons).toContain('gate is not enabled');
  });

  it('with one operation in flight stays not-ready until that operation ends, and the in-flight unit is not interrupted', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let finished = false;
    const op = gate.withRatingCompletion('one', async () => { await held; finished = true; return 'ok'; });
    await Promise.resolve();

    await gate.setRatingCutoverQuiesced(true, null);
    const during = await gate.getRatingCutoverStatus();
    expect(during.completionsInFlight).toBe(1);
    expect(during.readyForExpand).toBe(false);
    expect(during.notReadyReasons).toContain('1 completion(s) in flight');

    release();
    await expect(op).resolves.toBe('ok');
    expect(finished).toBe(true);
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
  });

  it('drains several simultaneous completions, including ones that fail', async () => {
    const releases: Array<() => void> = [];
    const ops = [0, 1, 2].map((i) => gate.withRatingCompletion(`op${i}`, () =>
      new Promise<void>((resolve, reject) => { releases.push(i === 1 ? () => reject(new Error('boom')) : resolve); })));
    const settled = Promise.allSettled(ops);
    await Promise.resolve();
    await gate.setRatingCutoverQuiesced(true, null);

    expect((await gate.getRatingCutoverStatus()).completionsInFlight).toBe(3);
    releases[0]!();
    expect((await gate.getRatingCutoverStatus()).completionsInFlight).toBe(2);
    releases[1]!();
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(false);
    releases[2]!();
    const results = await settled;
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
  });

  it('rejects a NEW completion after the gate is closed, before it runs anything, and does not count it', async () => {
    await gate.setRatingCutoverQuiesced(true, null);
    const work = vi.fn(async () => 'would-write');
    await expect(gate.withRatingCompletion('late', work)).rejects.toMatchObject({
      code: 'rating_cutover_quiesced', retryable: true,
    });
    expect(work).not.toHaveBeenCalled();
    const status = await gate.getRatingCutoverStatus();
    expect(status.completionsInFlight).toBe(0);
    expect(status.rejectedSinceBoot).toBe(1);
    expect(status.readyForExpand).toBe(true);
  });

  it('a unit that already read the open gate is visible in the count an operator reads after closing it', async () => {
    let release!: () => void;
    const op = gate.withRatingCompletion('racing', () => new Promise<void>((r) => { release = r; }));
    // The fence read is still pending here: the count must already include it.
    expect(gate.getRatingCutoverCountersForTests().completions).toBe(1);
    await Promise.resolve();
    await gate.setRatingCutoverQuiesced(true, null);
    await new Promise((r) => setTimeout(r, 0));
    expect((await gate.getRatingCutoverStatus()).completionsInFlight).toBe(1);
    release();
    await op;
  });

  it('counts a unit even if the HTTP/socket acknowledgement is lost after the work finished', async () => {
    await expect(gate.withRatingCompletion('lost-ack', async () => {
      await Promise.resolve();
      throw new Error('socket hang up while writing response');
    })).rejects.toThrow('socket hang up');
    expect(gate.getRatingCutoverCountersForTests().completions).toBe(0);
  });

  it('fails closed when the durable fence cannot be read', async () => {
    store.unreadable = true;
    const work = vi.fn();
    await expect(gate.withRatingCompletion('x', work)).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
    expect(gate.getRatingCutoverCountersForTests().completions).toBe(0);
    expect(await gate.beginDecayRun()).toBeNull();
    expect(await gate.mayContinueDecay()).toBe(false);
  });
});

describe('rating cutover gate — restart and build behavior', () => {
  it('the fence survives a process restart: a restarted legacy build stays closed and reports not-ready until re-enabled', async () => {
    await gate.setRatingCutoverQuiesced(true, 'cutover');
    const restarted = await freshGate(true);
    await expect(restarted.withRatingCompletion('after-restart', async () => 'x')).rejects.toMatchObject({
      code: 'rating_cutover_quiesced',
    });
    expect(await restarted.beginDecayRun()).toBeNull();
    const status = await restarted.getRatingCutoverStatus();
    expect(status.quiesced).toBe(true);
    expect(status.newUnsafeOperationsCanStart).toBe(false);
    // Drain evidence from before the restart is not evidence about this process.
    expect(status.readyForExpand).toBe(false);
    expect(status.notReadyReasons.join(' ')).toContain('different process');
    await restarted.setRatingCutoverQuiesced(true, 'cutover');
    expect((await restarted.getRatingCutoverStatus()).readyForExpand).toBe(true);
  });

  it('the remediated (atomic) build counts and reports but never blocks, and never reports ready for legacy expand', async () => {
    const atomic = await freshGate(false);
    await atomic.setRatingCutoverQuiesced(true, 'cutover');
    await expect(atomic.withRatingCompletion('atomic', async () => 'ok')).resolves.toBe('ok');
    expect(await atomic.mayContinueDecay()).toBe(true);
    const status = await atomic.getRatingCutoverStatus();
    expect(status.enforcement).toBe('atomic_writers');
    expect(status.readyForExpand).toBe(false);
    expect(status.newUnsafeOperationsCanStart).toBe(false);
  });

  it('keeps a deferred write counted past the end of its owning unit', async () => {
    let release!: () => void;
    await gate.withRatingCompletion('owner', async () => {
      void gate.trackDeferredRatingWork(new Promise<void>((r) => { release = r; }));
    });
    await gate.setRatingCutoverQuiesced(true, null);
    const during = await gate.getRatingCutoverStatus();
    expect(during.completionsInFlight).toBe(0);
    expect(during.deferredGhostWritesInFlight).toBe(1);
    expect(during.readyForExpand).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect((await gate.getRatingCutoverStatus()).readyForExpand).toBe(true);
  });

  it('counts a deferred write that rejects as finished', async () => {
    const deferred = gate.trackDeferredRatingWork(Promise.reject(new Error('fenced')));
    await expect(deferred).rejects.toThrow('fenced');
    expect(gate.getRatingCutoverCountersForTests().deferredGhostWrites).toBe(0);
  });
});
