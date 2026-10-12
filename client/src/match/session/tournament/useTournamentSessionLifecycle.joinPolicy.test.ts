/**
 * The real session lifecycle effects under the Phase 3C join policy: nothing
 * joins a `ready` tournament match without a tap — not match_ready, not a /my
 * refresh (reconnect, foreground) — on Home or in another game; an
 * `in_progress` match this player already joined is restored; Play Fritz Cup
 * may join its own cup's first match, and only while its intent is fresh.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTournamentSessionLifecycle } from './useTournamentSessionLifecycle';
import { resetTournamentClockForTests } from '../../../tournament/tournamentClock';
import { FRITZ_LAUNCH_INTENT_MS } from '../../../tournament/tournamentJoinPolicy';
import type { AppMode } from '../../../types';

vi.mock('../../../tournament/tournamentApi', () => ({ fetchResult: vi.fn(async () => null) }));

const mono = 1_000_000;
const CUP = 'cup-1';
const LIVE = 'live-1';
const playable = (tournamentId: string, matchStatus: 'ready' | 'in_progress', roomCode = `T${tournamentId}R1M1`, round: 1 | 2 | 3 = 1) => ({
  matchId: `m-${tournamentId}`, tournamentId, round, matchNumber: 1, roomCode,
  opponentId: 'bot:fritz:x:2', opponentUsername: 'Fritz', matchStatus, readyDeadlineAt: null,
});
const readyPush = (tournamentId: string, round: 1 | 2 | 3 = 1) => ({
  tournamentId, matchId: `m-${tournamentId}`, round, matchNumber: 1, roomCode: `T${tournamentId}R1M1`,
  matchStatus: 'ready' as const, readyAt: null, readyDeadlineAt: null, opponentId: null, opponentUsername: 'Fritz',
});

type TournamentFake = Record<string, any>;

function setup(opts: {
  appMode: AppMode;
  joinedRoom?: string | null;
  activeAssignedMatch?: ReturnType<typeof playable> | null;
  pendingMatch?: ReturnType<typeof readyPush> | null;
  fritzLaunchIntent?: { startedAtMono: number; tournamentId: string | null } | null;
}) {
  const attemptTournamentAttach = vi.fn(async () => true);
  const tournament: TournamentFake = {
    activeAssignedMatch: opts.activeAssignedMatch ?? null,
    recoveryMatch: opts.activeAssignedMatch ?? null,
    pendingMatch: opts.pendingMatch ?? null,
    fritzLaunchIntent: opts.fritzLaunchIntent ?? null,
    activeBracket: null,
    clearRecoveryMatch: vi.fn(),
    clearPendingMatch: vi.fn(),
    endFritzLaunch: vi.fn(),
    openBracket: vi.fn(),
  };
  const ref = <T,>(current: T) => ({ current });
  renderHook(() => useTournamentSessionLifecycle({
    socket: { connected: true } as never,
    isConnected: true,
    appMode: opts.appMode,
    joinedRoom: opts.joinedRoom ?? null,
    liveGameOver: false,
    attachRuntime: { reconnectRuntime: { preventAutoRejoinRef: ref(false), reconnectShouldJoinRef: ref(false), reconnectRoomCodeRef: ref(null) } } as never,
    tournament: tournament as never,
    sessionState: {
      tournamentSubView: 'hub', activeTournamentId: null, setActiveTournamentId: vi.fn(), tournamentMatch: null,
      setTournamentSubView: vi.fn(), setTournamentResult: vi.fn(), setTournamentResultLoading: vi.fn(), setTournamentResultError: vi.fn(),
    } as never,
    attachFlow: { attemptTournamentAttach } as never,
    attachRefs: { attachedTournamentMatchIdRef: ref(null), attachedSocketIdRef: ref(null) } as never,
  }));
  return { attemptTournamentAttach, tournament };
}

beforeEach(() => resetTournamentClockForTests(() => mono));
afterEach(() => resetTournamentClockForTests());

describe('tournament join policy in the session lifecycle', () => {
  it('match_ready while on Home does not join', async () => {
    const { attemptTournamentAttach } = setup({ appMode: 'home', pendingMatch: readyPush(LIVE) });
    await Promise.resolve();
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
  });

  it('match_ready while in another game does not join', async () => {
    const { attemptTournamentAttach } = setup({ appMode: 'multiplayer', joinedRoom: 'PRIVATE1', pendingMatch: readyPush(LIVE) });
    await Promise.resolve();
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
  });

  it('a foreground / reconnect refresh that finds a ready match does not join (hub or elsewhere)', async () => {
    for (const appMode of ['home', 'tournament', 'daily-fritz'] as AppMode[]) {
      const { attemptTournamentAttach } = setup({ appMode, activeAssignedMatch: playable(LIVE, 'ready') });
      await Promise.resolve();
      expect(attemptTournamentAttach).not.toHaveBeenCalled();
    }
  });

  it('an in_progress match this player already joined is restored automatically', async () => {
    const { attemptTournamentAttach } = setup({ appMode: 'home', activeAssignedMatch: playable(LIVE, 'in_progress') });
    await Promise.resolve();
    expect(attemptTournamentAttach).toHaveBeenCalledWith('m-live-1', { tournamentId: LIVE, matchStatus: 'in_progress' });
  });

  it('…but never pulls the player out of a different game', async () => {
    const { attemptTournamentAttach } = setup({ appMode: 'multiplayer', joinedRoom: 'PRIVATE1', activeAssignedMatch: playable(LIVE, 'in_progress') });
    await Promise.resolve();
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
  });

  it('Play Fritz Cup: its create response\'s ready match is joined, and the launch ends', async () => {
    const { attemptTournamentAttach, tournament } = setup({
      appMode: 'tournament', activeAssignedMatch: playable(CUP, 'ready'), fritzLaunchIntent: { startedAtMono: mono - 1_000, tournamentId: CUP },
    });
    await vi.waitFor(() => expect(tournament.endFritzLaunch).toHaveBeenCalled());
    expect(attemptTournamentAttach).toHaveBeenCalledWith('m-cup-1', { tournamentId: CUP, matchStatus: 'ready' });
  });

  it('Play Fritz Cup: that cup\'s match_ready during the launch is joined', async () => {
    const { attemptTournamentAttach, tournament } = setup({
      appMode: 'tournament', pendingMatch: readyPush(CUP), fritzLaunchIntent: { startedAtMono: mono - 1_000, tournamentId: CUP },
    });
    await vi.waitFor(() => expect(tournament.clearPendingMatch).toHaveBeenCalled());
    expect(attemptTournamentAttach).toHaveBeenCalledWith('m-cup-1', { tournamentId: CUP, matchStatus: 'ready' });
  });

  it('Phase 3D: the next round of a Fritz Cup always needs a tap, even while the launch intent is live', async () => {
    const intent = { startedAtMono: mono - 1_000, tournamentId: CUP };
    for (const round of [2, 3] as const) {
      const fromMy = setup({ appMode: 'multiplayer', activeAssignedMatch: playable(CUP, 'ready', `TCUPR${round}`, round), fritzLaunchIntent: intent });
      const fromPush = setup({ appMode: 'multiplayer', pendingMatch: readyPush(CUP, round), fritzLaunchIntent: intent });
      const onResult = setup({ appMode: 'tournament', activeAssignedMatch: playable(CUP, 'ready', `TCUPR${round}`, round), fritzLaunchIntent: intent });
      await Promise.resolve();
      expect(fromMy.attemptTournamentAttach).not.toHaveBeenCalled();
      expect(fromPush.attemptTournamentAttach).not.toHaveBeenCalled();
      expect(onResult.attemptTournamentAttach).not.toHaveBeenCalled();
    }
  });

  it('a stale launch intent cannot join a later match', async () => {
    const { attemptTournamentAttach } = setup({
      appMode: 'tournament', pendingMatch: readyPush(CUP), fritzLaunchIntent: { startedAtMono: mono - FRITZ_LAUNCH_INTENT_MS - 1, tournamentId: CUP },
    });
    await Promise.resolve();
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
  });

  it('a Live Event\'s ready match arriving during a Fritz launch is not joined, and ends the launch', async () => {
    const { attemptTournamentAttach, tournament } = setup({
      appMode: 'tournament', pendingMatch: readyPush(LIVE), fritzLaunchIntent: { startedAtMono: mono - 1_000, tournamentId: CUP },
    });
    await Promise.resolve();
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
    expect(tournament.endFritzLaunch).toHaveBeenCalled();
  });

  it('a Live Event\'s ready match is never joined without a tap, on any screen', async () => {
    for (const appMode of ['home', 'tournament'] as AppMode[]) {
      const a = setup({ appMode, pendingMatch: readyPush(LIVE) });
      const b = setup({ appMode, activeAssignedMatch: playable(LIVE, 'ready') });
      await Promise.resolve();
      expect(a.attemptTournamentAttach).not.toHaveBeenCalled();
      expect(b.attemptTournamentAttach).not.toHaveBeenCalled();
    }
  });
});

describe('Phase 4A: a joined match follows its socket', () => {
  type Props = { socket: { connected: boolean; id?: string } | null; isConnected: boolean; appMode: AppMode; liveGameOver: boolean };

  function mount(initial: Props) {
    const attemptTournamentAttach = vi.fn(async () => true);
    const ref = <T,>(current: T) => ({ current });
    const attachRefs = { attachedTournamentMatchIdRef: ref<string | null>('m-cup-1'), attachedSocketIdRef: ref<string | null>('sock-1') };
    const tournament: TournamentFake = {
      activeAssignedMatch: null, recoveryMatch: null, pendingMatch: null, fritzLaunchIntent: null, activeBracket: null,
      clearRecoveryMatch: vi.fn(), clearPendingMatch: vi.fn(), endFritzLaunch: vi.fn(), openBracket: vi.fn(),
    };
    const sessionState = {
      tournamentSubView: 'hub', activeTournamentId: CUP, setActiveTournamentId: vi.fn(),
      tournamentMatch: { matchId: 'm-cup-1', tournamentId: CUP, roomCode: 'TCUPR1M1' },
      setTournamentSubView: vi.fn(), setTournamentResult: vi.fn(), setTournamentResultLoading: vi.fn(), setTournamentResultError: vi.fn(),
    };
    const view = renderHook((props: Props) => useTournamentSessionLifecycle({
      socket: props.socket as never,
      isConnected: props.isConnected,
      appMode: props.appMode,
      joinedRoom: 'TCUPR1M1',
      liveGameOver: props.liveGameOver,
      attachRuntime: { reconnectRuntime: { preventAutoRejoinRef: ref(false), reconnectShouldJoinRef: ref(false), reconnectRoomCodeRef: ref(null) } } as never,
      tournament: tournament as never,
      sessionState: sessionState as never,
      attachFlow: { attemptTournamentAttach } as never,
      attachRefs: attachRefs as never,
    }), { initialProps: initial });
    return { ...view, attemptTournamentAttach, attachRefs };
  }

  const inMatch: Props = { socket: { connected: true, id: 'sock-1' }, isConnected: true, appMode: 'multiplayer', liveGameOver: false };

  it('the socket it attached on: nothing to do', () => {
    const { attemptTournamentAttach } = mount(inMatch);
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
  });

  it('entering the match screen replaced the socket: attaches again on the new one, once', () => {
    const { rerender, attemptTournamentAttach, attachRefs } = mount(inMatch);
    rerender({ ...inMatch, socket: { connected: false }, isConnected: false });
    expect(attemptTournamentAttach).not.toHaveBeenCalled();
    rerender({ ...inMatch, socket: { connected: true, id: 'sock-2' }, isConnected: true });
    expect(attemptTournamentAttach).toHaveBeenCalledTimes(1);
    expect(attemptTournamentAttach).toHaveBeenCalledWith('m-cup-1', { manual: true, tournamentId: CUP, matchStatus: 'in_progress' });
    expect(attachRefs.attachedSocketIdRef.current).toBe('sock-2');
    rerender({ ...inMatch, socket: { connected: true, id: 'sock-2' }, isConnected: true, appMode: 'multiplayer' });
    expect(attemptTournamentAttach).toHaveBeenCalledTimes(1);
  });

  it('not after the match is over, and not on other screens', () => {
    const over = mount(inMatch);
    over.rerender({ ...inMatch, socket: { connected: true, id: 'sock-2' }, liveGameOver: true });
    expect(over.attemptTournamentAttach).not.toHaveBeenCalled();

    const elsewhere = mount(inMatch);
    elsewhere.rerender({ ...inMatch, socket: { connected: true, id: 'sock-2' }, appMode: 'home' });
    expect(elsewhere.attemptTournamentAttach).not.toHaveBeenCalled();
  });
});

