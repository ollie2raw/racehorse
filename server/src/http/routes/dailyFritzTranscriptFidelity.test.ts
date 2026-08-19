import { describe, expect, it } from 'vitest';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  getDailyFritzAuthorityStateDigest,
  type DailyFritzTranscript,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand, type DailyFritzHandDeal } from '../../dailyFritz';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from '../../dailyFritzVerifier';

// The REAL client pipeline, imported cross-package on purpose. A server-authored
// "honest" driver logs one transcript action per applyGameCommand and therefore
// cannot reproduce a presentation-layer evidence bug. See
// dailyFritzTwoSidedBlockClientTranscript.test.ts for the same rationale.
import {
  applyPlayMove,
  createFixedBotHand,
  drawOne,
  getLegalMoves,
  passTurn,
  type BotMatchState,
  type BotPlayerId,
} from '../../../../client/src/modules/match/runtime/botEngine.ts';
import { toCoreGameState, chooseOfficialFritzBotChoice } from '../../../../client/src/modules/match/runtime/gameCoreAdapter.ts';
import { asPlayMoves } from '../../../../client/src/game/tileUtils.ts';
import { collectPlayerMoveSnapshot } from '../../../../client/src/modules/player-turn/playerMoveSnapshot.ts';
import { collectBotTurnSnapshot } from '../../../../client/src/modules/bot-turn/botMoveSnapshot.ts';
import {
  buildDrawMoveLogEntry,
  buildPassMoveLogEntry,
  buildPlacementMoveLogEntry,
} from '../../../../client/src/modules/player-turn/playerMoveLogEntries.ts';
import {
  buildBotDrawMoveLogEntry,
  buildBotPassMoveLogEntry,
  buildBotPlaceMoveLogEntry,
} from '../../../../client/src/modules/bot-turn/botMoveLogEntries.ts';
import {
  isDailyFritzLockedBoneyardNoMove,
  resolveDailyFritzBlockedHandPass,
} from '../../../../client/src/modules/player-turn/dailyFritzBlockedHand.ts';
import {
  capDailyFritzDrawLogCount,
  resolveTranscriptDrawLogCount,
} from '../../../../client/src/modules/daily/dailyFritzDrawTranscript.ts';
import { isDuplicateDailyFritzActionEvidence } from '../../../../client/src/dailyFritz/dailyFritzMoveEvidence.ts';
import { buildDailyFritzTranscript } from '../../../../client/src/dailyFritz/dailyFritzTranscript.ts';
import { toTileTuple, type MoveEntry } from '../../../../client/src/game/moveLogger.ts';
import { sumTilePips } from '../../../../client/src/game/tileUtils.ts';

const RUN_DATE = '2026-08-18';
const CHALLENGE_ID = 'daily-fritz:2026-08-18';
const ATTEMPT_ID = 'attempt-fidelity';
const FRITZ_TIER = 'elite' as const;
const WINNING_SCORE = 60;
const DEAL_SIZE = 7 as const;

/** Deterministic RNG so a failure is always replayable from its seed. */
function makeRng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * Mirrors useReplayMoveAppender: the production append port, including its
 * Daily Fritz duplicate-evidence guard.
 */
function createMoveLog(dropObservation: (action: MoveEntry['action']) => boolean = () => false) {
  const entries: MoveEntry[] = [];
  let nextMoveNumber = 1;
  return {
    entries,
    append(entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>, handNumber: number) {
      // A cancelled local run, a remounted effect, or a checkpoint written
      // between the engine commit and the presentation append loses this
      // observation. The engine state still advanced.
      if (dropObservation(entry.action)) {
        nextMoveNumber += 1;
        return false;
      }
      if (isDuplicateDailyFritzActionEvidence(entries, entry, handNumber)) return false;
      entries.push({ ...entry, moveNumber: nextMoveNumber, handNumber });
      nextMoveNumber += 1;
      return true;
    },
  };
}

