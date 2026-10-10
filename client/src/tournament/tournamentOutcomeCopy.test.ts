import { describe, expect, it } from 'vitest';
import { bracketOutcomeNote, myMatchOutcomeCopy, outcomeHasPlayedScore } from './tournamentOutcomeCopy';
import type { TournamentOutcomeKind } from './types';

const KINDS: TournamentOutcomeKind[] = ['played', 'forfeit', 'missed_turns', 'no_show', 'administrative', 'bye', 'bot_simulated'];
const INTERNAL = /administrative|missed_turns|no_show|bot_simulated|status_reason|winner_source/;

describe('bracket outcome notes', () => {
  it('each outcomeKind in plain words; played has none (the score says it)', () => {
    expect(KINDS.map((k) => bracketOutcomeNote(k))).toEqual([
      null, 'Forfeit', 'Missed turns', 'No-show', 'Advanced by rule', 'Bye', 'Fritz advanced',
    ]);
    expect(bracketOutcomeNote(null)).toBeNull();
  });
  it('only a played match shows its score as a game', () => {
    expect(KINDS.filter(outcomeHasPlayedScore)).toEqual(['played']);
  });
});

const copy = (round: 1 | 2 | 3, won: boolean, outcomeKind: TournamentOutcomeKind, opponentLabel: string | null = 'marta') =>
  myMatchOutcomeCopy({ round, won, outcomeKind, opponentLabel });

describe('the player\'s own outcome', () => {
  it('played win: "You won" → advanced to the next round', () => {
    expect(copy(1, true, 'played')).toEqual({ title: 'You won', detail: 'Advanced to the Semifinal', positive: true });
    expect(copy(2, true, 'played').detail).toBe('Advanced to the Final');
    expect(copy(3, true, 'played')).toMatchObject({ title: 'Champion', detail: 'You beat marta in the Final' });
  });
  it('played loss to a human and to Fritz', () => {
    expect(copy(2, false, 'played')).toEqual({ title: 'Eliminated in the Semifinal', detail: 'Lost to marta', positive: false });
    expect(copy(2, false, 'played', 'Elite Fritz').detail).toBe('Lost to Elite Fritz');
    expect(copy(3, false, 'played', 'Master Fritz')).toMatchObject({ title: 'Runner-up', detail: 'Lost to Master Fritz in the Final' });
  });
  it('an advance nobody played is never "You won"', () => {
    expect(copy(1, true, 'administrative')).toEqual({ title: 'You advanced', detail: 'Opponent unavailable · Advanced to the Semifinal', positive: true });
    expect(copy(1, true, 'bye')).toMatchObject({ title: 'You advanced', detail: 'Bye · Advanced to the Semifinal' });
    expect(copy(2, true, 'forfeit')).toMatchObject({ title: 'You advanced', detail: 'Opponent forfeited · Advanced to the Final' });
    expect(copy(2, true, 'missed_turns').title).toBe('You advanced');
    expect(copy(1, true, 'no_show').detail).toContain("Opponent didn't join");
    for (const kind of KINDS.filter((k) => k !== 'played')) expect(copy(1, true, kind).title).not.toBe('You won');
  });
  it("the player's own forfeit is not a played loss", () => {
    expect(copy(2, false, 'forfeit')).toEqual({ title: 'Match forfeited', detail: 'Out in the Semifinal', positive: false });
  });
  it('missed-turn elimination and a human no-show', () => {
    expect(copy(1, false, 'missed_turns')).toEqual({ title: 'Eliminated', detail: 'Match ended after missed turns', positive: false });
    expect(copy(1, false, 'no_show')).toMatchObject({ title: 'Match missed', detail: "You didn't join your Quarterfinal" });
  });
  it('never shows an internal outcome name', () => {
    for (const kind of KINDS) for (const won of [true, false]) for (const round of [1, 2, 3] as const) {
      const c = copy(round, won, kind);
      expect(`${c.title} ${c.detail}`).not.toMatch(INTERNAL);
    }
  });
});
