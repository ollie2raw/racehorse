import type { PlacementPosition, Tile } from '../../types.ts';
import {
  createFixedBotMatchWithStarter,
  generateDoubleSixSet,
  getLegalMoves,
  startNextFixedBotHand,
  type BotDealSize,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import type { ReviewActorAction } from './ReviewSnapshotRecorder.ts';
import { createReplayStepper } from './replayStepper.ts';
import type { RebuildResult } from './rebuildGameFromRecord.ts';

/**
 * A saved multiplayer game as the server stores it (server/src/gameRecords/saveMultiplayerRecord.ts): both seats are "you" and "opponent", each hand's deal is
 * explicit (a multiplayer deal is random, so there is no seed), and the actions are only what the players SUBMITTED. Forced draws after a play, the drawing a
 * DRAW action runs until a play exists, and the passes the engine makes for a seat that cannot move are not in the list: the engine reproduces them.
 */
export type SavedMultiplayerRecord = {
  sourceMatchId: string;
  mode: 'mp';
  dealSize: 7 | 14 | null;
  winningScore: number | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  verification: 'replay_verified' | 'replay_mismatch' | 'unverified';
  playedAt: string | null;
  opponentName: string | null;
  record: MultiplayerRecordPayload;
};

export type MultiplayerRecordPayload = {
  players: ReadonlyArray<'you' | 'opponent'>;
  config: { maxPips: number; tilesPerPlayer: number; deadTileCount: number; winningScore: number };
  hands: ReadonlyArray<{
    handNumber: number;
    starterId: 'you' | 'opponent';
    deals: { you?: readonly string[]; opponent?: readonly string[] };
    actions: ReadonlyArray<
      | { seat: 'you' | 'opponent'; type: 'MOVE'; tile: string; position: string }
      | { seat: 'you' | 'opponent'; type: 'DRAW' }
      | { seat: 'you' | 'opponent'; type: 'PASS' }
    >;
    drawn: readonly string[];
    endScores: { you: number; opponent: number } | null;
  }>;
  finalScores: { you: number; opponent: number };
  winnerId: 'you' | 'opponent' | null;
};

const seatToActor = (seat: 'you' | 'opponent'): BotPlayerId => (seat === 'you' ? 'you' : 'bot');
const tileKey = (t: Tile) => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;

function parseTile(key: string): Tile | null {
  const match = /^(\d+)\|(\d+)$/.exec(key);
  return match ? { low: Number(match[1]), high: Number(match[2]) } : null;
}

const fail = (detail: string, entryIndex?: number): RebuildResult => ({ ok: false, reason: 'not_replayable', detail, entryIndex });

/**
 * Builds one hand's deal the way the engine wants it: both hands, and a boneyard in DRAW order (the tiles actually drawn first; the rest never mattered)
 * ending in the locked tiles.
 */
function buildDeal(
  hand: MultiplayerRecordPayload['hands'][number],
  deadTileCount: number,
): { ok: true; deal: { player_tiles: Tile[]; fritz_tiles: Tile[]; boneyard: Tile[]; locked: Tile[] } } | { ok: false; detail: string } {
  const used = new Set<string>();
  const take = (keys: readonly string[]): Tile[] | null => {
    const out: Tile[] = [];
    for (const key of keys) {
      const tile = parseTile(key);
      if (!tile || used.has(tileKey(tile))) return null;
      used.add(tileKey(tile));
      out.push(tile);
    }
    return out;
  };
  const you = take(hand.deals.you ?? []);
  const opponent = take(hand.deals.opponent ?? []);
  const drawn = take(hand.drawn);
  if (!you || !opponent || !drawn) return { ok: false, detail: `Hand ${hand.handNumber} has a malformed or repeated tile.` };
  const unused = generateDoubleSixSet().filter((t) => !used.has(tileKey(t)));
  if (unused.length < deadTileCount) return { ok: false, detail: `Hand ${hand.handNumber} leaves too few tiles for the locked ones.` };
  const locked = unused.slice(unused.length - deadTileCount);
  const rest = unused.slice(0, unused.length - deadTileCount);
  // As in the engine's own deals, the boneyard INCLUDES the locked tail: drawable tiles are the boneyard minus the locked ones.
  return { ok: true, deal: { player_tiles: you, fritz_tiles: opponent, boneyard: [...drawn, ...rest, ...locked], locked } };
}

const hasPlay = (state: BotMatchState, actor: BotPlayerId) => getLegalMoves(state, actor).some((m) => m.type === 'play');

/**
 * Replay a saved multiplayer game through the same engine and the same snapshot recorder the live match uses, and hand back what the review pipeline wants,
 * in the same shape as a Play vs Fritz rebuild. Every step is checked (the seat on turn, the legality of the action, each hand's score, the final score);
 * anything else is an honest failure, never a guess.
 */
export function rebuildMultiplayerGameFromRecord(saved: SavedMultiplayerRecord): RebuildResult {
  const rec = saved.record;
  if (rec.config.maxPips !== 6) return fail('Only double-six games can be replayed.');
  const dealSize: BotDealSize = rec.config.tilesPerPlayer === 14 ? 14 : 7;
  const winningScore = saved.winningScore ?? rec.config.winningScore ?? 60;
  const first = rec.hands[0];
  if (!first) return fail('The record has no hands.');

  const stepper = createReplayStepper(saved.sourceMatchId);
  let state: BotMatchState | null = null;
  let index = 0;

  const run = (actor: BotPlayerId, action: ReviewActorAction): string | null => {
    const stepped = stepper.step(state!, actor, action);
    if (!stepped.ok) return stepped.detail;
    state = stepped.state;
    index += 1;
    return null;
  };
  const drawable = () => Math.max(0, state!.boneyard.length - state!.deadTiles.length);

  /** The engine passes for a seat that has no play and nothing left to draw. */
  const settlePasses = (): string | null => {
    for (let guard = 0; guard < 8 && !state!.handOver && !state!.gameOver; guard += 1) {
      const actor = state!.currentPlayer;
      if (hasPlay(state!, actor) || drawable() > 0) return null;
      const problem = run(actor, { kind: 'pass' });
      if (problem) return problem;
    }
    return null;
  };
  /** Draws until a play exists or the drawable boneyard is empty, then passes if still stuck: what a DRAW does, and what a forced draw after a play does. */
  const drawChain = (actor: BotPlayerId): string | null => {
    for (let guard = 0; guard < 40 && !state!.handOver && state!.currentPlayer === actor && !hasPlay(state!, actor); guard += 1) {
      const problem = drawable() > 0 ? run(actor, { kind: 'draw' }) : run(actor, { kind: 'pass' });
      if (problem) return problem;
    }
    return null;
  };

  for (let h = 0; h < rec.hands.length; h += 1) {
    const hand = rec.hands[h]!;
    const built = buildDeal(hand, rec.config.deadTileCount);
    if (!built.ok) return fail(built.detail, index);
    if (h === 0) {
      state = createFixedBotMatchWithStarter(built.deal, seatToActor(hand.starterId), winningScore, dealSize);
    } else {
      if (!state!.handOver) return fail(`Hand ${hand.handNumber} starts before hand ${rec.hands[h - 1]!.handNumber} is over.`, index);
      state = startNextFixedBotHand(state!, built.deal);
    }
    if (state!.handNumber !== hand.handNumber) return fail(`Hand ${hand.handNumber} was replayed as hand ${state!.handNumber}.`, index);
    if (state!.currentPlayer !== seatToActor(hand.starterId)) return fail(`Hand ${hand.handNumber} should start with ${hand.starterId}.`, index);

    for (const action of hand.actions) {
      if (state!.handOver || state!.gameOver) return fail('The record continues after the hand is over.', index);
      const actor = seatToActor(action.seat);
      if (state!.currentPlayer !== actor) return fail(`${actor} acted but it was ${state!.currentPlayer}'s turn.`, index);

      let problem: string | null;
      if (action.type === 'MOVE') {
        const tile = parseTile(action.tile);
        if (!tile) return fail('A move names a malformed tile.', index);
        problem = run(actor, { kind: 'play', tile, position: action.position as PlacementPosition });
        // A scoring play or a double keeps the turn, and with nothing playable the engine draws on for the mover INSIDE the play, so there is nothing to add
        // here (a test that removed a step for this changed no result across 24 real games). A DRAW action is different: the engine draws one tile per call.
      } else if (action.type === 'DRAW') {
        if (hasPlay(state!, actor)) return fail('A draw was submitted while a play was available.', index);
        problem = drawChain(actor);
      } else {
        problem = run(actor, { kind: 'pass' });
      }
      if (problem) return fail(problem, index);
      problem = settlePasses();
      if (problem) return fail(problem, index);
    }

    if (!state!.handOver) return fail(`Hand ${hand.handNumber} did not finish.`, index);
    const end = hand.endScores;
    if (!end || state!.players.you.score !== end.you || state!.players.bot.score !== end.opponent) {
      return {
        ok: false,
        reason: 'result_mismatch',
        detail: `Hand ${hand.handNumber} replayed ${state!.players.you.score}-${state!.players.bot.score}, the record says ${end ? `${end.you}-${end.opponent}` : 'nothing'}.`,
      };
    }
  }

  if (!state!.gameOver) return { ok: false, reason: 'incomplete_game', detail: 'The record does not finish the game.' };
  if (state!.players.you.score !== saved.result.you || state!.players.bot.score !== saved.result.opponent) {
    return {
      ok: false,
      reason: 'result_mismatch',
      detail: `The replay ended ${state!.players.you.score}-${state!.players.bot.score}, the record says ${saved.result.you}-${saved.result.opponent}.`,
    };
  }
  return { ok: true, game: { moveLog: stepper.moveLog, snapshots: stepper.snapshots, finalState: state!, recorder: stepper.recorder } };
}
