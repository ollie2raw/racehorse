import {
  comparePregameDrawTiles,
  generateDoubleSixSet,
  shuffleTiles,
} from '@racehorse/game-core';
import type { Tile } from '../game/types';

export interface ServerPregameDrawState {
  phase: 'pick-player' | 'pick-opponent' | 'showing-tie' | 'showing-reveal' | 'showing-result' | 'done';
  tiles: {
    id: string;
    tile: Tile;
    revealed: boolean;
    outOfPlay: boolean;
    pickedBy: string | null;
  }[];
  picks: Record<string, {
    slotId: string;
    tile: Tile;
    pipSum: number;
  } | null>;
  winnerId: string | null;
  remainingDeck: Tile[] | null;
}

export interface ClientPregameDrawRoundPick {
  player: 'you' | 'bot';
  tileId: string;
  tile: Tile;
  pipSum: number;
}

export interface ClientPregameDrawState {
  phase: string;
  tiles: {
    id: string;
    tile: Tile;
    revealed: boolean;
    outOfPlay: boolean;
  }[];
  currentRound: {
    you: ClientPregameDrawRoundPick | null;
    bot: ClientPregameDrawRoundPick | null;
  };
  winner: 'you' | 'bot' | null;
  remainingDeck: Tile[] | null;
}

export { comparePregameDrawTiles, generateDoubleSixSet, shuffleTiles };

export function initMultiplayerPregameDraw(players: string[]): ServerPregameDrawState {
  const deck = shuffleTiles(generateDoubleSixSet());
  const picks: Record<string, null> = {};
  for (const pid of players) {
    picks[pid] = null;
  }
  return {
    phase: 'pick-player',
    tiles: deck.map((tile, i) => ({
      id: `slot-${i}`,
      tile,
      revealed: false,
      outOfPlay: false,
      pickedBy: null,
    })),
    picks,
    winnerId: null,
    remainingDeck: null,
  };
}

export function maskPregameDrawForRecipient(
  preGameDraw: ServerPregameDrawState,
  recipientPlayerId: string,
  players: string[],
): ClientPregameDrawState {
  const youId = recipientPlayerId;
  const botId = players.find((id) => id !== youId) ?? '';

  const youPick = preGameDraw.picks[youId];
  const botPick = preGameDraw.picks[botId];

  // In our masked draw logic, youPick is visible to you immediately when you pick it.
  // The opponent's pick (botPick) is revealed to you ONLY when both players have picked.
  const bothPicked = youPick !== null && botPick !== null;

  const currentRound = {
    you: youPick
      ? {
          player: 'you' as const,
          tileId: youPick.slotId,
          tile: youPick.tile,
          pipSum: youPick.pipSum,
        }
      : null,
    bot: botPick
      ? {
          player: 'bot' as const,
          tileId: botPick.slotId,
          tile: botPick.tile,
          pipSum: botPick.pipSum,
        }
      : null,
  };

  let winner: 'you' | 'bot' | null = null;
  if (preGameDraw.winnerId) {
    winner = preGameDraw.winnerId === youId ? 'you' : 'bot';
  }

  return {
    phase: preGameDraw.phase,
    tiles: preGameDraw.tiles.map((slot) => {
      // Reveal the slot immediately if anyone has picked it
      const isRevealed = slot.pickedBy !== null;

      return {
        id: slot.id,
        tile: isRevealed ? slot.tile : { low: 0, high: 0 },
        revealed: isRevealed,
        outOfPlay: slot.outOfPlay,
      };
    }),
    currentRound,
    winner,
    remainingDeck: preGameDraw.remainingDeck,
  };
}
