import type { GameplaySocketScope } from './gameplaySocketTypes';

/** Mutable scope read by the gameplay registrar — useMultiplayerConnection assigns delegates. */
export const gameplaySocketScopeRef: { current: GameplaySocketScope } = {
  current: {
    gameplay: null,
  },
};