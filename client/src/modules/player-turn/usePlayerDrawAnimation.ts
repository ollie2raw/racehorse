import { useCallback } from 'react';
import { BOT_FLY_TILE_MS } from '../bot-turn/botTurnGuards.ts';
import { logDailyFritzHandBreadcrumb } from '../match/hand-lifecycle/handLifecycleRules.ts';
import { logLayoutDebug } from '../../match/layoutDebug.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import type { DrawAnimationDeps } from './types.ts';

type UsePlayerDrawAnimationArgs = {
  drawAnimation: DrawAnimationDeps;
};

export function usePlayerDrawAnimation({ drawAnimation }: UsePlayerDrawAnimationArgs) {
  const {
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    guidedBoneyardAnchorRef,
    guidedFritzAnchorRef,
    rootRef,
    boardStageRef,
    flyingTileIdRef,
    setDrawPulseIndex,
    setFlyingTiles,
  } = drawAnimation;

  const triggerDrawStepAnimation = useCallback((drawer: BotPlayerId, nextState: BotMatchState) => {
    if (drawer === 'you') {
      const pulseIndex = nextState.players.you.hand.length - 1;
      if (pulseIndex >= 0) {
        setDrawPulseIndex(pulseIndex);
        setTimeout(() => setDrawPulseIndex((prev) => (prev === pulseIndex ? null : prev)), 420);
      }
    }

    const boneyardEl = boneyardRef.current ?? guidedBoneyardAnchorRef.current;
    const targetEl =
      drawer === 'you'
        ? handAreaRef.current
        : opponentPillRef.current ?? guidedFritzAnchorRef.current;
    if (!boneyardEl || !targetEl) {
      logDailyFritzHandBreadcrumb('draw-fallback', {
        drawer,
        hasBoneyardRef: Boolean(boneyardEl),
        hasTargetRef: Boolean(targetEl),
        handSize: drawer === 'you' ? nextState.players.you.hand.length : nextState.players.bot.hand.length,
        usedPulse: drawer === 'you',
      });
      return;
    }
    const from = boneyardEl.getBoundingClientRect();
    const to = targetEl.getBoundingClientRect();
    const id = ++flyingTileIdRef.current;
    setFlyingTiles((prev) => [
      ...prev,
      {
        x: from.left + from.width / 2,
        y: from.top + from.height / 2,
        toX: to.left + to.width / 2,
        toY: to.top + to.height / 2,
        id,
      },
    ]);
    setTimeout(() => setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id)), BOT_FLY_TILE_MS);
    logLayoutDebug(drawer === 'you' ? 'player-draw' : 'fritz-draw', {
      rootRef,
      boardStageRef,
      handAreaRef,
      flyingTileParent: typeof document !== 'undefined'
        ? document.body.querySelector('.flying-tile-overlay')
        : null,
    });
  }, [
    boneyardRef,
    guidedBoneyardAnchorRef,
    handAreaRef,
    opponentPillRef,
    guidedFritzAnchorRef,
    flyingTileIdRef,
    setDrawPulseIndex,
    setFlyingTiles,
    rootRef,
    boardStageRef,
  ]);

  const scheduleDrawStepAnimation = useCallback(
    (drawer: BotPlayerId, nextState: BotMatchState) => {
      window.requestAnimationFrame(() => {
        triggerDrawStepAnimation(drawer, nextState);
      });
    },
    [triggerDrawStepAnimation],
  );

  return {
    triggerDrawStepAnimation,
    scheduleDrawStepAnimation,
  };
}
