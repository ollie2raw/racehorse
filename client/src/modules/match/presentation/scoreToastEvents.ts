import type { BotPlayerId } from '../runtime/botEngine.ts';

export type MatchScoreSnapshot = {
  you: number;
  bot: number;
};

export type CommittedScoreEvent = {
  player: BotPlayerId;
  points: number;
};

/**
 * Resolves a single authoritative scoring event from committed score changes.
 * Simultaneous increases are treated as hydration/reconciliation, not gameplay.
 */
export function resolveCommittedScoreEvent(
  previous: MatchScoreSnapshot,
  current: MatchScoreSnapshot,
): CommittedScoreEvent | null {
  const youDelta = current.you - previous.you;
  const botDelta = current.bot - previous.bot;

  if (youDelta > 0 && botDelta === 0) {
    return { player: 'you', points: youDelta };
  }
  if (botDelta > 0 && youDelta === 0) {
    return { player: 'bot', points: botDelta };
  }
  return null;
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
