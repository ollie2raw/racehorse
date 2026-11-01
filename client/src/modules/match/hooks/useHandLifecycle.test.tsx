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
import { createBotMatch, type BotMatchState } from '../runtime/botEngine.ts';
import type { UseHandLifecycleArgs } from '../hand-lifecycle/types.ts';

const service = vi.hoisted(() => ({
  request: vi.fn(),
  pkg: {
    attempt_id: 'attempt-1',
    run_date: '2026-11-01',
    current_game_number: 1,
    winning_score: 60,
    challenge_id: null,
    set_result: null,
  },
}));

// The watchdog hook runs its own intervals; every test calls advanceHand itself.
vi.mock('../hand-lifecycle/useHandLifecycleWatchdogs.ts', () => ({ useHandLifecycleWatchdogs: () => undefined }));
vi.mock('../hand-lifecycle/dailyFritzHandService.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hand-lifecycle/dailyFritzHandService.ts')>()),
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
  recordDailyFritzTelemetry: vi.fn().mockResolvedValue(undefined),
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  service.request.mockReset();
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
