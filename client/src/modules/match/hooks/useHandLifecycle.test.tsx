// @vitest-environment jsdom
/**
 * useHandLifecycle is where hand-end, advance and recovery races live (code-health audit: 888 lines, no direct test). These
 * tests drive it the way the match screen does, through its public result, with the network call and the watchdog timers
 * replaced so every branch is deterministic. They cover what happens when advanceHand is called: the guards that must do
 * nothing, the local (non-Daily) deal, and the Daily Fritz next-hand ladder (silent retries, the manual escape, the
 * non-retryable failure, the end of the run, and the in-flight guard).
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchLifecycleController } from '../controllers/MatchLifecycleController.ts';
import { createBotMatch, type BotActionResult, type BotMatchState } from '../runtime/botEngine.ts';
import type { UseHandLifecycleArgs } from '../hand-lifecycle/types.ts';

const service = vi.hoisted(() => ({
  request: vi.fn(),
  telemetry: vi.fn(),
  /** What the (mocked) step that applies the server's next hand to the local match returns. */
  apply: { result: null as unknown, calls: [] as unknown[][] },
  pkg: {
    attempt_id: 'attempt-1',
    run_date: '2026-11-01',
    current_game_number: 1,
    winning_score: 60,
    challenge_id: null,
    set_result: null,
  } as Record<string, unknown>,
}));

// The watchdog hook runs its own intervals; every test calls advanceHand itself.
vi.mock('../hand-lifecycle/useHandLifecycleWatchdogs.ts', () => ({ useHandLifecycleWatchdogs: () => undefined }));
vi.mock('../hand-lifecycle/dailyFritzHandService.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hand-lifecycle/dailyFritzHandService.ts')>()),
  tryApplyDailyFritzNextHand: (...args: unknown[]) => {
    service.apply.calls.push(args);
    return service.apply.result;
  },
  buildDailyFritzPrefetchParams: () => ({
    dailyFritzPackage: service.pkg,
    dailyFritzHandIndex: 0,
    gameNumber: 1,
    transcript: null,
    completedHandScores: { you: 10, fritz: 5 },
  }),
}));
// The one network seam: both the prefetch coordinator and the request builder go through nextDailyFritzHand.
vi.mock('../../../dailyFritz/api.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../dailyFritz/api.ts')>()),
  nextDailyFritzHand: (...args: unknown[]) => service.request(...args),
  recordDailyFritzTelemetry: (...args: unknown[]) => service.telemetry(...args),
}));

const { useHandLifecycle } = await import('./useHandLifecycle.ts');
const { DailyFritzEndOfRunError, DailyFritzNextHandHttpError } = await import('../../daily/dailyFritzContracts.ts');

const completedHand = (): BotMatchState => ({ ...createBotMatch(60, 7), handOver: true });

function setup(overrides: Partial<UseHandLifecycleArgs> = {}, match: BotMatchState = completedHand()) {
  const matchRef = { current: match };
  const ports = {
    invalidateLocalRuns: vi.fn(),
    flashLastPlayed: vi.fn(),
    setSelectedTile: vi.fn(),
    setLastBotChoice: vi.fn(),
    pushToast: vi.fn(),
    showScoreToast: vi.fn(),
    showBoardToast: vi.fn(),
    captureGuidedMatchCandidateNextHand: vi.fn(),
  };
  const lifecycle = { transition: vi.fn(), onHandEndedFromBotAction: vi.fn() };
  const setMatch = vi.fn();
  const args = {
    match,
    setMatch,
    matchRef,
    lifecycle: lifecycle as unknown as MatchLifecycleController,
    mode: 'bot',
    isDailyFritzMode: false,
    isGuidedMode: false,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
    isAuthoringMode: false,
    isMuted: true,
    opponentLabel: 'Fritz',
    dailyFritzPackage: null,
    dailyFritzTranscriptProtocolVersion: 2,
    dailyFritzHandIndex: 0,
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
    ports,
    ...overrides,
  } as unknown as UseHandLifecycleArgs;
  const view = renderHook(() => useHandLifecycle(args));
  const phases = () => lifecycle.transition.mock.calls.map(([phase]) => phase as string);
  return { ...view, args, ports, lifecycle, setMatch, matchRef, phases };
}

const dailyArgs = (): Partial<UseHandLifecycleArgs> => ({
  isDailyFritzMode: true,
  mode: 'dailyFritz',
  dailyFritzPackage: service.pkg as unknown as UseHandLifecycleArgs['dailyFritzPackage'],
});

