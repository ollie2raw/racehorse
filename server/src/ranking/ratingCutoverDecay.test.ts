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

const USERS = ['a', 'b', 'c'].map((n) => `${n.repeat(8)}-0000-4000-8000-000000000000`);
const profile = (id: string, rd: number) => ({
  id, username: id, glicko_rating: 1500, glicko_rd: rd, glicko_vol: 0.06, glicko_last_period: null,
  ranked_games_played: 30, peak_rating: 1600, provisional: false,
});

/** The OLD decay: reads RD, later PATCHes it unconditionally. */
function install() {
  const fence = newFenceStore();
  const db = {
    rd: new Map(USERS.map((id) => [id, 120])),
    patches: [] as Array<{ id: string; rd: number }>,
    listReads: 0,
    holdFirstPatch: null as null | Promise<void>,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const fenceResponse = handleFenceRequest(fence, url, init);
    if (fenceResponse) return fenceResponse;
    if (url.includes('/rest/v1/profiles') && method === 'GET' && url.includes('glicko_last_period')) {
      db.listReads += 1;
      return jsonResponse(USERS.map((id) => profile(id, db.rd.get(id)!)));
    }
    if (url.includes('/rest/v1/profiles') && method === 'GET') {
      const id = /id=eq\.([^&]+)/.exec(url)?.[1] ?? USERS[0]!;
      return jsonResponse([profile(id, db.rd.get(id)!)]);
    }
    if (url.includes('/rest/v1/ranked_games') && method === 'GET') return jsonResponse([]);
    if (url.includes('/rest/v1/profiles') && method === 'PATCH') {
      if (db.patches.length === 0 && db.holdFirstPatch) await db.holdFirstPatch;
      const id = /id=eq\.([^&]+)/.exec(url)![1]!;
      const body = JSON.parse(String(init?.body));
      db.patches.push({ id, rd: body.glicko_rd });
      db.rd.set(id, body.glicko_rd); // unconditional
      return jsonResponse([]);
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

describe('OLD weekly decay against the bridge gate', () => {
  it('will not declare drain while a started decay can still PATCH a stale RD, and stops before the next one', async () => {
    const db = install();
    let release!: () => void;
    db.holdFirstPatch = new Promise<void>((r) => { release = r; });
    const decay = runWeeklyRdDecay();
    await settle(); // old decay has read every RD and is about to write
    expect(db.listReads).toBe(1);

    await setRatingCutoverQuiesced(true, 'cutover');
    const during = await getRatingCutoverStatus();
    expect(during.decayInFlight).toBe(true);
    expect(during.readyForExpand).toBe(false);

    release();
    await decay;
    expect(db.patches).toHaveLength(1); // the already-started write; no later stale write
    const after = await getRatingCutoverStatus();
    expect(after.decayInFlight).toBe(false);
    expect(after.readyForExpand).toBe(true);
  });

  it('a new ranked game committing after drain is never overwritten by the old decay', async () => {
    const db = install();
    await setRatingCutoverQuiesced(true, 'cutover');
    db.rd.set(USERS[0]!, 95); // ranked cutover + new transactional game
    await runWeeklyRdDecay();
    expect(db.listReads).toBe(0);
    expect(db.patches).toHaveLength(0);
    expect(db.rd.get(USERS[0]!)).toBe(95);
  });

  it('control: without the gate the stale RD overwrites a newly committed ranked result', async () => {
    const db = install();
    setLegacyRatingWritersEnforcedForTests(false);
    let release!: () => void;
    db.holdFirstPatch = new Promise<void>((r) => { release = r; });
    const decay = runWeeklyRdDecay();
    await settle();
    db.rd.set(USERS[0]!, 95); // new ranked game commits after the decay read
    release();
    await decay;
    expect(db.rd.get(USERS[0]!)).not.toBe(95);
  });

  it('stays closed across a restart and when the fence is unreadable', async () => {
    const db = install();
    await setRatingCutoverQuiesced(true, 'cutover');
    vi.resetModules();
    const restarted = await import('./ratingCutoverGate');
    restarted.setLegacyRatingWritersEnforcedForTests(true);
    expect(await restarted.beginDecayRun()).toBeNull();
    expect(db.listReads).toBe(0);
  });
});
