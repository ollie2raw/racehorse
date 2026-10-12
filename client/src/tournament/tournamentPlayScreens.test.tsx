/**
 * Phase 3D bracket, result and post-match screens, rendered: Fritz named by
 * tier with a Fritz chip (never an id, never numbered alone), outcome words
 * from outcomeKind, Your Path with Join only on a tap, phone round tabs, the
 * result screen's server-clock countdown and Fritz champion, and the next
 * round offered — never joined — after a win.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

vi.mock('../components', () => ({ GlobalNav: () => null }));

import TournamentBracketScreen from './TournamentBracketScreen';
import TournamentResultScreen from './TournamentResultScreen';
import TournamentGameOverOverlay from './TournamentGameOverOverlay';
import { TournamentPostgameContext, type TournamentPostgameValue } from './TournamentPostgameContext';
import { tournamentPlayerDisplay } from './displayNames';
import { deriveResultView } from './tournamentResultView';
import { observeTournamentRequest, resetTournamentClockForTests } from './tournamentClock';
import type { BracketView, MyTournament, Registration, TournamentMatch } from './types';
import type { GameState } from '../types';

const ME = 'me-0000';
const T = 'tour-1';
const bot = (n: number) => `bot:fritz:${T}:${n}`;
const NOW = Date.parse('2026-10-30T16:00:00.000Z');
let mono = 0;

beforeEach(() => {
  vi.useFakeTimers();
  mono = 5_000;
  resetTournamentClockForTests(() => mono);
  observeTournamentRequest(5_000, 5_000, new Date(NOW).toISOString());
});
afterEach(() => {
  cleanup();
  resetTournamentClockForTests();
  vi.useRealTimers();
});

const match = (id: string, round: 1 | 2 | 3, n: number, p1: string | null, p2: string | null, over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id, tournament_id: T, round, match_number: n, player1_id: p1, player2_id: p2, winner_id: null, room_code: null, status: 'waiting',
  bot_tier: null, started_at: null, completed_at: null, player1_score: null, player2_score: null, ...over,
});
const reg = (user_id: string, username: string): Registration => ({
  id: `r-${user_id}`, tournament_id: T, user_id, registered_at: new Date(NOW).toISOString(), seed: null, placement: null, status: 'active', username,
});
const LONG = 'Alexandria-Konstantinopoulou-Featherstonehaugh';

function bracketView(matches: TournamentMatch[]): BracketView {
  return {
    tournament: {
      id: T, kind: 'live', status: 'in_progress', scheduled_start: new Date(NOW - 60_000).toISOString(), registration_open_at: '', registration_close_at: '',
      format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
    },
    registrations: [reg(ME, 'me'), reg('ana', 'ana'), reg('long', LONG)],
    matches,
  };
}

type BracketProps = ComponentProps<typeof TournamentBracketScreen>;
function renderBracket(matches: TournamentMatch[], over: Partial<BracketProps> = {}) {
  const props: BracketProps = {
    identity: { userId: ME, username: 'me' }, tournamentId: T, bracket: bracketView(matches), tournamentPhase: 'match_ready',
    assignedMatch: null, onLoadBracket: vi.fn(), onBack: vi.fn(), onExitToHub: vi.fn(), onAttachAssignedMatch: vi.fn(), ...over,
  };
  render(<TournamentBracketScreen {...props} />);
  return props;
}

// QF: me vs Fritz (ready); two Fritz against each other (simulated); ana vs long-named human (forfeit).
const QF = [
  match('qf1', 1, 1, ME, bot(2), { status: 'ready', bot_tier: 'standard' }),
  match('qf2', 1, 2, bot(3), bot(7), { status: 'completed', winner_id: bot(7), bot_tier: 'standard', outcomeKind: 'bot_simulated', player1_score: 12, player2_score: 30 }),
  match('qf3', 1, 3, 'ana', 'long', { status: 'completed', winner_id: 'ana', outcomeKind: 'forfeit', player1_score: 30, player2_score: 0 }),
];

// The player lost their QF to Fritz: the whole bracket is revealed (reveal rule).
const QF_DONE = [
  { ...QF[0], status: 'completed' as const, winner_id: bot(2), outcomeKind: 'played' as const, player1_score: 21, player2_score: 30 },
  QF[1],
  QF[2],
];

describe('bracket', () => {
  it('Fritz by tier with a Fritz chip; numbers only for Fritz against Fritz; never a raw id', () => {
    renderBracket(QF_DONE, { tournamentPhase: 'eliminated' });
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/bot:|fritz:/);
    expect(screen.getAllByText('Fritz 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fritz 2').length).toBeGreaterThan(0);
    // The player's own opponent is plain "Fritz" (the only one in that match).
    const qf1 = screen.getByLabelText('Quarterfinal, your match');
    expect(within(qf1).getByText('Fritz', { selector: '.tb-name-text' })).toBeTruthy();
    expect(within(qf1).getByText('Fritz', { selector: '.tb-fritz-chip' })).toBeTruthy();
    // Every Fritz seat carries the chip (from the id, not a registration — Fritz has none).
    expect(document.querySelectorAll('.tb-fritz-chip')).toHaveLength(3);
  });

  it('outcome notes from outcomeKind; a forfeit shows no fake score; winners named in words', () => {
    renderBracket(QF_DONE, { tournamentPhase: 'eliminated' });
    expect(screen.getByText('Forfeit')).toBeTruthy();
    expect(screen.getByText('Fritz advanced')).toBeTruthy();
    expect(screen.queryByText(/administrative/i)).toBeNull();
    // Only played matches show scores: the forfeit's 30–0 is not shown as a game.
    const forfeitCard = screen.getByText('Forfeit').closest('.tb-match') as HTMLElement;
    expect(within(forfeitCard).queryByText('30')).toBeNull();
    expect(within(forfeitCard).getByText('Won')).toBeTruthy();
  });

  it('long human names render in full (no id, wraps on phones)', () => {
    renderBracket(QF_DONE, { tournamentPhase: 'eliminated' });
    expect(screen.getByText(LONG)).toBeTruthy();
  });

  it('Your Path: round, Fritz opponent, Join only on a tap', () => {
    const props = renderBracket(QF, {
      assignedMatch: { matchId: 'qf1', tournamentId: T, round: 1, matchNumber: 1, opponentId: bot(2), opponentUsername: 'Fritz', roomCode: 'R1', matchStatus: 'ready', scheduledStart: '', matchStartsAt: null, readyDeadlineAt: null },
    });
    const pathCard = screen.getByLabelText('Your path');
    expect(within(pathCard).getByText('Your Quarterfinal is ready')).toBeTruthy();
    expect(within(pathCard).getByText('Fritz', { selector: '.tb-fritz-chip' })).toBeTruthy();
    expect(props.onAttachAssignedMatch).not.toHaveBeenCalled();
    fireEvent.click(within(pathCard).getByRole('button', { name: 'Join Match' }));
    expect(props.onAttachAssignedMatch).toHaveBeenCalledWith('qf1');
    // One Join on the screen (no second banner).
    expect(screen.getAllByRole('button', { name: /Join/ })).toHaveLength(1);
  });

  it('Your Path: Resume for a match in progress', () => {
    renderBracket(QF, {
      tournamentPhase: 'in_match',
      assignedMatch: { matchId: 'qf1', tournamentId: T, round: 1, matchNumber: 1, opponentId: bot(2), opponentUsername: 'Fritz', roomCode: 'R1', matchStatus: 'in_progress', scheduledStart: '', matchStartsAt: null, readyDeadlineAt: null },
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('round tabs: Quarterfinals / Semifinals / Final, opening on the player\'s round', () => {
    const qfWon = { ...QF[0], status: 'completed' as const, winner_id: ME, outcomeKind: 'played' as const, player1_score: 30, player2_score: 14 };
    renderBracket([qfWon, QF[1], QF[2], match('sf1', 2, 1, ME, null)], { tournamentPhase: 'bracket_lobby' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Quarterfinals', 'SemifinalsYou', 'Final']);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.tb-bracket')?.getAttribute('data-round')).toBe('2');
    fireEvent.click(tabs[2]);
    expect(document.querySelector('.tb-bracket')?.getAttribute('data-round')).toBe('3');
  });

  it('a Fritz champion: "Master Fritz" with the chip', () => {
    const fin = match('f', 3, 1, 'ana', bot(7), { status: 'completed', winner_id: bot(7), bot_tier: 'master', outcomeKind: 'played', player1_score: 20, player2_score: 30 });
    renderBracket([...QF_DONE, fin], { tournamentPhase: 'eliminated' });
    const card = document.querySelector('.tb-champion-name') as HTMLElement;
    expect(card.textContent).toBe('Master FritzFritz');
  });
});

describe('result screen', () => {
  const my = (outcome: MyTournament['myLastMatch']): MyTournament[] => [{
    ...bracketView([]).tournament, status: 'completed', myRegistration: { status: 'eliminated', placement: 3, placementLabel: '3rd', seed: 2 }, myLastMatch: outcome,
  }];
  const result = {
    tournamentId: T, kind: 'live' as const, scheduledStart: '', format: '7-tile', winTarget: 30, championId: bot(7),
    championName: 'Master Fritz', championIsFritz: true, championFritzTier: 'master' as const, finalOutcomeKind: 'played' as const, placements: [],
  };
  const upcoming = [{ ...bracketView([]).tournament, id: 'next', status: 'registration_open' as const, scheduled_start: new Date(NOW + (2 * 60 + 14) * 60_000 + 30_000).toISOString() }];

  function renderResult(over: Partial<ComponentProps<typeof TournamentResultScreen>> = {}, outcome: MyTournament['myLastMatch'] = null, assigned = null as never) {
    const view = deriveResultView({ tournamentId: T, result, myTournaments: my(outcome), upcoming, activeAssignedMatch: assigned, nowServerMs: NOW });
    const props = { champion: view.champion, yourPlacement: '3rd', myOutcome: view.myOutcome, nextEventStart: view.nextEventStart, nextMatch: view.nextMatch, onJoinNextMatch: vi.fn(), onNextTournament: vi.fn(), timeZone: 'America/Los_Angeles', ...over };
    render(<TournamentResultScreen {...props} />);
    return props;
  }

  it('a Fritz champion is "Master Fritz" with the chip — never "—" or an id', () => {
    renderResult();
    const champ = screen.getByText('Champion').parentElement!;
    expect(champ.textContent).toContain('Master Fritz');
    expect(within(champ).getByText('Fritz')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/bot:|fritz:/);
  });

  it('played loss to Fritz reads as an elimination by Elite Fritz', () => {
    renderResult({}, { matchId: 'sf', round: 2, won: false, outcomeKind: 'played', opponentId: bot(5), opponentBotTier: 'elite' });
    expect(screen.getByText('Eliminated in the Semifinal')).toBeTruthy();
    expect(screen.getByText('Lost to Elite Fritz')).toBeTruthy();
  });

  it('missed-turn elimination and own forfeit, in words', () => {
    renderResult({}, { matchId: 'qf', round: 1, won: false, outcomeKind: 'missed_turns', opponentId: 'ana', opponentBotTier: null });
    expect(screen.getByText('Match ended after missed turns')).toBeTruthy();
    cleanup();
    renderResult({}, { matchId: 'qf', round: 1, won: false, outcomeKind: 'forfeit', opponentId: 'ana', opponentBotTier: null });
    expect(screen.getByText('Match forfeited')).toBeTruthy();
  });

  it('next Live Event counted down on the server clock (a device clock jump changes nothing)', () => {
    renderResult();
    expect(document.body.textContent).toContain('in 2h 14m');
    act(() => { vi.setSystemTime(NOW + 9 * 3_600_000); });
    act(() => { mono += 60_000; vi.advanceTimersByTime(60_000); });
    expect(document.body.textContent).toContain('in 2h 13m');
  });

  it('a ready next match is offered, never joined', () => {
    const assigned = { matchId: 'sf1', tournamentId: T, round: 2 as const, matchNumber: 1, roomCode: 'R', opponentId: null, opponentUsername: null, matchStatus: 'ready' as const, readyDeadlineAt: null };
    const props = renderResult({}, null, assigned as never);
    expect(props.onJoinNextMatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join Semifinal' }));
    expect(props.onJoinNextMatch).toHaveBeenCalledWith('sf1');
  });
});

describe('post-match overlay', () => {
  const state = (winnerId: string): GameState => ({
    playerIds: [ME, bot(2)], winnerId, gameOver: true,
    players: { [ME]: { score: winnerId === ME ? 30 : 12 }, [bot(2)]: { score: winnerId === ME ? 18 : 30 } },
  } as unknown as GameState);
  const tm = { tournamentId: T, matchId: 'qf1', round: 1 as const, matchNumber: 1, roomCode: 'R1', stageLabel: 'Quarterfinal' as const, isTournament: true as const, opponentUserId: bot(2), opponentUsername: 'Fritz', opponentRating: null };
  function renderOverlay(ctx: Partial<TournamentPostgameValue>, winnerId = ME) {
    const value: TournamentPostgameValue = { myTournaments: [], activeAssignedMatch: null, joining: false, onJoin: vi.fn(), ...ctx };
    const handlers = { onViewBracket: vi.fn(), onViewFinalResult: vi.fn(), onReturnToTournament: vi.fn() };
    render(
      <TournamentPostgameContext.Provider value={value}>
        <TournamentGameOverOverlay state={state(winnerId)} myId={ME} tournamentMatch={tm} myDisplayName="me" opponent={tournamentPlayerDisplay(bot(2), { round: 1 })} {...handlers} />
      </TournamentPostgameContext.Provider>,
    );
    return { value, handlers };
  }
  const myT = (outcome: MyTournament['myLastMatch']): MyTournament[] => [{ ...bracketView([]).tournament, myRegistration: { status: 'active', placement: null, placementLabel: null, seed: null }, myLastMatch: outcome }];

  it('played win: "You won" → "Advanced to the Semifinal"', () => {
    renderOverlay({});
    expect(screen.getByText('You won')).toBeTruthy();
    expect(screen.getByText('Advanced to the Semifinal')).toBeTruthy();
  });

  it('an administrative advance is "You advanced", not "You won"', () => {
    renderOverlay({ myTournaments: myT({ matchId: 'qf1', round: 1, won: true, outcomeKind: 'administrative', opponentId: bot(2), opponentBotTier: 'standard' }) });
    expect(screen.getByText('You advanced')).toBeTruthy();
    expect(screen.queryByText('You won')).toBeNull();
    expect(screen.queryByText(/administrative/i)).toBeNull();
  });

  it('the next round ready: "Join Semifinal" on a tap only; nothing joins on load', () => {
    const next = { matchId: 'sf1', tournamentId: T, round: 2 as const, matchNumber: 1, roomCode: 'R2', opponentId: null, opponentUsername: null, matchStatus: 'ready' as const, readyDeadlineAt: null };
    const { value } = renderOverlay({ activeAssignedMatch: next });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(value.onJoin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Join Semifinal' }));
    expect(value.onJoin).toHaveBeenCalledWith('sf1');
  });

  it('Fritz opponent carries the chip in the scores', () => {
    renderOverlay({}, bot(2));
    expect(screen.getAllByText('Fritz', { selector: '.tmh-fritz-chip' }).length).toBe(1);
    expect(screen.getByText('Eliminated in the Quarterfinal')).toBeTruthy();
  });
});