/** Lets the rejected/resolved request promise chain run to its handler without moving the clock. */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
};

beforeEach(() => {
  service.request.mockReset();
  service.telemetry.mockReset().mockResolvedValue(undefined);
  service.apply.result = null;
  service.apply.calls = [];
  service.pkg = {
    attempt_id: 'attempt-1',
    run_date: '2026-11-01',
    current_game_number: 1,
    winning_score: 60,
    challenge_id: null,
    set_result: null,
  };
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('advanceHand: the guards that must do nothing', () => {
  it('does nothing at hand zero, the shell before the first deal', () => {
    const { result, setMatch, ports, phases } = setup({}, { ...createBotMatch(60, 7), handNumber: 0 });
    act(() => result.current.advanceHand());
    expect(setMatch).not.toHaveBeenCalled();
    expect(ports.invalidateLocalRuns).not.toHaveBeenCalled();
    expect(phases()).toEqual([]);
  });

  it('does not deal another hand once the game is over', () => {
    const { result, setMatch, phases } = setup({}, { ...completedHand(), gameOver: true });
    act(() => result.current.advanceHand());
    expect(setMatch).not.toHaveBeenCalled();
    expect(phases()).toEqual(['match-complete']);
  });

  it('does not advance a Daily Fritz set that is already finished', () => {
    const finished = { ...service.pkg, set_result: { setWinner: 'player', playerGamesWon: 2, fritzGamesWon: 0, games: [] } };
    const { result, setMatch, phases } = setup({
      ...dailyArgs(),
      dailyFritzPackage: finished as unknown as UseHandLifecycleArgs['dailyFritzPackage'],
    });
    act(() => result.current.advanceHand());
    expect(setMatch).not.toHaveBeenCalled();
    expect(service.request).not.toHaveBeenCalled();
    expect(phases()).toEqual(['set-complete']);
  });

  it('a guided lesson that is not loaded yet deals nothing', () => {
    const { result, setMatch } = setup({ isGuidedV2Mode: true, frozenV2Lesson: null });
    act(() => result.current.advanceHand());
    expect(setMatch).not.toHaveBeenCalled();
  });
});

describe('advanceHand: a local (non-Daily) game', () => {
  it('deals the next hand, clears the transient board state first, and leaves nothing in flight', () => {
    const { result, setMatch, ports, phases } = setup();
    act(() => result.current.advanceHand());

    expect(ports.invalidateLocalRuns).toHaveBeenCalledTimes(1);
    expect(ports.setSelectedTile).toHaveBeenCalledWith(null);
    expect(ports.flashLastPlayed).toHaveBeenCalledWith(null);
    expect(ports.setLastBotChoice).toHaveBeenCalledWith(null);

    expect(setMatch).toHaveBeenCalledTimes(1);
    const next = setMatch.mock.calls[0][0] as BotMatchState;
    expect(next.handNumber).toBe(2);
    expect(next.handOver).toBe(false);
    expect(next.players.you.hand.length).toBeGreaterThan(0);

    expect(ports.captureGuidedMatchCandidateNextHand).toHaveBeenCalledTimes(1);
    expect(phases()).toEqual(['advancing-hand', 'dealing-next-hand', 'playing']);
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);
    expect(result.current.handAdvanceError).toBeNull();
  });

  it('keeps both scores across the deal', () => {
    const hand = completedHand();
    const scored: BotMatchState = { ...hand, players: { you: { ...hand.players.you, score: 25 }, bot: { ...hand.players.bot, score: 15 } } };
    const { result, setMatch } = setup({}, scored);
    act(() => result.current.advanceHand());
    const next = setMatch.mock.calls[0][0] as BotMatchState;
    expect([next.players.you.score, next.players.bot.score]).toEqual([25, 15]);
  });

  it('does not deal while the current hand is still being played', () => {
    const { result, setMatch } = setup({}, { ...createBotMatch(60, 7), handOver: false });
    act(() => result.current.advanceHand());
    expect(setMatch).not.toHaveBeenCalled();
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);
  });
});

