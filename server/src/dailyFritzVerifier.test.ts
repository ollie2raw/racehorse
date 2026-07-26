import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  canDraw,
  chooseOfficialFritzDecision,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getLegalMoves,
  simulatePlacement,
  type DailyFritzTranscriptAction,
  type DailyFritzTranscript,
  type GameCommand,
  type GameState,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand } from './dailyFritz';
import {
  createOfficialDailyFritzHandState,
  DailyFritzVerificationError,
  digestDailyFritzTranscript,
  verifyDailyFritzHand,
} from './dailyFritzVerifier';

const identity = {
  challengeId: 'daily-fritz:2026-07-13:r2:s1',
  attemptId: 'attempt-1',
  gameNumber: 1 as const,
  handIndex: 0,
};

function transcript(actions: DailyFritzTranscript['actions']): DailyFritzTranscript {
  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    ...identity,
    actions,
  };
}

function state(starter: 'you' | 'bot' = 'you') {
  return createOfficialDailyFritzHandState({
    deal: {
      player_tiles: [{ low: 6, high: 6 }],
      fritz_tiles: [{ low: 0, high: 5 }],
      boneyard: [],
      locked: [],
    },
    handIndex: 0,
    drawWinner: starter,
    winningScore: 60,
    dealSize: 7,
    playerScore: 0,
    fritzScore: 0,
  });
}

function verify(value: unknown, initialState = state()) {
  return verifyDailyFritzHand({
    transcript: value,
    initialState,
    expectedChallengeId: identity.challengeId,
    expectedAttemptId: identity.attemptId,
    expectedGameNumber: 1,
    expectedHandIndex: 0,
    userId: 'user-1',
    fritzTier: 'standard',
    now: () => '2026-07-13T07:00:00.000Z',
  });
}

function buildHonestTranscript(initialState: GameState): DailyFritzTranscript {
  let current = initialState;
  const actions: DailyFritzTranscriptAction[] = [];
  for (let index = 0; index < 512 && !current.handOver; index += 1) {
    const actorId = current.playerIds[current.currentPlayerIndex];
    const actor = actorId === 'player' ? 'player' as const : 'fritz' as const;
    const decision = actor === 'fritz'
      ? chooseOfficialFritzDecision({
          state: current,
          participantId: 'fritz',
          tier: 'standard',
        })
      : (() => {
          const plays = getLegalMoves(current, 'player').filter((move) => move.type === 'play');
          const play = plays[0];
          return play
            ? { kind: 'play' as const, tile: play.tile, position: play.position }
            : canDraw(current, 'player')
              ? { kind: 'draw' as const }
              : { kind: 'pass' as const };
        })();
    const action: DailyFritzTranscriptAction = decision.kind === 'play'
      ? { sequence: index, actor, kind: 'play', tile: decision.tile, position: decision.position }
      : { sequence: index, actor, kind: decision.kind };
    actions.push(action);
    const command: GameCommand = action.kind === 'play'
      ? { version: 1, commandId: `honest:${index}`, sequence: current.sequence, actorId, kind: 'play', tile: action.tile, position: action.position }
      : { version: 1, commandId: `honest:${index}`, sequence: current.sequence, actorId, kind: action.kind };
    current = applyGameCommand(current, command).state;
  }
  if (!current.handOver) throw new Error('Honest fixture did not terminate.');
  return transcript(actions);
}

