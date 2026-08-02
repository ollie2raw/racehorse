import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  GAME_RULES_VERSION,
  applyGameCommand,
  canDraw,
  chooseOfficialFritzDecisionForVersion,
  getDailyFritzAuthorityStateDigest,
  getFritzPolicyContract,
  getLegalMoves,
  type DailyFritzTranscript,
  type DailyFritzTranscriptAction,
  type GameCommand,
  type GameState,
} from '@racehorse/game-core';
import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from '../dailyFritz';
import { createOfficialDailyFritzHandState } from '../dailyFritzVerifier';

export type DailyFritzProtocolHandInput = {
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  deal: DailyFritzHandDeal;
  drawWinner: DailyFritzDrawWinner;
  winningScore: number;
  dealSize: 7 | 14;
  playerScore: number;
  fritzScore: number;
  fritzTier: DailyFritzTier;
  fritzPolicyVersion: 1 | 2;
  clientRelease?: string;
  playerPolicy?: 'first_legal' | 'last_legal';
};

/**
 * Drives the real shared core and official Fritz policy to produce protocol
 * evidence. This is test/soak infrastructure, not a second gameplay engine.
 */
export function buildHonestDailyFritzHandTranscript(input: DailyFritzProtocolHandInput): {
  transcript: DailyFritzTranscript;
  terminalState: GameState;
} {
  let state = createOfficialDailyFritzHandState({
    deal: input.deal,
    handIndex: input.handIndex,
    drawWinner: input.drawWinner,
    winningScore: input.winningScore,
    dealSize: input.dealSize,
    playerScore: input.playerScore,
    fritzScore: input.fritzScore,
  });
  const actions: DailyFritzTranscriptAction[] = [];

  for (let sequence = 0; sequence < 512 && !state.handOver; sequence += 1) {
    const actorId = state.playerIds[state.currentPlayerIndex];
    const actor = actorId === 'player' ? 'player' as const : 'fritz' as const;
    const preStateDigest = getDailyFritzAuthorityStateDigest(state);
    const decision = actor === 'fritz'
      ? chooseOfficialFritzDecisionForVersion({
          version: input.fritzPolicyVersion,
          state,
          participantId: 'fritz',
          tier: input.fritzTier,
        })
      : (() => {
          const legalPlays = getLegalMoves(state, 'player').filter((move) => move.type === 'play');
          const play = input.playerPolicy === 'last_legal'
            ? legalPlays[legalPlays.length - 1]
            : legalPlays[0];
          if (play?.type === 'play') {
            return { kind: 'play' as const, tile: play.tile, position: play.position };
          }
          return canDraw(state, 'player')
            ? { kind: 'draw' as const }
            : { kind: 'pass' as const };
        })();
    const action: DailyFritzTranscriptAction = decision.kind === 'play'
      ? { sequence, actor, kind: 'play', tile: decision.tile, position: decision.position, preStateDigest }
      : { sequence, actor, kind: decision.kind, preStateDigest };
    actions.push(action);
    const command: GameCommand = action.kind === 'play'
      ? {
          version: 1,
          commandId: `protocol-driver:${input.gameNumber}:${input.handIndex}:${sequence}`,
          sequence: state.sequence,
          actorId,
          kind: 'play',
          tile: action.tile,
          position: action.position,
        }
      : {
          version: 1,
          commandId: `protocol-driver:${input.gameNumber}:${input.handIndex}:${sequence}`,
          sequence: state.sequence,
          actorId,
          kind: action.kind,
        };
    state = applyGameCommand(state, command).state;
  }

  if (!state.handOver) throw new Error('Daily Fritz protocol driver exceeded 512 actions.');
  return {
    terminalState: state,
    transcript: {
      protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      rulesVersion: GAME_RULES_VERSION,
      fritzPolicyVersion: input.fritzPolicyVersion,
      fritzPolicyContract: getFritzPolicyContract(input.fritzPolicyVersion),
      stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
      clientRelease: input.clientRelease ?? 'daily-fritz-authority-soak',
      challengeId: input.challengeId,
      attemptId: input.attemptId,
      gameNumber: input.gameNumber,
      handIndex: input.handIndex,
      actions,
    },
  };
}