describe('advanceHand: Daily Fritz, fetching the next hand', () => {
  it('asks the server once, however many times it is called before the answer', () => {
    service.request.mockReturnValue(new Promise(() => undefined)); // never settles
    const { result, phases } = setup(dailyArgs());
    act(() => {
      result.current.advanceHand();
      result.current.advanceHand();
      result.current.advanceHand();
    });
    expect(service.request).toHaveBeenCalledTimes(1);
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(true);
    expect(phases().filter((phase) => phase === 'advancing-hand')).toHaveLength(1);
  });

  // An "attempt" is one advance that ends in a failure: the lifecycle traces an 'error' phase for it.
  const attempts = (phases: () => string[]) => phases().filter((phase) => phase === 'error').length;
  const advances = (phases: () => string[]) => phases().filter((phase) => phase === 'advancing-hand').length;

  it('retries a transport failure silently, with no error shown, on a growing delay', async () => {
    service.request.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();
    expect(attempts(phases)).toBe(1);
    expect(result.current.handAdvanceError).toBeNull();
    expect(result.current.showManualHandAdvance).toBe(false);
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);

    // nothing happens before the first delay (1 s)...
    await act(async () => { await vi.advanceTimersByTimeAsync(900); });
    expect(advances(phases)).toBe(1);
    // ...then it advances again, still without telling the player
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    await flush();
    expect(advances(phases)).toBe(2);
    expect(attempts(phases)).toBe(2);
    expect(result.current.handAdvanceError).toBeNull();
  });

  it('after three silent retries it shows the error and the manual button, and keeps trying in the background', async () => {
    service.request.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();
    for (const delay of [1000, 2500, 5000]) {
      expect(result.current.showManualHandAdvance).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(delay + 50); });
      await flush();
    }
    expect(attempts(phases)).toBe(4);
    expect(result.current.handAdvanceError).toBeTruthy();
    expect(result.current.showManualHandAdvance).toBe(true);

    // the background retry (4 s) is still armed, so a player who does nothing is not stranded
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    await flush();
    expect(attempts(phases)).toBe(5);
  });

  // CURRENT BEHAVIOUR, recorded rather than endorsed: the first request for a hand is started by the prefetch coordinator;
  // when it rejects, resolve() immediately issues one fresh request inside the same advance, so the first failed attempt
  // reaches the server twice (the later attempts once each). The server's next-hand route is idempotent, so this is only
  // extra load during an outage. If that is ever tightened, this test is the one to update.
  it('sends the first failed attempt twice (cached request, then one immediate fresh one) and later attempts once each', async () => {
    service.request.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();
    expect(service.request).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(1050); });
    await flush();
    expect(service.request).toHaveBeenCalledTimes(3);
  });

  it('a rejected hand (HTTP 400) is retried quietly once, then asks the player to restore the official hand and stops', async () => {
    service.request.mockRejectedValue(new DailyFritzNextHandHttpError('transcript rejected', 400, 'invalid_transcript'));
    const { result, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();
    // the first rejection can be a late verification receipt, so it is retried (300 ms) without the manual button
    expect(result.current.showManualHandAdvance).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await flush();

    // the second one is a real problem: the error and the manual button appear
    expect(result.current.showManualHandAdvance).toBe(true);
    expect(result.current.handAdvanceError).toBeTruthy();
    const attemptsWhenStopped = attempts(phases);

    // and nothing keeps hammering the server behind the dialog
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await flush();
    expect(attempts(phases)).toBe(attemptsWhenStopped);
  });

  it('the end of the run from the server finishes the match instead of showing an error', async () => {
    service.request.mockRejectedValue(new DailyFritzEndOfRunError('run complete'));
    const { result, setMatch, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();

    expect(setMatch).toHaveBeenCalledTimes(1);
    const updater = setMatch.mock.calls[0][0] as (prev: BotMatchState) => BotMatchState;
    expect(updater(completedHand()).gameOver).toBe(true);
    expect(result.current.handAdvanceError).toBeNull();
    expect(result.current.showManualHandAdvance).toBe(false);
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);
    expect(phases()).toContain('match-complete');
  });

  it('the manual retry clears the error and asks the server again', async () => {
    service.request.mockRejectedValue(new DailyFritzNextHandHttpError('transcript rejected', 400, 'invalid_transcript'));
    const { result } = setup(dailyArgs());
    act(() => result.current.advanceHand());
    await flush();
    expect(result.current.handAdvanceError).toBeTruthy();
    const before = service.request.mock.calls.length;

    service.request.mockReturnValue(new Promise(() => undefined));
    act(() => result.current.retryHandAdvance());
    expect(result.current.handAdvanceError).toBeNull();
    expect(service.request.mock.calls.length).toBe(before + 1);
  });
});

// ── applying what the server sent, challenge sets, the stale-cursor bail, and the hand-end notification ─────────────────

