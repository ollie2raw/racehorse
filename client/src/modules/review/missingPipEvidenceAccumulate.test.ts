import { describe, expect, it } from 'vitest';
import { createBotMatch, type BotMatchState } from '../match/runtime/botEngine.ts';
import {
  appendReviewMissingPipObservation,
  observeActorDrawPastOpenEnds,
  observeActorPassOnOpenEnds,
} from './missingPipEvidenceAccumulate.ts';

function boardWithEnds(left: number, right: number): BotMatchState['board'] {
  return {
    mainLine: [{ tile: { low: left, high: right }, orientation: 'horizontal-normal' }],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

describe('missingPipEvidenceAccumulate', () => {
  it('observeActorDrawPastOpenEnds records drew_past_open_end for the actor', () => {
    const base = createBotMatch(60, 7);
    const state: BotMatchState = {
      ...base,
      board: boardWithEnds(3, 6),
      handOpen: true,
      handNumber: 2,
      turnIndex: 9,
      currentPlayer: 'bot',
    };

    const next = observeActorDrawPastOpenEnds(state, 'bot');
    expect(next.reviewMissingPipObservations).toEqual([
      {
        actorId: 'bot',
        reason: 'drew_past_open_end',
        observedHandNumber: 2,
        observedSequence: 9,
        openEnds: [3, 6],
      },
    ]);
  });

  it('observeActorPassOnOpenEnds records passed_on_open_end for the actor', () => {
    const base = createBotMatch(60, 7);
    const state: BotMatchState = {
      ...base,
      board: boardWithEnds(2, 5),
      handOpen: true,
      handNumber: 4,
      turnIndex: 30,
      currentPlayer: 'you',
    };

    const next = observeActorPassOnOpenEnds(state, 'you');
    expect(next.reviewMissingPipObservations?.[0]).toMatchObject({
      actorId: 'you',
      reason: 'passed_on_open_end',
      observedHandNumber: 4,
      observedSequence: 30,
      openEnds: [2, 5],
    });
  });

  it('skips when there is no board / open ends', () => {
    const state = createBotMatch(60, 7);
    expect(observeActorDrawPastOpenEnds(state, 'you').reviewMissingPipObservations).toEqual([]);
    expect(observeActorPassOnOpenEnds(state, 'bot').reviewMissingPipObservations).toEqual([]);
  });

  it('dedupes the same actor/reason/hand/sequence observation', () => {
    const base = createBotMatch(60, 7);
    const state: BotMatchState = {
      ...base,
      board: boardWithEnds(1, 1),
      handOpen: true,
      handNumber: 1,
      turnIndex: 3,
    };
    const once = observeActorPassOnOpenEnds(state, 'you');
    const twice = observeActorPassOnOpenEnds(once, 'you');
    expect(twice.reviewMissingPipObservations).toHaveLength(1);
  });

  it('accumulates both actors without dropping prior rows', () => {
    const base = createBotMatch(60, 7);
    const state: BotMatchState = {
      ...base,
      board: boardWithEnds(4, 4),
      handOpen: true,
      handNumber: 1,
      turnIndex: 2,
    };
    const afterYou = observeActorPassOnOpenEnds(state, 'you');
    const afterBot = appendReviewMissingPipObservation(afterYou, {
      actorId: 'bot',
      reason: 'drew_past_open_end',
      observedHandNumber: 1,
      observedSequence: 3,
      openEnds: [4],
    });
    expect(afterBot.reviewMissingPipObservations?.map((row) => row.actorId)).toEqual(['you', 'bot']);
  });

  it('new dealt hands clear the observation bag', () => {
    const match = createBotMatch(60, 7);
    expect(match.reviewMissingPipObservations).toEqual([]);
  });
});
