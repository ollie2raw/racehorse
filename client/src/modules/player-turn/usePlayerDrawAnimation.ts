import { useCallback } from 'react';
import { BOT_FLY_TILE_MS, resolveBotFlyTileMs, type FritzPace } from '../bot-turn/botTurnGuards.ts';
import { logDailyFritzHandBreadcrumb } from '../match/hand-lifecycle/handLifecycleRules.ts';
import { logLayoutDebug } from '../../match/layoutDebug.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import type { DrawAnimationDeps } from './types.ts';

type UsePlayerDrawAnimationArgs = {
  drawAnimation: DrawAnimationDeps;
  /** The pace this match runs at (Daily Fritz is always normal). Only Fritz's draws follow it. */
  fritzPace?: FritzPace;
};

export function usePlayerDrawAnimation({ drawAnimation, fritzPace = 'normal' }: UsePlayerDrawAnimationArgs) {
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
    // Only Fritz's draws speed up, and only off normal pace: at normal pace the entry carries no `ms` and the CSS
    // keeps its own duration, exactly as before.
    const flyMs = drawer === 'bot' ? resolveBotFlyTileMs(fritzPace) : BOT_FLY_TILE_MS;
    setFlyingTiles((prev) => [
      ...prev,
      {
        x: from.left + from.width / 2,
        y: from.top + from.height / 2,
        toX: to.left + to.width / 2,
        toY: to.top + to.height / 2,
        id,
        ...(flyMs !== BOT_FLY_TILE_MS ? { ms: flyMs } : null),
      },
    ]);
    setTimeout(() => setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id)), flyMs);
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
    fritzPace,
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
