import type { LocalPlayerId, BotHandEndReason } from './primitives.ts';
import type { HandLifecyclePhase } from './lifecycle.ts';

/** Cross-module domain events emitted by the match runtime kernel. */
export type MatchDomainEvent =
  | { type: 'MatchStarted'; handNumber: number }
  | { type: 'TurnPlayed'; player: LocalPlayerId; handNumber: number; turnIndex?: number }
  | { type: 'TurnPassed'; player: LocalPlayerId; handNumber: number }
  | { type: 'TileDrawn'; player: LocalPlayerId; handNumber: number }
  | {
      type: 'HandEnded';
      handNumber: number;
      winner: LocalPlayerId | null;
      reason: BotHandEndReason;
      pointsAwarded: number;
      gameOver: boolean;
    }
  | { type: 'GameEnded'; winner: LocalPlayerId | null; handNumber: number }
  | { type: 'LifecyclePhaseChanged'; phase: HandLifecyclePhase; previousPhase: HandLifecyclePhase }
  | { type: 'CommandRejected'; reason: string };

export type MatchDomainEventType = MatchDomainEvent['type'];

export type MatchEventListener = (event: MatchDomainEvent) => void;