import type { Move, Tile } from '../../types';
import {
  applyPlayMove,
  createFixedBotMatch,
  drawOne,
  getLegalMoves,
  passTurn,
  startNextFixedBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotHandDeal,
  type BotMatchState,
} from '../../bot/botEngine';
import { chooseBotMove, toBotVisibleState } from '../../bot/botHeuristics';
import { FRITZ_TIERS } from '../../bot/fritzConfig';

export const GUIDED_MATCH_STANDARD_ROOT_SEED = 'guided-match-standard-v1';
export const GUIDED_MATCH_STANDARD_LESSON_ID = 'guided-match-standard-v1';
// Racehorse games are first to 60. Do not change this to 150.
export const GUIDED_MATCH_STANDARD_TARGET_SCORE = 60;
export const GUIDED_MATCH_STANDARD_DEAL_SIZE: BotDealSize = 7;

export type RecorderResolvedAction =
  | { kind: 'tile-play'; actor: 'player' | 'fritz'; move: Move; result: BotActionResult }
  | { kind: 'draw'; actor: 'player' | 'fritz'; result: BotActionResult }
  | { kind: 'pass'; actor: 'player' | 'fritz'; result: BotActionResult };

function hashSeedToUint32(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededPrng(seed: string): () => number {
  let state = hashSeedToUint32(seed) || 0x9e3779b9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleWithPrng<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

export function serializeGuidedMatchRecorderState(state: BotMatchState): string {
  return JSON.stringify(state);
}

export function restoreGuidedMatchRecorderState(snapshot: string): BotMatchState | null {
  try {
    const parsed = JSON.parse(snapshot) as BotMatchState;
    if (!parsed || !parsed.players?.you || !parsed.players?.bot) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function tileId(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}|${high}`;
}

export function generateGuidedMatchRecorderHandDeal(
  rootSeed: string,
  handIndex: number,
  dealSize: BotDealSize = GUIDED_MATCH_STANDARD_DEAL_SIZE,
): BotHandDeal {
  const prng = createSeededPrng(`${rootSeed}:hand:${handIndex}`);
  const shuffled = shuffleWithPrng(buildDoubleSixSet(), prng);
  const remaining = shuffled.slice(dealSize * 2);
  return {
    player_tiles: shuffled.slice(0, dealSize).map((t) => ({ ...t })),
    fritz_tiles: shuffled.slice(dealSize, dealSize * 2).map((t) => ({ ...t })),
    boneyard: remaining.map((t) => ({ ...t })),
    locked: remaining.slice(Math.max(0, remaining.length - 2)).map((t) => ({ ...t })),
  };
}

export function createGuidedMatchRecorderInitialState(
  rootSeed: string = GUIDED_MATCH_STANDARD_ROOT_SEED,
): BotMatchState {
  return createFixedBotMatch(
    generateGuidedMatchRecorderHandDeal(rootSeed, 0),
    GUIDED_MATCH_STANDARD_TARGET_SCORE,
    GUIDED_MATCH_STANDARD_DEAL_SIZE,
  );
}

export function startNextGuidedMatchRecorderHand(
  state: BotMatchState,
  rootSeed: string = GUIDED_MATCH_STANDARD_ROOT_SEED,
): BotMatchState {
  return startNextFixedBotHand(
    state,
    generateGuidedMatchRecorderHandDeal(rootSeed, state.handNumber),
  );
}

export function resolveStandardFritzRecorderAction(state: BotMatchState): RecorderResolvedAction {
  const legalMoves = getLegalMoves(state, 'bot');
  const playMoves = legalMoves.filter((move) => move.type === 'play');
  if (playMoves.length > 0) {
    const choice = chooseBotMove(toBotVisibleState(state), FRITZ_TIERS.standard.difficulty);
    const move = choice?.move && choice.move.type === 'play' ? choice.move : playMoves[0]!;
    return {
      kind: 'tile-play',
      actor: 'fritz',
      move,
      result: applyPlayMove(state, 'bot', move),
    };
  }
  if (state.boneyard.length > 2) {
    return {
      kind: 'draw',
      actor: 'fritz',
      result: drawOne(state, 'bot'),
    };
  }
  return {
    kind: 'pass',
    actor: 'fritz',
    result: passTurn(state, 'bot'),
  };
}
