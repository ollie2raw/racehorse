import {
  GAME_RULES_VERSION,
  applyMove,
  canDraw,
  createInitialState,
  drawOne,
  finalizeMandatoryAutoPasses,
  generateFullSet,
  getLegalMoves,
  startNewHand,
} from '../game/engine';
import type { GameState, PlacementPosition, Tile } from '../game/types';
import type { MultiplayerRecordDraft, RecordedAction } from './multiplayerRecord';

/**
 * Replays a derived multiplayer record through the game engine ALONE and checks it against what the server recorded. This is the verification step for a
 * saved game (docs/review-game-record-architecture.md, item 6): a record whose replay does not land on the same scores is not trusted.
 *
 * Pure. It never touches a room, so unlike the `act()`-based replay in multiplayerRecord.differential.test.ts it can run in production (that one persists its
 * room through the live-room hook). It mirrors what `act()` does to the STATE for each action and nothing else; the animation bookkeeping is not needed:
 *   MOVE  applyMove (a forced draw after the play is resolved inside it), then the mandatory auto-passes
 *   DRAW  draw until a play exists or the drawable boneyard is empty (then pass), then the mandatory auto-passes
 *   PASS  applyMove pass, then the mandatory auto-passes
 */

export type ReplayResult =
  | { ok: true; handScores: Array<Record<string, number>>; finalScores: Record<string, number>; winnerId: string | null }
  | { ok: false; reason: string };

const tileOf = (key: string): Tile => {
  const [low, high] = key.split('|').map(Number);
  return { low, high };
};
const keyOf = (t: Tile) => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;
const validKey = (key: string) => /^\d+\|\d+$/.test(key);

function drawUntilPlayable(state: GameState, seat: string): GameState {
  if (getLegalMoves(state, seat).some((m) => m.type === 'play')) throw new Error('a play was available');
  let current = state;
  while (getLegalMoves(current, seat).every((m) => m.type !== 'play')) {
    const step = drawOne(current, seat);
    if (!step.drew) return applyMove(current, seat, { type: 'pass' }).state;
    current = step.state;
  }
  return current;
}

function apply(state: GameState, action: RecordedAction): GameState {
  // The engine rejects an out-of-turn action too; this makes the rule explicit rather than relying on it.
  if (state.playerIds[state.currentPlayerIndex] !== action.seat) throw new Error('not that seat\'s turn');
  let next: GameState;
  if (action.type === 'MOVE') {
    next = applyMove(state, action.seat, { type: 'play', tile: tileOf(action.tile), position: action.position as PlacementPosition }).state;
  } else if (action.type === 'DRAW') {
    if (!canDraw(state, action.seat)) throw new Error('cannot draw');
    next = drawUntilPlayable(state, action.seat);
  } else {
    next = applyMove(state, action.seat, { type: 'pass' }).state;
  }
  return finalizeMandatoryAutoPasses(next).state;
}

const scoresOf = (state: GameState): Record<string, number> => Object.fromEntries(state.playerIds.map((p) => [p, state.players[p].score]));
const sameScores = (a: Record<string, number>, b: Record<string, number>) => a && b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

export function replayMultiplayerRecord(record: MultiplayerRecordDraft): ReplayResult {
  // A record from a different rules version cannot be replayed faithfully; say so instead of reporting a score mismatch. No field means version 1.
  const rulesVersion = record.rulesVersion ?? 1;
  if (rulesVersion !== GAME_RULES_VERSION) return { ok: false, reason: `unsupported_rules_version:${rulesVersion}` };
  try {
    const full = generateFullSet(record.config.maxPips);
    let state = createInitialState(record.players, record.config);
    const handScores: Array<Record<string, number>> = [];

    for (const hand of record.hands) {
      const used = new Set<string>();
      const deck: Tile[] = [];
      const take = (key: string): string | null => {
        if (!validKey(key) || used.has(key)) return `bad_or_repeated_tile:${key}`;
        used.add(key);
        deck.push(tileOf(key));
        return null;
      };
      for (const seat of record.players) {
        const dealt = hand.deals[seat] ?? [];
        if (dealt.length !== record.config.tilesPerPlayer) return { ok: false, reason: `bad_deal_size:${seat}:${hand.handNumber}` };
        for (const key of dealt) {
          const problem = take(key);
          if (problem) return { ok: false, reason: problem };
        }
      }
      for (const key of hand.drawn) {
        const problem = take(key);
        if (problem) return { ok: false, reason: problem };
      }
      for (const t of full) if (!used.has(keyOf(t))) deck.push(t); // never drawn, so their order cannot matter
      if (deck.length !== full.length) return { ok: false, reason: `not_the_standard_set:${hand.handNumber}` };

      state = startNewHand(state, deck, hand.starterId);
      if (state.handNumber !== hand.handNumber) return { ok: false, reason: `hand_number_mismatch:${hand.handNumber}` };
      const boneyardAtStart = state.boneyard.length;

      for (const action of hand.actions) {
        try {
          state = apply(state, action);
        } catch (err) {
          return { ok: false, reason: `illegal_action:hand_${hand.handNumber}:${action.seat}:${action.type}:${err instanceof Error ? err.message : 'failed'}` };
        }
      }

      if (!state.handOver) return { ok: false, reason: `hand_not_over:${hand.handNumber}` };
      if (boneyardAtStart - state.boneyard.length !== hand.drawn.length) return { ok: false, reason: `draw_count_mismatch:${hand.handNumber}` };
      const scores = scoresOf(state);
      if (!hand.endScores || !sameScores(scores, hand.endScores)) return { ok: false, reason: `score_mismatch:hand_${hand.handNumber}` };
      handScores.push(scores);
    }

    if (!state.gameOver) return { ok: false, reason: 'game_not_over' };
    const finalScores = scoresOf(state);
    if (!sameScores(finalScores, record.finalScores)) return { ok: false, reason: 'final_score_mismatch' };
    if ((state.winnerId ?? null) !== (record.winnerId ?? null)) return { ok: false, reason: 'winner_mismatch' };
    return { ok: true, handScores, finalScores, winnerId: state.winnerId ?? null };
  } catch (err) {
    return { ok: false, reason: `replay_failed:${err instanceof Error ? err.message : 'unknown'}` };
  }
}
