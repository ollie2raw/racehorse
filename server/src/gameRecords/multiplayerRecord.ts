import type { GhostMoveLogEntry } from '../ghost/service';
import type { RoomMatchEvent } from '../roomEvents';
import { generateFullSet } from '../game/engine';
import type { Config } from '../game/types';

/**
 * A finished multiplayer game, as a record that can be replayed (docs/review-game-record-architecture.md, "Multiplayer: what the code shows").
 *
 * Play vs Fritz is replayable because its deal comes from a seed. A multiplayer deal is random and was never written down, but it is not lost: the
 * server's own per-player move log (`room.ghostMoveLogs`, attached by the server on every accepted action) stores each player's WHOLE hand before every
 * action, so a player's dealt hand for a hand is `hand_before` on their first logged action in it. Draws carry their tile in the event log, and
 * `startNewHand(state, customDeck)` deals hands sequentially from a supplied deck, so hands + draw order is enough to rebuild a hand exactly (the boneyard
 * tiles nobody drew never matter).
 *
 * This module only DERIVES that record from data the room already holds. It changes no authority code, writes nothing and touches no room.
 * `multiplayerRecord.differential.test.ts` plays real games through the real room code and replays the derived record to check every hand's score.
 *
 * Tile keys are `low|high` with low <= high, as the room writes them.
 */

export type RecordedAction =
  | { seat: string; type: 'MOVE'; tile: string; position: string }
  | { seat: string; type: 'DRAW' }
  | { seat: string; type: 'PASS' };

export type RecordedHand = {
  handNumber: number;
  /** The seat that moves first (from the `hand_started` event). */
  starterId: string;
  /** Each seat's dealt hand, as tile keys. */
  deals: Record<string, string[]>;
  /** Submitted actions in order. Forced draws and auto-passes are NOT here: the engine reproduces them. */
  actions: RecordedAction[];
  /** Every tile drawn in this hand, in the order drawn (by either seat). */
  drawn: string[];
  /** Scores after the hand, from the `hand_ended` event. Null for a hand that never ended. */
  endScores: Record<string, number> | null;
};

export type MultiplayerRecordDraft = {
  /** Seat ids in engine order (the order hands are dealt). */
  players: string[];
  /** The rules the game was played under, needed to replay it. */
  config: Config;
  hands: RecordedHand[];
  finalScores: Record<string, number>;
  winnerId: string | null;
};

export type DeriveResult = { ok: true; record: MultiplayerRecordDraft } | { ok: false; reason: string };

type DeriveInput = {
  players: readonly string[];
  /** The game's rules (`room.state.config`). */
  config: Config;
  /** `room.activeTileSetSize`: set only when the room dealt from a custom deck; undefined means the standard set. */
  tileSetSize: number | undefined;
  events: readonly Pick<RoomMatchEvent, 'type' | 'actorSocketId' | 'payload' | 'sequence'>[];
  ghostMoveLogs: Readonly<Record<string, readonly GhostMoveLogEntry[]>>;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function scoresOf(payload: Record<string, unknown>, players: readonly string[]): Record<string, number> | null {
  const raw = payload.scores;
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const seat of players) {
    const v = num((raw as Record<string, unknown>)[seat]);
    if (v === null) return null;
    out[seat] = v;
  }
  return out;
}

/**
 * Builds the record of a FINISHED game, or says why it cannot. Failing is normal and safe (a game restored after a restart, a log with a gap): the caller
 * simply saves nothing for that game.
 */
export function deriveMultiplayerRecord(input: DeriveInput): DeriveResult {
  const { players, ghostMoveLogs } = input;
  if (players.length !== 2) return { ok: false, reason: 'not_two_players' };
  // A room dealt from a custom or smaller set has a different boneyard, so a replay from the standard set would see locked hands differently.
  if (input.tileSetSize !== undefined && input.tileSetSize !== generateFullSet(input.config.maxPips).length) return { ok: false, reason: 'custom_tile_set' };
  const events = [...input.events].sort((a, b) => a.sequence - b.sequence);

  const hands: RecordedHand[] = [];
  let current: RecordedHand | null = null;
  let finalScores: Record<string, number> | null = null;
  let winnerId: string | null = null;
  let previousType: string | null = null;

  for (const event of events) {
    const { type, payload } = event;
    if (type === 'hand_started') {
      const handNumber = num(payload.handNumber);
      const starterId = str(payload.currentPlayerId);
      if (handNumber === null || !starterId || !players.includes(starterId)) return { ok: false, reason: 'bad_hand_started' };
      current = { handNumber, starterId, deals: {}, actions: [], drawn: [], endScores: null };
      hands.push(current);
    } else if (current) {
      if (type === 'draw_requested') {
        const seat = str(payload.playerSeatId);
        if (!seat) return { ok: false, reason: 'bad_draw_requested' };
        current.actions.push({ seat, type: 'DRAW' });
      } else if (type === 'tile_drawn') {
        const tile = str(payload.tile);
        if (!tile) return { ok: false, reason: 'bad_tile_drawn' };
        current.drawn.push(tile);
      } else if (type === 'tile_played') {
        const seat = str(event.actorSocketId);
        const tile = str(payload.tile);
        const position = str(payload.position);
        if (!seat || !tile || !position) return { ok: false, reason: 'bad_tile_played' };
        current.actions.push({ seat, type: 'MOVE', tile, position });
      } else if (type === 'turn_passed') {
        // A pass that follows a draw is the draw running out of boneyard, which the engine reproduces by itself. Any other pass was submitted.
        if (previousType !== 'draw_requested' && previousType !== 'tile_drawn') {
          const seat = str(event.actorSocketId);
          if (!seat) return { ok: false, reason: 'bad_turn_passed' };
          current.actions.push({ seat, type: 'PASS' });
        }
      } else if (type === 'hand_ended') {
        current.endScores = scoresOf(payload, players);
        if (!current.endScores) return { ok: false, reason: 'bad_hand_ended' };
      } else if (type === 'match_ended') {
        finalScores = scoresOf(payload, players);
        winnerId = str(payload.winnerId);
      }
    }
    previousType = type;
  }

  if (!finalScores) return { ok: false, reason: 'not_finished' };
  if (hands.length === 0) return { ok: false, reason: 'no_hands' };

  for (const hand of hands) {
    if (!hand.endScores) return { ok: false, reason: `hand_${hand.handNumber}_not_ended` };
    for (const seat of players) {
      const first = (ghostMoveLogs[seat] ?? []).find((entry) => entry.hand_number === hand.handNumber);
      if (!first || !Array.isArray(first.hand_before) || first.hand_before.length === 0) {
        return { ok: false, reason: `missing_deal:${seat}:${hand.handNumber}` };
      }
      hand.deals[seat] = [...first.hand_before];
    }
  }

  return { ok: true, record: { players: [...players], config: input.config, hands, finalScores, winnerId } };
}
