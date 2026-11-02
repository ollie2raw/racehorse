import { describe, expect, it, vi } from 'vitest';
import { getDailyFritzSeed, type DailyFritzSetGameNumber } from './dailyFritz';
import { dailyFritzSavedGameId, deriveDailyFritzSavedGame, listDailyFritzGames } from './dailyFritzSavedGame';
import type { StoredDailyFritzHandRecord } from './dailyFritzHandRecords';
import { ATTEMPT_ID, RUN_DATE, makeAttempt, run, verifiedGame } from './dailyFritzVerifiedGame.testkit';

vi.mock('@sentry/node', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  startSpan: vi.fn((_opts: unknown, cb: () => unknown) => cb()),
}));
vi.mock('./http/stores/dailyFritzEventStore', () => ({
  recordDailyFritzEvent: vi.fn().mockResolvedValue(undefined),
  countRecentDailyFritzVerificationFailures: vi.fn().mockResolvedValue(0),
}));

const derive = (g: ReturnType<typeof verifiedGame>, gameNumber: DailyFritzSetGameNumber, overrides: Partial<Parameters<typeof deriveDailyFritzSavedGame>[0]> = {}) =>
  deriveDailyFritzSavedGame({ attempt: g.attempt, run, publishedChallenge: null, gameNumber, handRecords: g.rows, ...overrides });

const game1 = verifiedGame(1, 'first_legal');
const game2 = verifiedGame(2, 'last_legal');

describe('deriveDailyFritzSavedGame', () => {
  it('has real multi-hand games to derive from', () => {
    expect(game1.rows.length).toBeGreaterThan(2);
    expect(game2.rows.length).toBeGreaterThan(2);
  });

  it('derives a verified game that is exactly the ledger\'s game, for either game and either draw winner', () => {
    for (const [gameNumber, g] of [[1, game1], [2, game2]] as const) {
      const derived = derive(g, gameNumber);
      if (!derived.ok) throw new Error(derived.reason);
      expect(derived.game).toMatchObject({
        sourceMatchId: dailyFritzSavedGameId(ATTEMPT_ID, gameNumber),
        mode: 'dfz',
        runDate: RUN_DATE,
        gameNumber,
        verification: 'replay_verified',
        opponentName: 'Fritz',
        fritzTier: 'elite',
        inferredStepCount: 0,
        winningScore: 60,
        dealSize: 7,
        result: { you: g.you, opponent: g.fritz, winner: g.you > g.fritz ? 'you' : 'opponent' },
      });
      expect(derived.game.record.hands.length).toBe(g.rows.length);
    }
  });

  it('says a game that is not in the verified ledger is not available', () => {
    expect(derive(game1, 3)).toEqual({ ok: false, reason: 'game_not_verified' });
    const noLedger = { ...game1, attempt: makeAttempt({}) };
    expect(derive(noLedger, 1)).toEqual({ ok: false, reason: 'game_not_verified' });
  });

  it('reports a missing stored hand instead of guessing, and never uses a row whose digest the ledger does not name', () => {
    const lost = game1.rows[1]!;
    expect(derive(game1, 1, { handRecords: game1.rows.filter((r) => r !== lost) })).toEqual({ ok: false, reason: `missing_hand_record:${lost.hand_index}` });
    const wrongDigestOnly = game1.rows.map((r) => (r === lost ? { ...r, transcript_digest: 'f'.repeat(64) } : r));
    expect(derive(game1, 1, { handRecords: wrongDigestOnly })).toEqual({ ok: false, reason: `missing_hand_record:${lost.hand_index}` });
  });

  it('picks the row the ledger names when a hand was verified twice with different evidence', () => {
    const target = game1.rows[1]!;
    const other: StoredDailyFritzHandRecord = { hand_index: target.hand_index, transcript_digest: 'e'.repeat(64), transcript: { not: 'the real one' } };
    const derived = derive(game1, 1, { handRecords: [other, ...game1.rows] });
    expect(derived.ok).toBe(true);
  });

  it('refuses a stored transcript that no longer verifies, and a ledger whose scores differ from the replay', () => {
    const tampered = game1.rows.map((r, i) => (i === 1 ? { ...r, transcript: { ...(r.transcript as object), actions: (r.transcript as { actions: unknown[] }).actions.slice(0, -2) } } : r));
    const bad = derive(game1, 1, { handRecords: tampered });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/^hand_not_replayable:1:/);

    const authority = game1.attempt.result.authority as { hands: unknown[]; games: Array<Record<string, unknown>> };
    const wrongLedger = makeAttempt({ authority: { ...authority, games: authority.games.map((g) => ({ ...g, playerScore: (g.playerScore as number) + 1 })) } });
    expect(derive(game1, 1, { attempt: wrongLedger })).toEqual({ ok: false, reason: 'ledger_score_mismatch' });
  });

  it('turns an attempt-level refusal into a reason instead of throwing', () => {
    const wrongDay = { ...run, runDate: '2026-08-02', seed: getDailyFritzSeed('2026-08-02') };
    const derived = derive(game1, 1, { run: wrongDay });
    expect(derived.ok).toBe(false);
    if (!derived.ok) expect(derived.reason).toMatch(/^hand_not_replayable:0:challenge_mismatch$/);
  });
});

describe('listDailyFritzGames', () => {
  const both = verifiedGame(2, 'last_legal', game1.attempt.result as Record<string, unknown>); // one attempt whose ledger holds games 1 and 2
  const older = { ...both.attempt, id: '33333333-3333-4333-8333-333333333333', runDate: '2026-07-31' };
  const unverified = { ...both.attempt, id: '44444444-4444-4444-8444-444444444444', runDate: '2026-08-02', result: { authority: { version: 1, hands: [], games: [] } } };
  const digests = (attemptId: string, rows: StoredDailyFritzHandRecord[], gameNumber: number) =>
    rows.map((r) => ({ attempt_id: attemptId, game_number: gameNumber, transcript_digest: r.transcript_digest }));

  it('lists verified games newest first (day, then game number), skips attempts with no verified game, and marks which are reviewable', () => {
    const list = listDailyFritzGames([unverified, both.attempt, older], [...digests(ATTEMPT_ID, game1.rows, 1), ...digests(ATTEMPT_ID, game2.rows, 2)]);
    expect(list.map((g) => `${g.runDate}#${g.gameNumber}`)).toEqual([`${RUN_DATE}#2`, `${RUN_DATE}#1`, '2026-07-31#2', '2026-07-31#1']);
    expect(list.map((g) => g.reviewable)).toEqual([true, true, false, false]); // the older attempt's hands were never stored
    expect(list[1]).toMatchObject({ sourceMatchId: dailyFritzSavedGameId(ATTEMPT_ID, 1), hands: game1.rows.length, result: { you: game1.you, opponent: game1.fritz } });
  });

  it('a game missing any one stored hand is not reviewable', () => {
    const list = listDailyFritzGames([both.attempt], [...digests(ATTEMPT_ID, game1.rows.slice(1), 1), ...digests(ATTEMPT_ID, game2.rows, 2)]);
    expect(list.find((g) => g.gameNumber === 1)!.reviewable).toBe(false);
    expect(list.find((g) => g.gameNumber === 2)!.reviewable).toBe(true);
  });
});