describe('Daily Fritz server replay verifier', () => {
  it('derives an honest hand result without client score fields', () => {
    const result = verify(transcript([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' },
    ])).result;
    expect(result).toMatchObject({ winner: 'player', reason: 'domino', playerScoreBefore: 0 });
    expect(result.playerScoreAfter).toBeGreaterThan(0);
  });

  it('validates the exact deterministic Fritz decision', () => {
    const result = verify(transcript([
      { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 0, high: 5 }, position: 'left' },
    ]), state('bot')).result;
    expect(result.winner).toBe('fritz');
  });

  it.each([
    transcript([{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 0, high: 0 }, position: 'left' }]),
    transcript([{ sequence: 0, actor: 'player', kind: 'draw' }]),
    transcript([{ sequence: 0, actor: 'player', kind: 'pass' }]),
    transcript([{ sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 0, high: 0 }, position: 'left' }]),
  ])('rejects forged ownership, draw, pass, or actor evidence %#', (forged) => {
    expect(() => verify(forged)).toThrow();
  });

  it('rejects a substituted Fritz move even when the envelope is valid', () => {
    expect(() => verify(transcript([
      { sequence: 0, actor: 'fritz', kind: 'pass' },
    ]), state('bot'))).toThrow(/official policy/i);
  });

  it('rejects incomplete and post-terminal transcripts', () => {
    expect(() => verify(transcript([{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }, { sequence: 1, actor: 'fritz', kind: 'pass' }]))).toThrow(/after hand completion/i);
  });

  it('rejects a repeated scoring-chain tile with actionable sequence context', () => {
    const initial = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 0, high: 5 }, { low: 1, high: 1 }],
        fritz_tiles: [{ low: 2, high: 2 }, { low: 3, high: 3 }],
        boneyard: [],
        locked: [],
      },
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });
    const repeated = transcript([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 0, high: 5 }, position: 'left' },
      { sequence: 1, actor: 'player', kind: 'play', tile: { low: 0, high: 5 }, position: 'right' },
    ]);

    try {
      verify(repeated, initial);
      throw new Error('Expected duplicate play verification to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(DailyFritzVerificationError);
      expect((error as DailyFritzVerificationError).code).toBe('illegal_action');
      expect((error as Error).message).toMatch(/action 1.*0\|5.*does not have tile/i);
    }
  });

  it('reconstructs an omitted mandatory player draw before the submitted play', () => {
    const initial = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 1, high: 2 }],
        fritz_tiles: [{ low: 0, high: 0 }],
        boneyard: [{ low: 5, high: 5 }],
        locked: [],
      },
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    const verified = verify(transcript([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 5, high: 5 }, position: 'left' },
      { sequence: 1, actor: 'player', kind: 'pass' },
      { sequence: 2, actor: 'fritz', kind: 'pass' },
    ]), initial);

    expect(verified.terminalState.handOver).toBe(true);
  });

  it('does not infer draws beyond the first tile that creates a legal play', () => {
    const initial = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 1, high: 2 }],
        fritz_tiles: [{ low: 0, high: 0 }],
        boneyard: [{ low: 5, high: 5 }, { low: 6, high: 6 }],
        locked: [],
      },
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });

    expect(() => verify(transcript([
      { sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' },
    ]), initial)).toThrow(/does not have tile/i);
  });

  it('replays a complete deterministic official hand to the honest terminal result', () => {
    const initial = createOfficialDailyFritzHandState({
      deal: generateSingleDailyFritzGameHand('2026-07-13', 1, 0, 7),
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });
    const honest = buildHonestTranscript(initial);
    const verified = verify(honest, initial);
    expect(verified.terminalState.handOver).toBe(true);
    expect(verified.result.actionCount).toBe(honest.actions.length);
    expect(verified.result.transcriptDigest).toBe(digestDailyFritzTranscript(honest));
  });

  it.each([
    ['challengeId', 'daily-fritz:wrong'],
    ['attemptId', 'attempt-wrong'],
    ['gameNumber', 2],
    ['handIndex', 1],
  ] as const)('rejects mismatched %s identity', (field, value) => {
    expect(() => verify({ ...transcript([{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }]), [field]: value })).toThrow(/mismatch/i);
  });

  it('rejects an honest transcript replayed against an altered deterministic deal', () => {
    const honestInitial = state();
    const honest = buildHonestTranscript(honestInitial);
    const altered = createOfficialDailyFritzHandState({
      deal: {
        player_tiles: [{ low: 0, high: 0 }],
        fritz_tiles: [{ low: 1, high: 1 }],
        boneyard: [],
        locked: [],
      },
      handIndex: 0,
      drawWinner: 'you',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });
    expect(() => verify(honest, altered)).toThrow();
  });

  it('rejects skipped actions and a substituted Fritz command in a full transcript', () => {
    const initial = createOfficialDailyFritzHandState({
      deal: generateSingleDailyFritzGameHand('2026-07-14', 1, 0, 7),
      handIndex: 0,
      drawWinner: 'bot',
      winningScore: 60,
      dealSize: 7,
      playerScore: 0,
      fritzScore: 0,
    });
    const honest = buildHonestTranscript(initial);
    const skipped = {
      ...honest,
      actions: honest.actions.slice(1).map((action, sequence) => ({ ...action, sequence })),
    };
    expect(() => verify(skipped, initial)).toThrow();
    const fritzIndex = honest.actions.findIndex((action) => action.actor === 'fritz');
    expect(fritzIndex).toBeGreaterThanOrEqual(0);
    const substituted = {
      ...honest,
      actions: honest.actions.map((action, index) => index === fritzIndex
        ? { sequence: action.sequence, actor: 'fritz' as const, kind: 'pass' as const }
        : action),
    };
    expect(() => verify(substituted, initial)).toThrow(/official policy|legal|turn/i);
  });

  it('produces stable digests for idempotent retries and different digests for conflicts', () => {
    const honest = transcript([{ sequence: 0, actor: 'player', kind: 'play', tile: { low: 6, high: 6 }, position: 'left' }]);
    expect(digestDailyFritzTranscript(honest)).toBe(digestDailyFritzTranscript(structuredClone(honest)));
    expect(digestDailyFritzTranscript(honest)).not.toBe(digestDailyFritzTranscript({
      ...honest,
      actions: [{ sequence: 0, actor: 'player', kind: 'pass' }],
    }));
  });

  it('accepts a historically logged empty sibling branch arm that ties the official pick', () => {
    let board = simulatePlacement(null, { low: 5, high: 5 }, 'left');
    board = simulatePlacement(board, { low: 3, high: 5 }, 'right');
    board = simulatePlacement(board, { low: 2, high: 5 }, 'left');
    const initial: GameState = {
      ...state('bot'),
      board,
      handOpen: true,
      players: {
        player: { id: 'player', hand: [{ low: 0, high: 0 }], score: 0 },
        fritz: { id: 'fritz', hand: [{ low: 1, high: 5 }], score: 0 },
      },
      boneyard: [],
      deadTiles: [],
      currentPlayerIndex: 1,
    };
    // Policy chooses branch-0-0; transcript logged the equal-score sibling arm.
    const verified = verify(transcript([
      { sequence: 0, actor: 'fritz', kind: 'play', tile: { low: 1, high: 5 }, position: 'branch-0-1' },
    ]), initial);
    expect(verified.terminalState.handOver).toBe(true);
  });
});