/** Mirrors createRunDrawSequence with animation timers removed. */
function runDrawSequence(initialState: BotMatchState, player: BotPlayerId) {
  let current = initialState;
  let drewAny = false;
  const beforeStates: BotMatchState[] = [];

  while (asPlayMoves(getLegalMoves(current, player)).length === 0) {
    const beforeDraw = current;
    const step = drawOne(beforeDraw, player);
    if (!step.drew) break;
    beforeStates.push(beforeDraw);
    drewAny = true;
    current = step.state;
  }

  if (asPlayMoves(getLegalMoves(current, player)).length === 0) {
    const passResult = passTurn(current, player);
    return { result: { ...passResult, drew: drewAny ? {} : undefined }, beforeStates, passed: true };
  }
  return {
    result: { state: current, drew: drewAny ? {} : undefined },
    beforeStates,
    passed: false,
  };
}

type SimulatedHand = {
  match: BotMatchState;
  moveLog: MoveEntry[];
};

/**
 * Plays one full Daily Fritz hand through the real client modules in the same
 * order the React orchestration calls them (usePlayerNoMoveEffect,
 * usePlayerPlacementHandler, executeBotTurn, completeBotTurnAction).
 */
function simulateHand(
  deal: DailyFritzHandDeal,
  handIndex: number,
  rng: () => number,
  dropObservation?: (action: MoveEntry['action']) => boolean,
): SimulatedHand {
  const matchStarter: BotPlayerId = handIndex % 2 === 0 ? 'you' : 'bot';
  let match = createFixedBotHand(
    { you: 0, bot: 0 },
    handIndex + 1,
    WINNING_SCORE,
    DEAL_SIZE,
    deal,
    matchStarter,
  );
  const log = createMoveLog(dropObservation);
  const handNumber = match.handNumber;

  for (let guard = 0; guard < 400 && !match.handOver && !match.gameOver; guard += 1) {
    if (match.currentPlayer === 'you') {
      const playMoves = asPlayMoves(getLegalMoves(match, 'you'));

      if (playMoves.length > 0) {
        // usePlayerPlacementHandler: the human picks any legal placement.
        const move = playMoves[Math.floor(rng() * playMoves.length)];
        const snapshot = collectPlayerMoveSnapshot(match, playMoves);
        const result = applyPlayMove(match, 'you', move);
        if (result.error) throw new Error(`player play rejected: ${result.error.message}`);
        const afterPips = sumTilePips(result.state.players.you.hand);
        log.append(
          buildPlacementMoveLogEntry(
            match,
            snapshot,
            move.tile!,
            move.position!,
            afterPips,
            result.scored?.points ?? 0,
            'hard',
          ),
          handNumber,
        );
        match = result.state;
        continue;
      }

      // usePlayerNoMoveEffect
      const snapshot = collectPlayerMoveSnapshot(match, []);
      const boneyardBefore = match.boneyard.length;

      if (isDailyFritzLockedBoneyardNoMove(match)) {
        const resolution = resolveDailyFritzBlockedHandPass(match);
        for (const pass of resolution.passes) {
          if (pass.player === 'you') {
            log.append(buildPassMoveLogEntry(pass.before, snapshot, 'hard'), handNumber);
          } else {
            log.append(buildBotPassMoveLogEntry(collectBotTurnSnapshot(pass.before), null), handNumber);
          }
        }
        match = resolution.result.state;
        continue;
      }

      const sequence = runDrawSequence(match, 'you');
      let drawCount = sequence.beforeStates.length;
      const drawSnapshots = sequence.beforeStates.map((state) => collectPlayerMoveSnapshot(state, []));
      drawCount = Math.max(drawCount, boneyardBefore - sequence.result.state.boneyard.length);

      if (sequence.result.drew) {
        const drawLogCount = capDailyFritzDrawLogCount(
          true,
          resolveTranscriptDrawLogCount(true, drawCount),
          drawSnapshots.length,
        );
        for (let index = 0; index < drawLogCount; index += 1) {
          log.append(
            buildDrawMoveLogEntry(match, drawSnapshots[index] ?? snapshot, 'hard'),
            handNumber,
          );
        }
      }
      if (sequence.passed) {
        log.append(buildPassMoveLogEntry(match, snapshot, 'hard'), handNumber);
      }
      match = sequence.result.state;
      continue;
    }

    // executeBotTurn
    const snapshot = collectBotTurnSnapshot(match);
    const botPlayable = asPlayMoves(getLegalMoves(match, 'bot'));
    let working = match;
    let passed = false;
    let drawCount = 0;
    let onStepDrawCount = 0;
    let playBeforeState: BotMatchState | null = null;
    let placed: { tile: [number, number]; position: string } | null = null;
    let nextState = match;

    if (botPlayable.length === 0) {
      const boneyardBefore = working.boneyard.length;
      const sequence = runDrawSequence(working, 'bot');
      onStepDrawCount = sequence.beforeStates.length;
      working = sequence.result.state;
      drawCount = Math.max(onStepDrawCount, boneyardBefore - working.boneyard.length);
      const afterDraw = asPlayMoves(getLegalMoves(working, 'bot'));
      if (afterDraw.length === 0) {
        passed = sequence.passed;
        nextState = working;
      } else {
        const chosen = chooseOfficialFritzBotChoice(working, 'hard', FRITZ_POLICY_VERSION);
        if (!chosen?.move) throw new Error('official Fritz policy returned no play');
        playBeforeState = working;
        const result = applyPlayMove(working, 'bot', chosen.move);
        if (result.error) throw new Error(`fritz play rejected: ${result.error.message}`);
        placed = { tile: toTileTuple(chosen.move.tile!), position: chosen.move.position! };
        nextState = result.state;
      }
    } else {
      const chosen = chooseOfficialFritzBotChoice(working, 'hard', FRITZ_POLICY_VERSION);
      if (!chosen?.move) throw new Error('official Fritz policy returned no play');
      playBeforeState = working;
      const result = applyPlayMove(working, 'bot', chosen.move);
      if (result.error) throw new Error(`fritz play rejected: ${result.error.message}`);
      placed = { tile: toTileTuple(chosen.move.tile!), position: chosen.move.position! };
      nextState = result.state;
    }

    // completeBotTurnAction ordering: draws, then pass, then the play.
    const drawLogCount = capDailyFritzDrawLogCount(
      true,
      resolveTranscriptDrawLogCount(true, drawCount),
      onStepDrawCount,
    );
    for (let index = 0; index < drawLogCount; index += 1) {
      log.append(buildBotDrawMoveLogEntry(snapshot, null), handNumber);
    }
    if (passed) {
      log.append(buildBotPassMoveLogEntry(snapshot, null), handNumber);
    }
    if (placed) {
      log.append(
        buildBotPlaceMoveLogEntry({
          snapshot,
          tile: { low: placed.tile[0], high: placed.tile[1] },
          position: placed.position as never,
          engineBestMove: null,
          authorityPreStateDigest: playBeforeState
            ? getDailyFritzAuthorityStateDigest(toCoreGameState(playBeforeState))
            : undefined,
        }),
        handNumber,
      );
    }
    match = nextState;
  }

  return { match, moveLog: log.entries };
}

