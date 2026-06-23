/**
 * Ghost mode helpers for BotMatchScreen.
 *
 * Handles ghost match result copy, rating display formatting,
 * and move log serialization for the ghost API.
 *
 * Ghost mode runs within BotMatchScreen but is a distinct product
 * surface — these helpers are isolated to keep that boundary clear.
 */

import type { MoveEntry } from '../analyzer/moveLogger';
import { serializeGhostBoardState } from './logic';
import type { GhostMoveLogEntry } from './api';

export function getGhostResultMessage(playerScore: number, ghostScore: number): string {
  const margin = playerScore - ghostScore;
  if (margin >= 15) return "You've outgrown your ghost.";
  if (margin >= 1) return 'Closer than it looks. Ghost is watching.';
  if (margin <= -15) return "Ghost didn't even break a sweat.";
  return 'Your ghost remembers this.';
}

export function roundedRatingDelta(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatRatingDelta(value: number): string {
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value}`;
}

export function moveEntriesToGhostMoveLog(entries: MoveEntry[]): GhostMoveLogEntry[] {
  return entries
    .filter((entry) => entry.player === 'you')
    .map((entry) => ({
      turn: entry.moveNumber,
      actor: 'you',
      board_state: serializeGhostBoardState(entry.boardRenderState),
      tile_played: entry.action === 'place' && entry.tile ? `${entry.tile[0]}|${entry.tile[1]}` : null,
      branch: entry.action === 'draw' ? 'draw' : entry.action === 'pass' ? 'pass' : entry.action === 'place' && entry.tile ? (entry.boardState.find(s => s.tile[0] === entry.tile![0] && s.tile[1] === entry.tile![1])?.position ?? 'left') : null,
      hand_before: entry.handBefore.map(([low, high]) => `${low}|${high}`),
      score_delta: entry.pointsScored,
    }));
}
