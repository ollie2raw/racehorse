import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
});

import { completeGhostGame } from './service';
import { FRITZ_ELITE_ID } from '../ranking/glicko2';
import {
  getRatingCutoverCountersForTests,
  getRatingCutoverStatus,
  resetRatingCutoverGateForTests,
  setLegacyRatingWritersEnforcedForTests,
  setRatingCutoverQuiesced,
  withRatingCompletion,
} from '../ranking/ratingCutoverGate';
import { handleFenceRequest, jsonResponse, newFenceStore } from '../../test/support/cutoverFenceStub';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const MATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fritzInput = (matchId = MATCH_ID) => ({
  userId: USER_ID, opponentUserId: FRITZ_ELITE_ID, finalScore: 60, opponentScore: 10,
  moveLog: [], matchId, applyGlicko: true,
});

/**
 * Models the database around the Ghost expand migration: before it, the old
 * deferred Ghost training PATCH lands; after it, that write is fenced.
 */
function installDatabase() {
  const fence = newFenceStore();
  const db = {
    rankedCommitted: 0,
    rankedPayload: null as Record<string, unknown> | null,
    ghostTrainingLanded: 0,
    ghostTrainingFenced: 0,
    expanded: false,
    // Resolves when set; lets a test pause a specific step mid-flight.
    holdRankedInsert: null as null | Promise<void>,
    holdDeferredGhostWrite: null as null | Promise<void>,
    inFlightSamples: [] as number[],
    calls: [] as string[],
  };
  const sample = () => {
    const c = getRatingCutoverCountersForTests();
    db.inFlightSamples.push(c.completions + c.deferredGhostWrites);
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const fenceResponse = handleFenceRequest(fence, url, init);
    if (fenceResponse) return fenceResponse;
    db.calls.push(`${method} ${url.replace(/^.*\/rest\/v1\//, '')}`);
    if (url.includes('/rest/v1/rpc/complete_ghost_rating_v2')) {
      return jsonResponse({ isNewGame: true, newRating: 827, ratingDelta: 27 });
    }
    if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
      return jsonResponse([{ user_id: USER_ID, ghost_rating: 800, composite_log: null, style_profile: null, games_played: 5 }]);
    }
    if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') return jsonResponse([JSON.parse(String(init?.body))[0]]);
    if (url.includes('/rest/v1/ghost_profiles') && method === 'PATCH') {
      // This is the old Fritz deferred training write.
      if (db.holdDeferredGhostWrite) await db.holdDeferredGhostWrite;
      sample();
      if (db.expanded) { db.ghostTrainingFenced += 1; return jsonResponse({ message: 'ghost_legacy_writer_fenced' }, 400); }
      db.ghostTrainingLanded += 1;
      return jsonResponse([]);
    }
    if (url.includes('/rest/v1/ghost_games') && method === 'GET') return jsonResponse([]);
    if (url.includes('/rest/v1/profiles') && method === 'GET') {
      return jsonResponse([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200, glicko_vol: 0.06, ranked_games_played: 30, peak_rating: 1600, provisional: false }]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'POST') {
      db.rankedCommitted += 1; // durable at this point
      if (db.holdRankedInsert) await db.holdRankedInsert;
      sample();
      db.rankedPayload = JSON.parse(String(init?.body));
      return jsonResponse([{ id: 'rg-1', ...db.rankedPayload }]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'GET') {
      return jsonResponse([{ ...db.rankedPayload, id: 'rg-1', player_id: USER_ID, opponent_id: FRITZ_ELITE_ID, player_score: 60,
        opponent_score: 10, played_at: new Date().toISOString() }]);
    }
    if (url.includes('/rest/v1/rpc/')) return jsonResponse([]);
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }));
  return db;
}

/** What the operator's migration step does: refuses unless the gate reports positive drain. */
async function tryExpand(db: { expanded: boolean }): Promise<{ applied: boolean; reasons: string[] }> {
  const status = await getRatingCutoverStatus();
  if (!status.readyForExpand) return { applied: false, reasons: status.notReadyReasons };
  db.expanded = true;
  return { applied: true, reasons: [] };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  resetRatingCutoverGateForTests();
  setLegacyRatingWritersEnforcedForTests(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRatingCutoverGateForTests();
});

