// @vitest-environment jsdom
/**
 * The next-hand request that goes out when the hand-end reveal appears must carry exactly what the request at the end of the reveal
 * always carried: the hand's whole transcript (down to its last command) and the scores after the hand's own scoring. These tests
 * use the real engine (a real journal and real scores for hands that end by domino-out, blocked and a scoring finish), the real
 * transcript and request builders, and replace only the HTTP client, so they compare the bytes that would go on the wire.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchLifecycleController } from '../controllers/MatchLifecycleController.ts';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { UseHandLifecycleArgs } from '../hand-lifecycle/types.ts';
import { HandPrefetchCoordinator } from '../hand-lifecycle/handPrefetchCoordinator.ts';
import { buildDailyFritzPrefetchParams } from '../hand-lifecycle/dailyFritzHandService.ts';
import { findHand, type HandEndKind, type PlayedHand } from './earlyBodyFixtures.ts';

const wire = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../../api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/client')>()),
  apiPost: (...args: unknown[]) => wire.post(...args),
}));
vi.mock('../hand-lifecycle/useHandLifecycleWatchdogs.ts', () => ({ useHandLifecycleWatchdogs: () => undefined }));

const { useHandLifecycle } = await import('./useHandLifecycle.ts');

const NEXT_HAND = '/api/daily-fritz/next-hand';
const HAND_INDEX = 0;
const pkg = {
  attempt_id: 'attempt-1',
  verified_match_id: 'match-1',
  run_date: '2026-11-14',
  current_game_number: 1,
  winning_score: 60,
  challenge_id: 'challenge-1',
  verification_status: 'verified',
  verification_protocol_version: 2,
  fritz_policy_version: 1,
  set_result: null,
};

type WireBody = {
  completed_hand_index: number;
  completed_hand_scores: { you: number; fritz: number };
  transcript: { actions: Array<{ actor: string; kind: string; tile?: unknown }> };
};

/** The bodies of every next-hand request that reached the (replaced) HTTP client, as the exact JSON that would be sent. */
const nextHandBodies = () => wire.post.mock.calls
  .filter(([path]) => path === NEXT_HAND)
  .map(([, body]) => JSON.stringify(body));

const parsed = (json: string) => JSON.parse(json) as WireBody;

/** What the request at the end of the reveal always sent: the same builders, run on the settled hand. */
function bodyTheOldAdvanceSent(final: BotMatchState): string {
  wire.post.mockClear();
  void new HandPrefetchCoordinator().ensureRequest(
    buildDailyFritzPrefetchParams(pkg as never, HAND_INDEX, final, [], 2),
    'advance-fetch',
  );
  return nextHandBodies()[0];
}

/** Throws unless `json` carries the hand's last command and the scores after its scoring. */
function expectCompleteBody(json: string, hand: PlayedHand): void {
  const body = parsed(json);
  const journal = hand.final.officialJournal!.actions;
  expect(body.completed_hand_index).toBe(HAND_INDEX);
  // every command of the hand, including the last one
  expect(body.transcript.actions).toHaveLength(journal.length);
  const lastKinds = body.transcript.actions.slice(-2).map((action) => `${action.actor}:${action.kind}`);
  if (hand.kind === 'blocked') {
    expect(lastKinds.every((entry) => entry.endsWith(':pass'))).toBe(true); // both trailing passes of the block
    expect(new Set(lastKinds).size).toBe(2);
  } else {
    expect(lastKinds.at(-1)).toMatch(/:play$/); // the play that ended the hand
  }
  // the scores after the hand's own scoring
  expect(body.completed_hand_scores).toEqual({ you: hand.final.players.you.score, fritz: hand.final.players.bot.score });
  if (hand.kind === 'scoring-finish') {
    const scorer = hand.last.scored!.player === 'you' ? 'you' : 'bot';
    const gained = hand.final.players[scorer].score - hand.beforeLast.players[scorer].score;
    expect(gained).toBeGreaterThanOrEqual(hand.last.scored!.points);
    expect(body.completed_hand_scores[scorer === 'you' ? 'you' : 'fritz']).toBe(hand.final.players[scorer].score);
  }
}

