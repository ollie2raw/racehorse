import { describe, expect, it } from 'vitest';
import {
  bracketSlotDisplay,
  matchFritzSuffixes,
  resolveTournamentOpponentLabel,
  resolveTournamentPlayerName,
  tournamentPlayerDisplay,
} from './displayNames';

const match = (p1: string | null, p2: string | null, round: 1 | 2 | 3 = 1, bot_tier: 'standard' | 'elite' | 'master' | null = null) => ({
  round, bot_tier, player1_id: p1, player2_id: p2,
});

describe('tournament player display (one helper for every surface)', () => {
  it('a human: their username, no chip', () => {
    expect(tournamentPlayerDisplay('u-123', { username: '@marta' })).toEqual({ label: 'marta', isFritz: false, fritzTier: null, badgeLabel: null });
  });
  it('a human with a number in their id or name keeps their own name, never a number added', () => {
    expect(tournamentPlayerDisplay('7f3e2a91-0000', { username: 'Player 2' }).label).toBe('Player 2');
    expect(tournamentPlayerDisplay('7f3e2a91-0000', {}).label).toBe('Player');
  });
  it('Fritz / Elite Fritz / Master Fritz by tier (or round), with a Fritz chip', () => {
    expect(tournamentPlayerDisplay('bot:fritz:t1:5', { botTier: 'standard' })).toEqual({ label: 'Fritz', isFritz: true, fritzTier: 'standard', badgeLabel: 'Fritz' });
    expect(tournamentPlayerDisplay('bot:fritz:t1:5', { round: 2 })).toMatchObject({ label: 'Elite Fritz', fritzTier: 'elite' });
    expect(tournamentPlayerDisplay('bot:fritz:t1:5', { botTier: 'master' })).toMatchObject({ label: 'Master Fritz', badgeLabel: 'Fritz' });
  });
  it('a raw bot id or bot-ish username is never a label', () => {
    for (const label of [
      tournamentPlayerDisplay('bot:fritz:t1:7').label,
      tournamentPlayerDisplay('u-1', { username: 'bot:fritz:t1:7' }).label,
      resolveTournamentPlayerName('bot:fritz:t1:7', { username: 'bot:fritz:t1:7' }),
      resolveTournamentOpponentLabel({ opponentUserId: 'bot:fritz:t1:7', roomOpponentUsername: 'bot:fritz:t1:7', round: 3 }),
    ]) {
      expect(label).not.toMatch(/bot:|fritz:/);
    }
  });
  it('one Fritz shown alone is never numbered', () => {
    expect(bracketSlotDisplay('bot:fritz:t1:6', null, match('u1', 'bot:fritz:t1:6', 2, 'elite')).label).toBe('Elite Fritz');
  });
  it('two same-tier Fritz against each other: the smallest stable numbers, by seat index', () => {
    const m = match('bot:fritz:t1:7', 'bot:fritz:t1:3', 1, 'standard');
    expect(matchFritzSuffixes(m)).toEqual(new Map([['bot:fritz:t1:3', 1], ['bot:fritz:t1:7', 2]]));
    expect(bracketSlotDisplay('bot:fritz:t1:7', null, m).label).toBe('Fritz 2');
    expect(bracketSlotDisplay('bot:fritz:t1:3', null, m).label).toBe('Fritz 1');
    // A human is never numbered, even next to Fritz.
    expect(bracketSlotDisplay('u1', 'ana', match('u1', 'bot:fritz:t1:3')).label).toBe('ana');
  });
  it('empty seat', () => {
    expect(tournamentPlayerDisplay(null).label).toBe('TBD');
  });
});
