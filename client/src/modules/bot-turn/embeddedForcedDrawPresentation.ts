import type { Tile } from '../../types.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import { playDrawSound, queueSound } from '../../utils/sound.ts';

function tileKey(tile: Tile): string {
  return `${tile.low}-${tile.high}`;
}

/** Multiset subtract: remove one copy of each drawn tile from the hand. */
export function handWithoutTiles(hand: Tile[], remove: Tile[]): Tile[] {
  const remaining = new Map<string, number>();
  for (const tile of remove) {
    const key = tileKey(tile);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const next: Tile[] = [];
  for (const tile of hand) {
    const key = tileKey(tile);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
      continue;
    }
    next.push(tile);
  }
  return next;
}

/**
 * Post-score / double recovery draws are resolved inside applyMove for transcript
 * parity. Recover the drawn tile list from the pre-play boneyard front so the UI
 * can still animate one tile at a time.
 */
export function listEmbeddedForcedDrawTiles(
  beforePlay: BotMatchState,
  afterPlay: BotMatchState,
): Tile[] {
  const drawCount = beforePlay.boneyard.length - afterPlay.boneyard.length;
  if (drawCount <= 0) return [];
  return beforePlay.boneyard.slice(0, drawCount);
}

export type PresentEmbeddedForcedDrawsDeps = {
  player: BotPlayerId;
  beforePlay: BotMatchState;
  afterPlay: BotMatchState;
  drawnTiles: Tile[];
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  onDrawVisualStep?: (player: BotPlayerId, state: BotMatchState) => void;
  triggerDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
  setDrawSequenceActiveBoth: (active: boolean) => void;
  drawStepMs: number;
  isMuted: boolean;
};

/**
 * Animate embedded forced draws after a scoring/double play, then leave the caller
 * to commit the authoritative afterPlay state.
 *
 * Fritz (`bot`) never mutates match here — only overlays. Committing
 * `currentPlayer`/`hand` mid-animation remounts the bot-turn effect and can leave
 * live state ahead of the move log (Daily Fritz `fritz_action_mismatch`).
 */
export async function presentEmbeddedForcedDraws(
  deps: PresentEmbeddedForcedDrawsDeps,
): Promise<void> {
  const {
    player,
    beforePlay,
    afterPlay,
    drawnTiles,
    setMatch,
    onDrawVisualStep,
    triggerDrawStepAnimation,
    setDrawSequenceActiveBoth,
    drawStepMs,
    isMuted,
  } = deps;

  if (drawnTiles.length === 0) return;

  const postPlayHand = handWithoutTiles(afterPlay.players[player].hand, drawnTiles);
  const postPlayState: BotMatchState = {
    ...afterPlay,
    boneyard: beforePlay.boneyard,
    players: {
      ...afterPlay.players,
      [player]: {
        ...afterPlay.players[player],
        hand: postPlayHand,
      },
    },
  };

  setDrawSequenceActiveBoth(true);
  try {
    // Player tray: land the scored/double play, then animate recovery draws.
    // Fritz: overlay-only (authoritative match must already be committed by caller).
    if (player === 'you') {
      setMatch(postPlayState);
    }
    onDrawVisualStep?.(player, postPlayState);

    for (let index = 0; index < drawnTiles.length; index += 1) {
      const stepHand = [...postPlayHand, ...drawnTiles.slice(0, index + 1)];
      const stepState: BotMatchState = {
        ...afterPlay,
        boneyard: beforePlay.boneyard.slice(index + 1),
        players: {
          ...afterPlay.players,
          [player]: {
            ...afterPlay.players[player],
            hand: stepHand,
          },
        },
      };
      onDrawVisualStep?.(player, stepState);
      if (player === 'you') {
        setMatch(stepState);
      }
      queueSound(() => playDrawSound(isMuted), 0);
      triggerDrawStepAnimation(player, stepState);
      // Final player tile is already in the tray. Release input immediately;
      // its fly animation can finish without blocking the next legal play.
      if (player === 'you' && index === drawnTiles.length - 1) {
        continue;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, drawStepMs));
    }
  } finally {
    setDrawSequenceActiveBoth(false);
  }
}