const errorsIn = (phases: () => string[]) => phases().filter((phase) => phase === 'error').length;
const advancesIn = (phases: () => string[]) => phases().filter((phase) => phase === 'advancing-hand').length;
const response = (over: Record<string, unknown> = {}) => ({
  current_hand_index: 1,
  authority_revision: 7,
  current_game_number: 1,
  hand: {},
  current_game_scores: { you: 10, fritz: 5 },
  ...over,
});
const nextHandState = () => ({ ...createBotMatch(60, 7), handNumber: 2 });

describe('advanceHand: applying the next hand the server sent', () => {
  it('deals it, moves the cursor to the server\'s hand and revision, and clears every error and flag', async () => {
    service.request.mockResolvedValue(response());
    service.apply.result = { applied: true, nextState: nextHandState() };
    const { result, args, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();

    expect(args.applyDailyFritzNextHand).toHaveBeenCalledTimes(1);
    expect(args.applyDailyFritzNextHand).toHaveBeenCalledWith({
      cursor: { gameNumber: 1, handIndex: 1, revision: 7 },
      match: expect.objectContaining({ handNumber: 2 }),
    });
    expect(args.setDailyFritzHandResult).toHaveBeenCalledWith(null);
    expect(result.current.handAdvanceError).toBeNull();
    expect(result.current.showManualHandAdvance).toBe(false);
    expect(result.current.getDebugSnapshot()).toMatchObject({ transitionInFlight: false, nextHandPrefetched: false, nextHandInFlight: false });
    expect(phases().at(-1)).toBe('playing');
  });

  it('takes the authority revision from the response, then the package, then 0', async () => {
    service.apply.result = { applied: true, nextState: nextHandState() };

    service.request.mockResolvedValue(response({ authority_revision: undefined }));
    service.pkg.authority_revision = 3;
    const fromPackage = setup(dailyArgs());
    act(() => fromPackage.result.current.advanceHand());
    await flush();
    expect((fromPackage.args.applyDailyFritzNextHand as ReturnType<typeof vi.fn>).mock.calls[0][0].cursor.revision).toBe(3);

    delete service.pkg.authority_revision;
    const fromNothing = setup(dailyArgs());
    act(() => fromNothing.result.current.advanceHand());
    await flush();
    expect((fromNothing.args.applyDailyFritzNextHand as ReturnType<typeof vi.fn>).mock.calls[0][0].cursor.revision).toBe(0);
  });

  it('when the local match cannot take the hand, shows a retry prompt and records why, instead of leaving the board stuck', async () => {
    service.request.mockResolvedValue(response());
    service.apply.result = { applied: false };
    const { result, args, phases } = setup(dailyArgs());

    act(() => result.current.advanceHand());
    await flush();

    expect(args.applyDailyFritzNextHand).not.toHaveBeenCalled();
    expect(result.current.handAdvanceError).toBe('Could not start the next hand. Tap Continue to retry.');
    expect(result.current.showManualHandAdvance).toBe(true);
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);
    expect(errorsIn(phases)).toBe(1);
    expect(service.telemetry).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'recovery_started', failureCode: 'next_hand_apply_rejected', attemptId: 'attempt-1' }),
    );
  });
});

describe('advanceHand: a challenge set ends on a hand, not on a score', () => {
  it('keeps advancing after the engine says "game over" while neither side has reached the winning score', async () => {
    service.pkg.challenge_code = 'weekly-1';
    service.request.mockResolvedValue(response());
    service.apply.result = { applied: true, nextState: nextHandState() };
    const { result, args } = setup(dailyArgs(), { ...completedHand(), gameOver: true, winnerId: 'you' });

    act(() => result.current.advanceHand());
    await flush();

    expect(service.request).toHaveBeenCalled();
    // the engine's premature game over is lifted for the hand advance, so the next deal is accepted
    const handedToApply = service.apply.calls[0][0] as { gameOver: boolean; winnerId: string | null };
    expect(handedToApply.gameOver).toBe(false);
    expect(handedToApply.winnerId).toBeNull();
    expect(args.applyDailyFritzNextHand).toHaveBeenCalledTimes(1);
  });

  it('but an ordinary Daily Fritz game that is over stays over', () => {
    const { result, phases } = setup(dailyArgs(), { ...completedHand(), gameOver: true });
    act(() => result.current.advanceHand());
    expect(service.request).not.toHaveBeenCalled();
    expect(phases()).toEqual(['match-complete']);
  });
});

