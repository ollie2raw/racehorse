import { describe, expect, it } from 'vitest';
import { shouldDeferTournamentMatchFinalize } from './tournamentPostgamePolicy';

describe('shouldDeferTournamentMatchFinalize', () => {
  const live = { appMode: 'multiplayer' as const, attachedMatchId: 'm1', payloadMatchId: 'm1' };

  it('waits for the game-over overlay of the match on screen', () => {
    expect(shouldDeferTournamentMatchFinalize(live)).toBe(true);
    expect(shouldDeferTournamentMatchFinalize({ ...live, winnerSource: 'game_over', lostByMe: true })).toBe(true);
    expect(shouldDeferTournamentMatchFinalize({ ...live, winnerSource: 'game_over', lostByMe: false })).toBe(true);
  });

  it('not on other screens or for another match', () => {
    expect(shouldDeferTournamentMatchFinalize({ ...live, appMode: 'tournament' })).toBe(false);
    expect(shouldDeferTournamentMatchFinalize({ ...live, payloadMatchId: 'm2' })).toBe(false);
  });

  it('Phase 4A: a forfeit or no-show against this player has no overlay coming, so it finalizes now', () => {
    expect(shouldDeferTournamentMatchFinalize({ ...live, winnerSource: 'forfeit', lostByMe: true })).toBe(false);
    expect(shouldDeferTournamentMatchFinalize({ ...live, winnerSource: 'no_show', lostByMe: true })).toBe(false);
  });

  it('the winner of a forfeit is unchanged (room:match_abandoned takes them to the bracket)', () => {
    expect(shouldDeferTournamentMatchFinalize({ ...live, winnerSource: 'forfeit', lostByMe: false })).toBe(true);
  });
});
