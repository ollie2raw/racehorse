import { describe, expect, it } from 'vitest';
import { buildDailyFritzPrefetchParams } from './dailyFritzHandService.ts';
import {
  applyPlayMove,
  createFixedBotHand,
  getLegalMoves,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import { asPlayMoves } from '../../../game/tileUtils.ts';
import type { DailyFritzStartResponse } from '../../daily/dailyFritzContracts.ts';

const DEAL = {
  player_tiles: [{ low: 4, high: 4 }, { low: 1, high: 2 }],
  fritz_tiles: [{ low: 6, high: 6 }, { low: 0, high: 3 }],
  boneyard: [{ low: 1, high: 3 }, { low: 2, high: 6 }],
  locked: [],
};

const PACKAGE = {
  attempt_id: 'attempt-1',
  run_date: '2026-08-18',
  challenge_id: 'daily-fritz:2026-08-18',
  current_game_number: 1,
  verified_match_id: 'match-1',
  fritz_policy_version: 2,
  verification_status: 'in_progress',
} as unknown as DailyFritzStartResponse;

function playOnce(match: BotMatchState): BotMatchState {
  const moves = asPlayMoves(getLegalMoves(match, 'you'));
  const result = applyPlayMove(match, 'you', moves[0]!);
  expect(result.error).toBeUndefined();
  return result.state;
}

describe('Daily Fritz evidence comes from the engine journal', () => {
  it('sends the engine journal as the transcript, ignoring the presentation move log', () => {
    let match = createFixedBotHand({ you: 0, bot: 0 }, 1, 60, 7, DEAL, 'you');
    match = playOnce(match);

    // An empty move log is the worst case for the old reconstruction path: it
    // would have produced a transcript with no actions at all.
    const params = buildDailyFritzPrefetchParams(PACKAGE, 0, match, []);

    expect(params.transcript).not.toBeNull();
    expect(params.transcript!.actions).toEqual(match.officialJournal!.actions.map(
      (action, sequence) => ({ ...action, sequence }),
    ));
    expect(params.transcript!.actions.length).toBeGreaterThan(0);
  });

  it('starts each hand with a journal scoped to that hand', () => {
    const match = createFixedBotHand({ you: 0, bot: 0 }, 3, 60, 7, DEAL, 'you');
    expect(match.officialJournal).toEqual({ handNumber: 3, actions: [] });
  });

  it('records the actor and command of each accepted engine action', () => {
    let match = createFixedBotHand({ you: 0, bot: 0 }, 1, 60, 7, DEAL, 'you');
    match = playOnce(match);

    expect(match.officialJournal!.actions[0]).toMatchObject({
      actor: 'player',
      kind: 'play',
      tile: { low: 4, high: 4 },
    });
  });
});
