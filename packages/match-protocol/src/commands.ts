import type { LocalPlayerId } from './primitives.ts';

/** Intents dispatched into the match runtime (UI → kernel). */
export type MatchCommand =
  | { type: 'PlayTile'; player: LocalPlayerId; tileKey: string; position: string }
  | { type: 'DrawTile'; player: LocalPlayerId }
  | { type: 'PassTurn'; player: LocalPlayerId }
  | { type: 'AdvanceHand' }
  | { type: 'Rematch' }
  | { type: 'Abandon' };

export type MatchCommandType = MatchCommand['type'];