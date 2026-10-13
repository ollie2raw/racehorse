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

/** The OLD Fritz path against a database that the Ghost expand migration will fence. */
function installDatabase() {
  const fence = newFenceStore();
  const db = {
    rankedCommitted: 0,
    ghostTrainingLanded: 0,
    ghostTrainingFenced: 0,
    expanded: false,
    holdRankedInsert: null as null | Promise<void>,
    holdDeferredGhostWrite: null as null | Promise<void>,
    inFlightSamples: [] as number[],
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
    if (url.includes('/rest/v1/ghost_profiles') && method === 'GET') {
      return jsonResponse([{ user_id: USER_ID, ghost_rating: 800, composite_log: null, style_profile: null, games_played: 5 }]);
    }
    if (url.includes('/rest/v1/ghost_profiles') && method === 'POST') return jsonResponse([JSON.parse(String(init?.body))[0]]);
    if (url.includes('/rest/v1/ghost_profiles') && method === 'PATCH') return jsonResponse([]);
    if (url.includes('/rest/v1/ghost_games') && method === 'POST') {
      // The old deferred Ghost training write begins here.
      if (db.holdDeferredGhostWrite) await db.holdDeferredGhostWrite;
      sample();
      if (db.expanded) { db.ghostTrainingFenced += 1; return jsonResponse({ message: 'ghost_legacy_writer_fenced' }, 400); }
      db.ghostTrainingLanded += 1;
      return jsonResponse([{ id: 'game-1', xmax: '0' }]);
    }
    if (url.includes('/rest/v1/ghost_games') && method === 'GET') return jsonResponse([]);
    if (url.includes('/rest/v1/profiles') && method === 'GET') {
      return jsonResponse([{ id: USER_ID, glicko_rating: 1500, glicko_rd: 200, ranked_games_played: 30, peak_rating: 1600, provisional: false }]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'POST') {
      db.rankedCommitted += 1;
      if (db.holdRankedInsert) await db.holdRankedInsert;
      sample();
      return jsonResponse([{ id: 'rg-1', player_id: USER_ID, source_match_id: MATCH_ID }]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'GET') {
      return jsonResponse([{ id: 'rg-1', player_id: USER_ID, opponent_id: FRITZ_ELITE_ID, player_score: 60,
        opponent_score: 10, played_at: new Date().toISOString() }]);
    }
    return jsonResponse([]);
  }));
  return db;
}

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

describe('OLD Fritz completion straddle against the bridge gate', () => {
  it('cannot expand between ranked commit and the deferred Ghost write; expands only after both finish', async () => {
    const db = installDatabase();
    let releaseRanked!: () => void;
    let releaseDeferred!: () => void;
    db.holdRankedInsert = new Promise<void>((r) => { releaseRanked = r; });
    db.holdDeferredGhostWrite = new Promise<void>((r) => { releaseDeferred = r; });

    const completion = withRatingCompletion('old-fritz', () => completeGhostGame(fritzInput()));
    await settle();
    expect(db.rankedCommitted).toBe(1);

    await setRatingCutoverQuiesced(true, 'cutover');
    expect((await tryExpand(db)).reasons).toContain('1 completion(s) in flight');

    releaseRanked();
    await completion; // the old path has reported success to its caller
    await settle();
    expect(getRatingCutoverCountersForTests()).toMatchObject({ completions: 0, deferredGhostWrites: 1 });
    const blocked = await tryExpand(db);
    expect(blocked.applied).toBe(false);
    expect(blocked.reasons).toContain('1 deferred Ghost write(s) in flight');
    expect(db.expanded).toBe(false);

    releaseDeferred();
    await settle();
    expect(db.ghostTrainingLanded).toBe(1);
    expect(db.ghostTrainingFenced).toBe(0);
    expect(db.inFlightSamples.every((n) => n > 0)).toBe(true);
    expect((await tryExpand(db)).applied).toBe(true);

    const before = db.rankedCommitted;
    await expect(withRatingCompletion('late', () => completeGhostGame(fritzInput('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'))))
      .rejects.toMatchObject({ code: 'rating_cutover_quiesced' });
    expect(db.rankedCommitted).toBe(before);
  });

  it('control: without the gate the same sequence silently loses the Ghost write after success was reported', async () => {
    const db = installDatabase();
    setLegacyRatingWritersEnforcedForTests(false);
    let releaseDeferred!: () => void;
    db.holdDeferredGhostWrite = new Promise<void>((r) => { releaseDeferred = r; });
    await completeGhostGame(fritzInput());
    db.expanded = true;
    releaseDeferred();
    await settle();
    expect(db.rankedCommitted).toBe(1);
    expect(db.ghostTrainingFenced).toBe(1);
  });
});
