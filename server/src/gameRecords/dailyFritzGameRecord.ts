import type { GameState, Tile } from '@racehorse/game-core';
import { GAME_RULES_VERSION } from '../game/engine';
import type { DailyFritzHandReplay } from '../dailyFritzHandReplay';
import type { MultiplayerRecordDraft, RecordedAction, RecordedHand } from './multiplayerRecord';

/**
 * A finished Daily Fritz game as a replayable record (docs/daily-fritz-review-design.md, DF-3).
 *
 * It deliberately has the SAME shape as a multiplayer record (`MultiplayerRecordDraft`, players "you" and "opponent"), so the server's pure replay
 * (`replayMultiplayerRecord`), the client's rebuild and the saved-game review all work on it unchanged. The opponent is Fritz.
 *
 * It is built from DF-1 hand replays, i.e. from the engine commands the verifier itself applied, never from a transcript read on its own. Pure: it reads
 * nothing, writes nothing and touches no room or attempt.
 *
 * Two differences between the two formats are bridged here:
 *   - Daily Fritz logs each draw as its own command, and every pass; the multiplayer format logs "draw until a play exists" as ONE action (the engine's own
 *     replay draws and, if the pile runs out, passes inside it) and does not log forced passes at all (its replay applies the mandatory auto-passes after every
 *     action). So a run of draws by one seat is one DRAW, and every pass is dropped: a pass is only legal with no play and no draw, i.e. it is always forced.
 *   - The multiplayer format lists the tiles drawn, in order, per hand (`drawn`); here they are read off the boneyard before and after every command, which
 *     also covers a draw the engine resolves inside a play.
 */

export type OkHandReplay = Extract<DailyFritzHandReplay, { ok: true }>;

const SEAT_OF: Record<string, 'you' | 'opponent'> = { player: 'you', fritz: 'opponent' };
const key = (t: Tile) => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;

export type DailyFritzGameRecordResult =
  | {
      ok: true;
      record: MultiplayerRecordDraft;
      /** Engine commands the verifier had to infer across the whole game (0 means the client's transcripts were complete). */
      inferredStepCount: number;
    }
  | { ok: false; reason: string };

function seatOf(actorId: string): 'you' | 'opponent' | null {
  return SEAT_OF[actorId] ?? null;
}

function tilesDrawnBetween(before: GameState, after: GameState): string[] {
  const remaining = new Map<string, number>();
  for (const tile of after.boneyard) remaining.set(key(tile), (remaining.get(key(tile)) ?? 0) + 1);
  const out: string[] = [];
  for (const tile of before.boneyard) {
    const k = key(tile);
    const left = remaining.get(k) ?? 0;
    if (left > 0) remaining.set(k, left - 1);
    else out.push(k);
  }
  return out;
}

function recordHand(replay: OkHandReplay): { hand: RecordedHand } | { reason: string } {
  const { initialState, terminalState, steps } = replay;
  const starter = seatOf(initialState.playerIds[initialState.currentPlayerIndex] ?? '');
  const you = initialState.players.player;
  const fritz = initialState.players.fritz;
  if (!starter || !you || !fritz) return { reason: 'unexpected_players' };

  const actions: RecordedAction[] = [];
  const drawn: string[] = [];
  let drawRunSeat: 'you' | 'opponent' | null = null;
  for (const step of steps) {
    const command = step.command;
    const seat = seatOf(command.actorId);
    if (!seat) return { reason: 'unexpected_actor' };
    drawn.push(...tilesDrawnBetween(step.before, step.after));
    if (command.kind === 'draw') {
      if (drawRunSeat !== seat) actions.push({ seat, type: 'DRAW' });
      drawRunSeat = seat;
    } else if (command.kind === 'pass') {
      // A pass is only legal when a seat has no play and no draw, which is exactly a forced pass. The multiplayer format does not log those ("the engine
      // reproduces them"; its replay applies the mandatory auto-passes after every action), so replaying a logged one would be refused as out of turn.
      drawRunSeat = null;
    } else if (command.kind === 'play') {
      drawRunSeat = null;
      actions.push({ seat, type: 'MOVE', tile: key(command.tile), position: command.position });
    } else {
      return { reason: `unexpected_command:${(command as { kind: string }).kind}` };
    }
  }

  return {
    hand: {
      handNumber: initialState.handNumber,
      starterId: starter,
      deals: { you: you.hand.map(key), opponent: fritz.hand.map(key) },
      actions,
      drawn,
      endScores: { you: terminalState.players.player.score, opponent: terminalState.players.fritz.score },
    },
  };
}

/**
 * Builds the record of one finished game from its hands' replays, in hand order. It refuses (with a reason, never a throw) anything that is not one
 * contiguous, finished game: a missing hand, a hand that does not continue the previous score, or a game that has not ended.
 */
export function buildDailyFritzGameRecord(replays: readonly OkHandReplay[]): DailyFritzGameRecordResult {
  if (replays.length === 0) return { ok: false, reason: 'no_hands' };
  const first = replays[0]!.initialState;
  const hands: RecordedHand[] = [];
  let inferredStepCount = 0;

  for (let i = 0; i < replays.length; i += 1) {
    const replay = replays[i]!;
    if (replay.initialState.handNumber !== i + 1) return { ok: false, reason: `hand_gap:${i + 1}` };
    if (i > 0) {
      const previous = replays[i - 1]!.terminalState;
      if (previous.gameOver) return { ok: false, reason: `hand_after_game_over:${i + 1}` };
      if (replay.initialState.players.player.score !== previous.players.player.score || replay.initialState.players.fritz.score !== previous.players.fritz.score) {
        return { ok: false, reason: `score_gap:${i + 1}` };
      }
    }
    const built = recordHand(replay);
    if ('reason' in built) return { ok: false, reason: built.reason };
    hands.push(built.hand);
    inferredStepCount += replay.inferredStepCount;
  }

  const last = replays[replays.length - 1]!.terminalState;
  if (!last.gameOver) return { ok: false, reason: 'game_not_over' };
  const winner = last.winnerId === null || last.winnerId === undefined ? null : seatOf(last.winnerId);

  return {
    ok: true,
    inferredStepCount,
    record: {
      players: ['you', 'opponent'],
      config: first.config,
      rulesVersion: GAME_RULES_VERSION,
      hands,
      finalScores: { you: last.players.player.score, opponent: last.players.fritz.score },
      winnerId: winner,
    },
  };
}