/** Mirrors buildDailyFritzPrefetchParams' seal decision. */
function buildTranscriptForHand(
  hand: SimulatedHand,
  handIndex: number,
  useJournal = false,
): DailyFritzTranscript {
  const { match, moveLog } = hand;
  return buildDailyFritzTranscript({
    ...(useJournal ? { journal: match.officialJournal ?? null } : {}),
    attemptPredatesJournalRollout: !useJournal,
    challengeId: CHALLENGE_ID,
    attemptId: ATTEMPT_ID,
    gameNumber: 1,
    handIndex,
    handNumber: match.handNumber,
    moveLog,
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    sealBlockedHand:
      match.handOver
      && match.players.you.hand.length > 0
      && match.players.bot.hand.length > 0
      && match.boneyard.length <= match.deadTiles.length
        ? {
            consecutivePasses: match.consecutivePasses,
            nextActor: match.currentPlayer === 'you' ? 'player' : 'fritz',
          }
        : null,
  });
}

function verifyHand(transcript: DailyFritzTranscript, deal: DailyFritzHandDeal, handIndex: number) {
  return verifyDailyFritzHand({
    transcript,
    initialState: createOfficialDailyFritzHandState({
      deal,
      handIndex,
      drawWinner: handIndex % 2 === 0 ? 'you' : 'fritz',
      winningScore: WINNING_SCORE,
      dealSize: DEAL_SIZE,
      playerScore: 0,
      fritzScore: 0,
    }),
    expectedChallengeId: CHALLENGE_ID,
    expectedAttemptId: ATTEMPT_ID,
    expectedGameNumber: 1,
    expectedHandIndex: handIndex,
    userId: 'user-fidelity',
    fritzTier: FRITZ_TIER,
  });
}

