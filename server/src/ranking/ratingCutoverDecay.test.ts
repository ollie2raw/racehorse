import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-service-key';
});

import { runWeeklyRdDecay } from './cron';
import {
  getRatingCutoverStatus,
  resetRatingCutoverGateForTests,
  setLegacyRatingWritersEnforcedForTests,
  setRatingCutoverQuiesced,
} from './ratingCutoverGate';
import { handleFenceRequest, jsonResponse, newFenceStore } from '../../test/support/cutoverFenceStub';

const USERS = ['u1', 'u2', 'u3'].map((n) => `${n.repeat(1)}0000000-0000-4000-8000-000000000000`);
const profile = (id: string, rd: number) => ({
  id, username: id, glicko_rating: 1500, glicko_rd: rd, glicko_vol: 0.06, glicko_last_period: null,
  ranked_games_played: 30, peak_rating: 1600, provisional: false,
});

function install() {
  const fence = newFenceStore();
  const db = {
    // The committed RD per user; a "new ranked game" changes it after the decay read.
    rd: new Map(USERS.map((id) => [id, 120])),
    decayWrites: [] as Array<Record<string, unknown>>,
    profileListReads: 0,
    holdFirstDecayWrite: null as null | Promise<void>,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const fenceResponse = handleFenceRequest(fence, url, init);
    if (fenceResponse) return fenceResponse;
    if (url.includes('/rest/v1/profiles') && method === 'GET' && url.includes('glicko_last_period')) {
      db.profileListReads += 1;
      // The sweep reads every inactive profile up front, with the RD it sees NOW.
      return jsonResponse(USERS.map((id) => profile(id, db.rd.get(id)!)));
    }
    if (url.includes('/rest/v1/profiles') && method === 'GET') {
      const id = /id=eq\.([^&]+)/.exec(url)?.[1] ?? USERS[0]!;
      return jsonResponse([profile(id, db.rd.get(id)!)]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'GET') return jsonResponse([]);
    if (url.includes('/rpc/commit_glicko_decay_update')) {
      const body = JSON.parse(String(init?.body));
      if (db.decayWrites.length === 0 && db.holdFirstDecayWrite) await db.holdFirstDecayWrite;
      // New conditional decay: stale expected state conflicts instead of overwriting.
      if (body.p_rd_before !== db.rd.get(body.p_profile_id)) {
        return jsonResponse({ message: 'ranked_state_conflict', code: 'P0001' }, 400);
      }
      db.decayWrites.push(body);
      db.rd.set(body.p_profile_id, body.p_new_rd);
      return jsonResponse({});
    }
    return jsonResponse([]);
  }));
  return db;
}

const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  resetRatingCutoverGateForTests();
  setLegacyRatingWritersEnforcedForTests(true);
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetRatingCutoverGateForTests();
});

describe('legacy weekly decay overlap with the ranked cutover', () => {
  it('refuses to declare drain while a started decay can still write, stops it before the next stale write, then drains', async () => {
    const db = install();
    let release!: () => void;
    db.holdFirstDecayWrite = new Promise<void>((r) => { release = r; });

    // 1-2. old decay begins and has read the old RD for every user.
    const decay = runWeeklyRdDecay();
    await settle();
    expect(db.profileListReads).toBe(1);

    // 3-5. cutover activates; readiness is refused because stale decay work can still write.
    await setRatingCutoverQuiesced(true, 'cutover');
    const during = await getRatingCutoverStatus();
    expect(during.decayInFlight).toBe(true);
    expect(during.readyForExpand).toBe(false);
    expect(during.notReadyReasons).toContain('weekly decay in flight');

    // 6. the in-progress write completes; the job notices the closed gate before the next stale write.
    release();
    await decay;
    expect(db.decayWrites).toHaveLength(1);
    const after = await getRatingCutoverStatus();
    expect(after.decayInFlight).toBe(false);
    expect(after.readyForExpand).toBe(true);
  });

  it('prevents a fresh old decay from starting while the gate is closed', async () => {
    const db = install();
    await setRatingCutoverQuiesced(true, 'cutover');
    await runWeeklyRdDecay();
    expect(db.profileListReads).toBe(0);
    expect(db.decayWrites).toHaveLength(0);
    expect((await getRatingCutoverStatus()).decayInFlight).toBe(false);
  });

  it('does not let a stale RD be written after a new ranked game commits (cutover order is safe)', async () => {
    const db = install();
    await setRatingCutoverQuiesced(true, 'cutover');
    // Expand + new server: a ranked game commits and moves RD while the old decay is fenced out.
    db.rd.set(USERS[0]!, 95);
    await runWeeklyRdDecay();
    expect(db.rd.get(USERS[0]!)).toBe(95);
  });

  it('after resume on the new server, decay is conditional: a user whose RD changed after the read is skipped, not overwritten', async () => {
    const db = install();
    setLegacyRatingWritersEnforcedForTests(false); // remediated build
    await setRatingCutoverQuiesced(true, 'still closed while new server is verified');
    let release!: () => void;
    db.holdFirstDecayWrite = new Promise<void>((r) => { release = r; });
    const decay = runWeeklyRdDecay();
    await settle();
    // A ranked game for the SECOND user commits between the sweep's read and that user's decay.
    db.rd.set(USERS[1]!, 77);
    release();
    await decay;
    expect(db.rd.get(USERS[1]!)).toBe(77);
    expect(db.decayWrites.map((w) => w.p_profile_id)).not.toContain(USERS[1]);
    expect(db.decayWrites.length).toBeGreaterThanOrEqual(1);
  });

  it('a decay scheduled while the fence is unreadable does not start', async () => {
    const db = install();
    // Fence unreadable is simulated by closing it AND failing reads.
    const fetchMock = vi.mocked(fetch);
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) =>
      String(input).includes('rating_cutover_gate') ? jsonResponse({ message: 'down' }, 500) : original(input, init));
    await runWeeklyRdDecay();
    expect(db.profileListReads).toBe(0);
  });
});
