// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildDailyFritzTranscript } from './dailyFritzTranscript';
import type { MoveEntry } from '../game/moveLogger';
import { getFritzPolicyContract } from '@racehorse/game-core';

const base = {
  boardEnds: [-1, -1] as [number, number],
  handBefore: [],
  validMoves: [],
  pipDelta: 0,
  pointsScored: 0,
  boardState: [],
  boardRenderState: null,
  handSnapshot: [],
  engineBestMove: null,
};

describe('Daily Fritz transcript adapter', () => {
  it('projects only current-hand public commands in stable order', () => {
    const moveLog: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'pass' },
      { ...base, moveNumber: 2, handNumber: 2, player: 'you', action: 'place', tile: [6, 6], position: 'left' },
      { ...base, moveNumber: 3, handNumber: 2, player: 'opponent', action: 'draw' },
    ];
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 1, handNumber: 2, moveLog,
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions).toEqual([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
    ]);
    expect(JSON.stringify(transcript)).not.toContain('handBefore');
  });

  it('preserves one transcript draw action per drawn tile', () => {
    const moveLog: MoveEntry[] = [
      { ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'place', tile: [2, 4], position: 'left' },
      { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'draw' },
      { ...base, moveNumber: 3, handNumber: 1, player: 'opponent', action: 'draw' },
      { ...base, moveNumber: 4, handNumber: 1, player: 'opponent', action: 'place', tile: [2, 5], position: 'left' },
    ];
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 0, handNumber: 1, moveLog,
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions).toEqual([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 2, high: 4 }, position: 'left' },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
      { sequence: 2, actor: 'fritz', kind: 'draw' },
      { sequence: 3, actor: 'fritz', kind: 'play', tile: { low: 2, high: 5 }, position: 'left' },
    ]);
  });

  it('repairs an adjacent duplicate placement captured from the same mobile click', () => {
    const placement: MoveEntry = {
      ...base,
      moveNumber: 1,
      handNumber: 1,
      player: 'you',
      action: 'place',
      tile: [5, 6],
      position: 'right',
      handBefore: [[5, 6], [1, 1]],
      handSnapshot: [[5, 6], [1, 1]],
    };
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: [placement, { ...placement, moveNumber: 2 }],
      attemptPredatesJournalRollout: true,
    });

    expect(transcript.actions).toEqual([
      {
        sequence: 0,
        actor: 'player',
        kind: 'play',
        tile: { low: 5, high: 6 },
        position: 'right',
      },
    ]);
  });

  it('repairs a repeated physical tile even when other actions separate stale captures', () => {
    const firstPlacement: MoveEntry = {
      ...base,
      moveNumber: 1,
      handNumber: 1,
      player: 'you',
      action: 'place',
      tile: [0, 5],
      position: 'left',
      handBefore: [[0, 5], [1, 1]],
      handSnapshot: [[0, 5], [1, 1]],
    };
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: [
        firstPlacement,
        { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'draw' },
        {
          ...firstPlacement,
          moveNumber: 3,
          position: 'right',
          boardEnds: [5, 5],
          boardState: [{ tile: [0, 5], position: 'left', source: 'mainline' }],
        },
      ],
      attemptPredatesJournalRollout: true,
    });

    expect(transcript.actions).toEqual([
      {
        sequence: 0,
        actor: 'player',
        kind: 'play',
        tile: { low: 0, high: 5 },
        position: 'left',
      },
      { sequence: 1, actor: 'fritz', kind: 'draw' },
    ]);
  });

  it('fails closed when a play lacks canonical evidence', () => {
    expect(() => buildDailyFritzTranscript({
      challengeId: 'challenge', attemptId: 'attempt', gameNumber: 1, handIndex: 0, handNumber: 1,
      moveLog: [{ ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'place', tile: [1, 2] }],
      attemptPredatesJournalRollout: true,
    })).toThrow(/placement/i);
  });

  it('preserves the protocol version selected for a resumed checkpoint', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 2,
      handIndex: 1,
      handNumber: 2,
      protocolVersion: 1,
      moveLog: [{ ...base, moveNumber: 1, handNumber: 2, player: 'opponent', action: 'pass' }],
      attemptPredatesJournalRollout: true,
    });

    expect(transcript.protocolVersion).toBe(1);
  });

  it('pins policy provenance and forwards Fritz pre-action state evidence', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      fritzPolicyVersion: 1,
      clientRelease: 'deploy-123',
      moveLog: [{
        ...base,
        moveNumber: 1,
        handNumber: 1,
        player: 'opponent',
        action: 'place',
        tile: [2, 4],
        position: 'left',
        authorityPreStateDigest: 'df-state-v1:12345678',
      }],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.fritzPolicyVersion).toBe(1);
    expect(transcript.fritzPolicyContract).toBe(getFritzPolicyContract(1));
    expect(transcript.clientRelease).toBe('deploy-123');
    expect(transcript.actions[0]).toMatchObject({ preStateDigest: 'df-state-v1:12345678' });
  });

  it('seals a blocked hand that omitted the official trailing passes', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      // Authoritative post-hand engine state (e.g. BotMatchState after the
      // real local hand): the non-scoring, non-double play handed the turn
      // to the player with zero passes banked yet.
      sealBlockedHand: { consecutivePasses: 0, nextActor: 'player' },
      moveLog: [{
        ...base,
        moveNumber: 1,
        handNumber: 1,
        player: 'opponent',
        action: 'place',
        tile: [3, 5],
        position: 'left',
        pointsScored: 0,
      }],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions.map((action) => `${action.actor}:${action.kind}`)).toEqual([
      'fritz:play',
      'player:pass',
      'fritz:pass',
    ]);
  });

  it('seals only the missing second pass when the player already passed', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      // Authoritative post-hand engine state: one pass has already banked
      // (the player's), turn now rests with fritz.
      sealBlockedHand: { consecutivePasses: 1, nextActor: 'fritz' },
      moveLog: [
        {
          ...base,
          moveNumber: 1,
          handNumber: 1,
          player: 'opponent',
          action: 'place',
          tile: [3, 5],
          position: 'left',
          pointsScored: 0,
        },
        { ...base, moveNumber: 2, handNumber: 1, player: 'you', action: 'pass' },
      ],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions.map((action) => `${action.actor}:${action.kind}`)).toEqual([
      'fritz:play',
      'player:pass',
      'fritz:pass',
    ]);
  });

  it('keeps extra-turn order after a scoring play', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      // Authoritative post-hand engine state: the scoring play kept the
      // turn with the player (boneyard was already empty before the play,
      // so no embedded auto-pass occurred) — zero passes banked.
      sealBlockedHand: { consecutivePasses: 0, nextActor: 'player' },
      moveLog: [{
        ...base,
        moveNumber: 1,
        handNumber: 1,
        player: 'you',
        action: 'place',
        tile: [2, 3],
        position: 'left',
        pointsScored: 5,
      }],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions.map((action) => `${action.actor}:${action.kind}`)).toEqual([
      'player:play',
      'player:pass',
      'fritz:pass',
    ]);
  });

  it('does not append a bogus pass when the block already fully resolved inside the preceding play (regression)', () => {
    // Root-cause regression test for the production incident: a scoring play
    // or double whose forced-draw chain drains the boneyard to empty (with
    // the actor still unable to play) makes engine.ts embed a silent
    // internal pass inside that single 'play' command — already banking one
    // pass and flipping the turn with no separate MoveEntry produced. If
    // that embedded pass was itself the second consecutive pass, the hand is
    // ALREADY fully terminal after the two logged actions below, and sealing
    // must append nothing — appending an extra pass here previously caused
    // the server to reject the transcript with 'post_terminal_action' once
    // it reached its real terminal state one action earlier.
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      // Authoritative post-hand engine state: the block already fully
      // resolved (both passes already banked) inside the two real actions
      // below — nextActor is irrelevant once consecutivePasses >= 2.
      sealBlockedHand: { consecutivePasses: 2, nextActor: 'player' },
      moveLog: [
        {
          ...base,
          moveNumber: 1,
          handNumber: 1,
          player: 'you',
          action: 'place',
          tile: [4, 4],
          position: 'left',
          pointsScored: 0,
        },
        { ...base, moveNumber: 2, handNumber: 1, player: 'opponent', action: 'pass' },
      ],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions.map((action) => `${action.actor}:${action.kind}`)).toEqual([
      'player:play',
      'fritz:pass',
    ]);
  });

  it('does not append passes unless the hand is sealed as blocked', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: [{
        ...base,
        moveNumber: 1,
        handNumber: 1,
        player: 'opponent',
        action: 'place',
        tile: [3, 5],
        position: 'left',
      }],
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions).toHaveLength(1);
  });

  it('uses journal evidence even when the attempt is marked legacy', () => {
    const transcript = buildDailyFritzTranscript({
      challengeId: 'challenge',
      attemptId: 'attempt',
      gameNumber: 1,
      handIndex: 0,
      handNumber: 1,
      moveLog: [{ ...base, moveNumber: 1, handNumber: 1, player: 'you', action: 'pass' }],
      journal: {
        handNumber: 1,
        actions: [{
          actor: 'fritz',
          kind: 'play',
          tile: { low: 6, high: 6 },
          position: 'left',
        }],
      },
      attemptPredatesJournalRollout: true,
    });
    expect(transcript.actions).toEqual([
      {
        sequence: 0,
        actor: 'fritz',
        kind: 'play',
        tile: { low: 6, high: 6 },
        position: 'left',
      },
    ]);
  });
});