type FidelitySweep = {
  handsPlayed: number;
  failures: number;
  byCode: Record<string, number>;
  samples: Array<{ seed: number; handIndex: number; code: string; message: string }>;
};

function sweep(
  dropObservation?: (action: MoveEntry['action'], rng: () => number) => boolean,
  useJournal = false,
): FidelitySweep {
  const samples: FidelitySweep['samples'] = [];
  const byCode: Record<string, number> = {};
  let handsPlayed = 0;
  let failures = 0;

  for (let seed = 1; seed <= 200; seed += 1) {
    const rng = makeRng(seed * 7919);
    for (let handIndex = 0; handIndex < 4; handIndex += 1) {
      const deal = generateSingleDailyFritzGameHand(RUN_DATE, 1, handIndex + seed * 4, DEAL_SIZE);
      // Perturbation draws from its own stream so the sweeps play IDENTICAL
      // games with and without observation loss.
      const noiseRng = makeRng(seed * 104729 + handIndex);
      const hand = simulateHand(
        deal,
        handIndex,
        rng,
        dropObservation ? (action) => dropObservation(action, noiseRng) : undefined,
      );
      if (!hand.match.handOver) continue;
      handsPlayed += 1;

      try {
        verifyHand(buildTranscriptForHand(hand, handIndex, useJournal), deal, handIndex);
      } catch (error) {
        failures += 1;
        const code = error instanceof DailyFritzVerificationError ? error.code : 'non_verifier_error';
        byCode[code] = (byCode[code] ?? 0) + 1;
        if (samples.length < 5) {
          samples.push({
            seed,
            handIndex,
            code,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  return { handsPlayed, failures, byCode, samples };
}

/**
 * The recorder misses an engine action: a cancelled local run, a remounted
 * effect, or a checkpoint written between the engine commit and the append.
 * This is the production mechanism behind the stranded-player incidents.
 */
const DROPPED_OBSERVATION = (action: MoveEntry['action'], rng: () => number) =>
  action !== 'place' && rng() < 0.35;

describe('Daily Fritz transcript fidelity', () => {
  it('verifies every cleanly observed hand from either evidence source', () => {
    const moveLogSweep = sweep();
    const journalSweep = sweep(undefined, true);

    expect(moveLogSweep.handsPlayed).toBeGreaterThan(300);
    expect(moveLogSweep.failures).toBe(0);
    expect(journalSweep.failures).toBe(0);
  }, 120_000);

  it('reproduces the production stranding codes when the move log misses an action', () => {
    const result = sweep(DROPPED_OBSERVATION);

    // Guards the regression story: if this ever reaches zero, the move-log
    // reconstruction path is no longer the thing the journal is protecting
    // against, and this whole test file should be revisited.
    expect(result.failures).toBeGreaterThan(0);
    expect(Object.keys(result.byCode).sort()).toEqual(
      expect.arrayContaining(['incomplete_transcript', 'wrong_actor']),
    );
  }, 120_000);

  it('never strands a player when the journal is the evidence, under the same loss', () => {
    // The journal is written inside the state transition, so a lost
    // presentation-layer observation cannot desynchronise it from the state.
    const result = sweep(DROPPED_OBSERVATION, true);

    expect(result.handsPlayed).toBeGreaterThan(300);
    expect({ failures: result.failures, byCode: result.byCode, samples: result.samples }).toEqual({
      failures: 0,
      byCode: {},
      samples: [],
    });
  }, 120_000);
});