describe('Ghost/Fritz completion straddle (old completion path)', () => {
  it('cannot expand while an old completion has committed ranked but not finished; finishes safely; then expand proceeds and the new path stays correct', async () => {
    const db = installDatabase();
    let releaseRanked!: () => void;
    let releaseDeferred!: () => void;
    db.holdRankedInsert = new Promise<void>((r) => { releaseRanked = r; });
    db.holdDeferredGhostWrite = new Promise<void>((r) => { releaseDeferred = r; });

    // 1-2. old completion begins and its ranked write is durable.
    const completion = withRatingCompletion('old-fritz', () => completeGhostGame(fritzInput()));
    await settle();
    expect(db.rankedCommitted).toBe(1);

    // 3-5. quiescence is enabled; expand is refused.
    await setRatingCutoverQuiesced(true, 'cutover');
    let attempt = await tryExpand(db);
    expect(attempt.applied).toBe(false);
    expect(attempt.reasons).toContain('1 completion(s) in flight');

    // The ranked step finishes; the completion returns but its deferred Ghost write is still pending.
    releaseRanked();
    await completion;
    expect(getRatingCutoverCountersForTests()).toMatchObject({ completions: 0, deferredGhostWrites: 1 });
    attempt = await tryExpand(db);
    expect(attempt.applied).toBe(false);
    expect(attempt.reasons).toContain('1 deferred Ghost write(s) in flight');
    expect(db.expanded).toBe(false);

    // 6-7. the deferred write lands under the OLD schema; in-flight reaches zero.
    releaseDeferred();
    await settle();
    expect(db.ghostTrainingLanded).toBe(1);
    expect(db.ghostTrainingFenced).toBe(0);
    expect(getRatingCutoverCountersForTests()).toMatchObject({ completions: 0, deferredGhostWrites: 0 });

    // No instant between ranked commit and Ghost write was ever uncounted.
    expect(db.inFlightSamples.length).toBeGreaterThanOrEqual(2);
    expect(db.inFlightSamples.every((n) => n > 0)).toBe(true);

    // 8. expand now proceeds.
    attempt = await tryExpand(db);
    expect(attempt).toEqual({ applied: true, reasons: [] });

    // A completion attempted on the old build after the gate closed fails retryably, before any write.
    const rankedBefore = db.rankedCommitted;
    await expect(withRatingCompletion('old-fritz-late', () => completeGhostGame(fritzInput('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))))
      .rejects.toMatchObject({ code: 'rating_cutover_quiesced', retryable: true });
    expect(db.rankedCommitted).toBe(rankedBefore);

    // 9. the new server (atomic path) completes and a duplicate retry is served by the same atomic RPC.
    setLegacyRatingWritersEnforcedForTests(false);
    db.holdRankedInsert = null;
    const first = await completeGhostGame(fritzInput('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    const retry = await completeGhostGame(fritzInput('cccccccc-cccc-4ccc-8ccc-cccccccccccc'));
    expect(first.newRating).toBe(827);
    expect(retry.newRating).toBe(first.newRating);
    expect(db.calls.filter((c) => c.includes('rpc/complete_ghost_rating_v2'))).toHaveLength(3);
  });

  it('the exact vulnerable sequence without the gate is what the fence would silently lose (control)', async () => {
    const db = installDatabase();
    setLegacyRatingWritersEnforcedForTests(false);
    let releaseDeferred!: () => void;
    db.holdDeferredGhostWrite = new Promise<void>((r) => { releaseDeferred = r; });
    await completeGhostGame(fritzInput()); // ranked committed, success returned
    db.expanded = true; // expand lands in the straddle window
    releaseDeferred();
    await settle();
    expect(db.rankedCommitted).toBe(1);
    expect(db.ghostTrainingFenced).toBe(1); // training write fenced and dropped, completion already reported success
  });

  it('enabling with zero operations is immediately drained; with several simultaneous completions it waits for all', async () => {
    const db = installDatabase();
    await setRatingCutoverQuiesced(true, null);
    expect((await tryExpand(db)).applied).toBe(true);

    await setRatingCutoverQuiesced(false, null);
    db.expanded = false;
    resetRatingCutoverGateForTests();
    setLegacyRatingWritersEnforcedForTests(true);
    const releases: Array<() => void> = [];
    db.holdRankedInsert = new Promise<void>((r) => { releases.push(r); });
    const matches = ['1', '2', '3'].map((n) => `${n}${n}${n}${n}${n}${n}${n}${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`);
    const ops = matches.map((m) => withRatingCompletion('many', () => completeGhostGame(fritzInput(m))));
    await settle();
    await setRatingCutoverQuiesced(true, null);
    expect(getRatingCutoverCountersForTests().completions).toBe(3);
    expect((await tryExpand(db)).applied).toBe(false);
    releases[0]!();
    await Promise.all(ops);
    await settle();
    expect(getRatingCutoverCountersForTests()).toMatchObject({ completions: 0, deferredGhostWrites: 0 });
    expect((await tryExpand(db)).applied).toBe(true);
  });

  it('a lost acknowledgement after a durable ranked commit is still counted until the deferred write finishes', async () => {
    const db = installDatabase();
    let releaseDeferred!: () => void;
    db.holdDeferredGhostWrite = new Promise<void>((r) => { releaseDeferred = r; });
    await expect(withRatingCompletion('lost-ack', async () => {
      await completeGhostGame(fritzInput());
      throw new Error('socket hang up before the response was written');
    })).rejects.toThrow('socket hang up');
    await setRatingCutoverQuiesced(true, null);
    expect((await tryExpand(db)).applied).toBe(false);
    releaseDeferred();
    await settle();
    expect((await tryExpand(db)).applied).toBe(true);
  });

  it('a restart while the gate is intended closed leaves the new process closed and unverified', async () => {
    installDatabase();
    await setRatingCutoverQuiesced(true, 'cutover');
    // Simulated restart: counters are gone, the durable row remains.
    resetRatingCutoverGateForTests();
    setLegacyRatingWritersEnforcedForTests(true);
    await expect(withRatingCompletion('post-restart', async () => 'x')).rejects.toMatchObject({
      code: 'rating_cutover_quiesced',
    });
  });
});
