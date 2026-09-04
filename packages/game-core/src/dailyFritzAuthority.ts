import type { GameState, Tile } from './types';

/**
 * GC-5 (HARDENING_PLAN §7.3) — **confirmed live incident, 2026-09-04**: v1
 * embedded `state.board` via raw `JSON.stringify`, which is sensitive to
 * object-key insertion order. Two structurally-identical boards built by
 * different code paths (the client and server do not always construct a board
 * the same way — see GC-3b) could digest differently even though the game
 * state was in fact identical, producing a false `fritz_state_mismatch`. Prod
 * logs show this fired 12 times since 2026-08-01 across ≥5 players — every
 * time on exactly one hand of an otherwise cleanly-verifying run, which is the
 * signature of a construction-order artifact, not a real state divergence.
 *
 * v2 canonicalizes recursively (sorts object keys; array order — which IS
 * semantically meaningful, e.g. `mainLine` / `boneyard` — is preserved), so the
 * digest is a pure function of the state's *value*, never of how the objects
 * that hold it happened to be built.
 */
export const DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION = 2 as const;
/** Oldest digest version the verifier still accepts on an in-flight attempt pinned to it. */
export const DAILY_FRITZ_AUTHORITY_STATE_DIGEST_MIN_SUPPORTED_VERSION = 1 as const;
export type DailyFritzAuthorityStateDigestVersion = 1 | 2;

export function isSupportedDailyFritzAuthorityStateDigestVersion(
  value: unknown,
): value is DailyFritzAuthorityStateDigestVersion {
  return value === 1 || value === 2;
}

function tileKey(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;
}

function participantIndex(state: GameState, participantId: string | null): number | null {
  if (participantId == null) return null;
  const index = state.playerIds.indexOf(participantId);
  return index >= 0 ? index : null;
}

function buildDailyFritzAuthorityStateProjection(state: GameState): unknown {
  const players = state.playerIds.map((id) => ({
    hand: state.players[id].hand.map(tileKey).sort(),
    score: state.players[id].score,
  }));
  return {
    config: {
      tilesPerPlayer: state.config.tilesPerPlayer,
      deadTileCount: state.config.deadTileCount,
      winningScore: state.config.winningScore,
      skipPregameDraw: state.config.skipPregameDraw,
    },
    players,
    board: state.board,
    boneyard: state.boneyard.map(tileKey),
    deadTiles: state.deadTiles.map(tileKey).sort(),
    currentPlayerIndex: state.currentPlayerIndex,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerIndex: participantIndex(state, state.winnerId),
    consecutivePasses: state.consecutivePasses,
    sequence: state.sequence,
  };
}

/**
 * Deterministic stringify: object keys are sorted recursively so the output
 * depends only on the value, never on the insertion order the object happened
 * to be constructed with. Array element order is preserved (it is semantically
 * meaningful throughout `GameState` — turn order, tile placement order, etc.).
 * `undefined` values are dropped, matching `JSON.stringify`'s own behaviour, so
 * this is a drop-in replacement wherever key order was the only concern.
 */
function canonicalStringify(value: unknown): string {
  if (value === undefined) return 'null'; // unreachable at the root; kept for recursive safety
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => (entry === undefined ? 'null' : canonicalStringify(entry))).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`);
  return `{${entries.join(',')}}`;
}

/**
 * v1 (legacy, order-sensitive): kept ONLY so an in-flight attempt whose client
 * bundle already pinned `stateDigestVersion: 1` keeps verifying against the
 * exact digest that bundle computes. Do not use for new comparisons.
 */
export function canonicalizeDailyFritzAuthorityStateV1(state: GameState): string {
  return JSON.stringify(buildDailyFritzAuthorityStateProjection(state));
}

/** v2 (current): construction-order-independent. */
export function canonicalizeDailyFritzAuthorityStateV2(state: GameState): string {
  return canonicalStringify(buildDailyFritzAuthorityStateProjection(state));
}

/** @deprecated Use `canonicalizeDailyFritzAuthorityStateV2` (or `getDailyFritzAuthorityStateDigest`, which
 * already dispatches by version). Kept only because it is part of the public API surface. */
export function canonicalizeDailyFritzAuthorityState(state: GameState): string {
  return canonicalizeDailyFritzAuthorityStateV2(state);
}

/**
 * Deterministic cross-runtime drift detector. This is an integrity fingerprint,
 * not a security boundary; transcript verification remains authoritative.
 *
 * `version` selects which digest algorithm to compute — pass the version the
 * transcript/attempt is pinned to (defaults to the current version for new
 * comparisons). This is what lets a v1-pinned in-flight attempt keep verifying
 * unchanged while all new attempts use the fixed v2 canonicalization.
 */
export function getDailyFritzAuthorityStateDigest(
  state: GameState,
  version: DailyFritzAuthorityStateDigestVersion = DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
): string {
  const serialized = version === 1
    ? canonicalizeDailyFritzAuthorityStateV1(state)
    : canonicalizeDailyFritzAuthorityStateV2(state);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `df-state-v${version}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
