import { useEffect } from 'react';

/**
 * useBotMatchWindowEvents
 *
 * Two self-contained window-level effects extracted from BotMatchScreen:
 * 1. Sets/clears a debug profiling flag on `window` while in Daily Fritz mode.
 * 2. Listens for Escape key to dismiss the full coach tip.
 *
 * Extracted with zero behavior change.
 */
export function useBotMatchWindowEvents({
  isDailyFritzMode,
  showFullCoachTip,
  setShowFullCoachTip,
}: {
  isDailyFritzMode: boolean;
  showFullCoachTip: boolean;
  setShowFullCoachTip: (value: boolean) => void;
}): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as typeof window & {
      __dailyFritzProfileActive?: boolean;
      __dailyFritzProfile?: Record<string, unknown>;
      __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
    };
    if (isDailyFritzMode) {
      win.__dailyFritzProfileActive = true;
      win.__dailyFritzProfile ??= {};
      win.__dailyFritzInteractionTrace ??= [];
    } else {
      win.__dailyFritzProfileActive = false;
    }
    return () => {
      if (win.__dailyFritzProfileActive) {
        win.__dailyFritzProfileActive = false;
      }
    };
  }, [isDailyFritzMode]);

  useEffect(() => {
    if (!showFullCoachTip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowFullCoachTip(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullCoachTip]);
}