function setupDaily(hand: PlayedHand, matchAtHandEnd: BotMatchState) {
  const matchRef = { current: matchAtHandEnd };
  const lifecycle = { transition: vi.fn(), onHandEndedFromBotAction: vi.fn() };
  const args = {
    match: hand.final,
    setMatch: vi.fn(),
    matchRef,
    lifecycle: lifecycle as unknown as MatchLifecycleController,
    mode: 'dailyFritz',
    isDailyFritzMode: true,
    isGuidedMode: false,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
    isAuthoringMode: false,
    isMuted: true,
    opponentLabel: 'Fritz',
    dailyFritzPackage: pkg,
    dailyFritzTranscriptProtocolVersion: 2,
    dailyFritzHandIndex: HAND_INDEX,
    dailyFritzAuthorityRevision: 0,
    applyDailyFritzNextHand: vi.fn(),
    initialDailyFritzHandResult: null,
    setDailyFritzHandResult: vi.fn(),
    frozenV2Lesson: null,
    frozenLesson: null,
    fritzV2LastAppliedIndexRef: { current: -1 },
    setGuidedV2EventIndex: vi.fn(),
    setIsGuidedV2OffLine: vi.fn(),
    lastDailyFlowLabelRef: { current: '' },
    getMoveLog: () => [],
    ports: {
      invalidateLocalRuns: vi.fn(), flashLastPlayed: vi.fn(), setSelectedTile: vi.fn(), setLastBotChoice: vi.fn(), pushToast: vi.fn(),
      showScoreToast: vi.fn(), showBoardToast: vi.fn(), captureGuidedMatchCandidateNextHand: vi.fn(),
    },
  } as unknown as UseHandLifecycleArgs;
  const view = renderHook(() => useHandLifecycle(args));
  return { ...view, matchRef };
}

const REVEAL_UP_MS = 3_000;
const KINDS: HandEndKind[] = ['domino-out', 'blocked', 'scoring-finish'];

beforeEach(() => {
  wire.post.mockReset();
  wire.post.mockReturnValue(new Promise(() => undefined)); // the body is captured on the way out; the answer does not matter here
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe.each(KINDS)('the early next-hand request for a hand that ends by %s', (kind) => {
  const hand = findHand(kind);

  it('really is a hand of that kind (the fixture is what the test says it is)', () => {
    expect(hand.final.handOver).toBe(true);
    if (kind === 'blocked') expect(hand.last.handEnded?.reason).toBe('blocked');
    if (kind === 'domino-out') expect(hand.last.handEnded?.reason).toBe('domino');
    if (kind === 'scoring-finish') {
      expect(hand.last.handEnded?.reason).toBe('domino');
      expect(hand.last.scored?.points ?? 0).toBeGreaterThan(0);
    }
  });

  it('is byte-for-byte the request the end of the reveal used to send', async () => {
    const { result } = setupDaily(hand, hand.final);
    act(() => result.current.notifyBotActionResult(hand.last));
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_UP_MS); });
    const early = nextHandBodies();
    expect(early).toHaveLength(1);
    expect(early[0]).toBe(bodyTheOldAdvanceSent(hand.final));
    expectCompleteBody(early[0], hand);
  });

  it('carries the final move and the hand-end scoring even when the last write only lands after the hand-end callback', async () => {
    // At hand end the state the screen holds is still the one before the last command (the race 7ff0a587 fixed); it settles later.
    const { result, matchRef } = setupDaily(hand, hand.beforeLast);
    act(() => result.current.notifyBotActionResult(hand.last));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    matchRef.current = hand.final;
    expect(nextHandBodies()).toHaveLength(0); // nothing is sent at hand end
    await act(async () => { await vi.advanceTimersByTimeAsync(REVEAL_UP_MS); });
    const early = nextHandBodies();
    expect(early).toHaveLength(1);
    expectCompleteBody(early[0], hand);
  });

  it('would be caught if the early body were built one command too soon (missing the final move and its scoring)', () => {
    const tooSoon = bodyTheOldAdvanceSent(hand.beforeLast);
    expect(() => expectCompleteBody(tooSoon, hand)).toThrow();
  });
});