describe('advanceHand: a hand the server has moved past by more than one', () => {
  it('uses the unverified fallback after two failures, then stops, tells the player to reload, and says why to telemetry', async () => {
    service.request.mockRejectedValue(new DailyFritzNextHandHttpError('This hand is no longer current.', 409, null, null, null, 5));
    const { result, phases } = setup({ ...dailyArgs(), dailyFritzHandIndex: 0 });

    act(() => result.current.advanceHand());
    await flush();
    // attempt 1 retries quietly (300 ms), attempts 2 to 4 fall back to an unverified advance (300 ms each), attempt 5 gives up
    expect(result.current.showManualHandAdvance).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    await flush();

    expect(advancesIn(phases)).toBe(5);
    expect(errorsIn(phases)).toBe(1); // only the give-up is reported as an error; the quiet retries are not
    expect(result.current.handAdvanceError).toMatch(/fell out of sync/i);
    expect(result.current.showManualHandAdvance).toBe(true);
    expect(
      service.request.mock.calls.some(([params]) => ((params as { unverifiedFallback?: { attempts: number } }).unverifiedFallback?.attempts ?? 0) >= 2),
    ).toBe(true);
    const codes = service.telemetry.mock.calls.map(([event]) => (event as { failureCode: string }).failureCode);
    expect(codes).toContain('stale_cursor_detected');

    // and nothing keeps resubmitting the same doomed hand behind the dialog
    const callsAtBail = service.request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await flush();
    expect(service.request.mock.calls.length).toBe(callsAtBail);
  });

  it('a hand only one behind is not treated as stale: it keeps retrying quietly, with no dialog', async () => {
    // one behind is the server's own replay window and resolves on a normal retry, so there is no bail
    service.request.mockRejectedValue(new DailyFritzNextHandHttpError('This hand is no longer current.', 409, null, null, null, 1));
    const { result, phases } = setup({ ...dailyArgs(), dailyFritzHandIndex: 0 });

    act(() => result.current.advanceHand());
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await flush();

    expect(advancesIn(phases)).toBeGreaterThanOrEqual(8);
    expect(errorsIn(phases)).toBe(0);
    expect(result.current.handAdvanceError).toBeNull();
    expect(result.current.showManualHandAdvance).toBe(false);
  });
});

describe('notifyBotActionResult', () => {
  const handEnded = (over: Record<string, unknown> = {}) => ({
    state: { ...createBotMatch(60, 7), handNumber: 1, handOver: true },
    handEnded: { winner: 'you', reason: 'domino', pointsAwarded: 15, loserPips: 12, calcText: 'You went out' },
    ...over,
  }) as unknown as BotActionResult;

  it('tells the lifecycle which hand ended and who won, and clears the last-played highlight', () => {
    const { result, lifecycle, ports } = setup();
    act(() => result.current.notifyBotActionResult(handEnded()));
    expect(lifecycle.onHandEndedFromBotAction).toHaveBeenCalledTimes(1);
    expect(lifecycle.onHandEndedFromBotAction.mock.calls[0][1]).toEqual({ winner: 'you', reason: 'domino', gameOver: false, handNumber: 1 });
    expect(ports.flashLastPlayed).toHaveBeenCalledWith(null);
  });

  it('shows the hand-end reveal for the hand that ended', async () => {
    const { result } = setup();
    expect(result.current.handReveal).toBeNull();
    act(() => result.current.notifyBotActionResult(handEnded()));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.handReveal).not.toBeNull();
    expect(result.current.handReveal).toMatchObject({ winner: 'you' });
  });

  it('does nothing about hands when the action did not end one', () => {
    const { result, lifecycle } = setup();
    act(() => result.current.notifyBotActionResult({ state: createBotMatch(60, 7), scored: { player: 'you', points: 10 } } as unknown as BotActionResult));
    expect(lifecycle.onHandEndedFromBotAction).not.toHaveBeenCalled();
    expect(result.current.handReveal).toBeNull();
  });

  it('in Daily Fritz it also records the hand result, labels the flow, and holds the next hand request until the reveal has had its time', async () => {
    service.request.mockReturnValue(new Promise(() => undefined));
    const { result, args } = setup(dailyArgs());
    act(() => result.current.notifyBotActionResult(handEnded()));

    expect(args.setDailyFritzHandResult).toHaveBeenCalledWith(expect.objectContaining({ winner: 'you' }));
    expect(args.lastDailyFlowLabelRef.current).toBe('hand-complete');

    // advancing straight away is refused for the reveal window: no request yet
    act(() => result.current.advanceHand());
    expect(service.request).not.toHaveBeenCalled();
    expect(result.current.getDebugSnapshot().transitionInFlight).toBe(false);

    // once the window has passed the hand is requested, without anyone pressing anything
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(service.request).toHaveBeenCalled();
  });
});
