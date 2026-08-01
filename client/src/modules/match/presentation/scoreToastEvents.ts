import type { BotPlayerId } from '../runtime/botEngine.ts';

export type MatchScoreSnapshot = {
  you: number;
  bot: number;
};

export type CommittedScoreEvent = {
  player: BotPlayerId;
  points: number;
};

export type CommittedScoreEventOptions = {
  /** Hand-end awards are part of the committed score but not a tile-score toast. */
  handOver?: boolean;
  /** Immediate points produced by the hand-ending tile, excluding the hand award. */
  playedTilePoints?: number;
};

/**
 * Resolves a single authoritative scoring event from committed score changes.
 * Simultaneous increases are treated as hydration/reconciliation, not gameplay.
 */
export function resolveCommittedScoreEvent(
  previous: MatchScoreSnapshot,
  current: MatchScoreSnapshot,
  options: CommittedScoreEventOptions = {},
): CommittedScoreEvent | null {
  const youDelta = current.you - previous.you;
  const botDelta = current.bot - previous.bot;

  const event = youDelta > 0 && botDelta === 0
    ? { player: 'you' as const, points: youDelta }
    : botDelta > 0 && youDelta === 0
      ? { player: 'bot' as const, points: botDelta }
      : null;

  if (!event || !options.handOver) return event;

  const playedTilePoints = options.playedTilePoints ?? 0;
  if (!Number.isFinite(playedTilePoints) || playedTilePoints <= 0) return null;
  return {
    player: event.player,
    points: Math.min(event.points, playedTilePoints),
  };
}

export type ScoreToastEventState = {
  eventId: number;
  visible: boolean;
};

export function hideScoreToastEvent<T extends ScoreToastEventState>(
  current: T | null,
  eventId: number,
): T | null {
  return current?.eventId === eventId
    ? { ...current, visible: false }
    : current;
}

export function clearScoreToastEvent<T extends ScoreToastEventState>(
  current: T | null,
  eventId: number,
): T | null {
  return current?.eventId === eventId ? null : current;
}
