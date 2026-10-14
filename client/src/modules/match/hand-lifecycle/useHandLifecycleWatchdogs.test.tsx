// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useHandLifecycleWatchdogs } from './useHandLifecycleWatchdogs';
import { createPreGameDrawShellMatch } from '../../../match/preGameDraw/preGameDrawEligibility';
import { createBotMatch } from '../runtime/botEngine';
afterEach(() => vi.useRealTimers());
it('never advances pending hand zero, but advances a completed real hand', () => {
  vi.useFakeTimers();
  const advanceHand = vi.fn();
  const matchRef = { current: createPreGameDrawShellMatch(60, 7) };
  const args = {
    match: matchRef.current, matchRef, handReveal: null, handRevealRef: { current: null },
    pendingHandRevealRef: { current: null }, handRevealTimerRef: { current: null },
    handRevealShownAtRef: { current: null }, dailyFritzMinAdvanceAtRef: { current: null },
    handTransitionInFlightRef: { current: false }, lastDailyFlowLabelRef: { current: '' },
    isDailyFritzMode: false, isGuidedMode: false, isGuidedV2Mode: false, isGuidedV2OffLine: false,
    handAdvanceError: null, setShowManualHandAdvance: vi.fn(), setHandReveal: vi.fn(), advanceHand,
  };
  const { rerender } = renderHook((props) => useHandLifecycleWatchdogs(props), { initialProps: args });
  act(() => vi.advanceTimersByTime(5000));
  expect(advanceHand).not.toHaveBeenCalled();
  expect(matchRef.current.players.you.hand).toEqual([]);
  matchRef.current = { ...createBotMatch(60, 7), handOver: true };
  rerender({ ...args, match: matchRef.current });
  act(() => vi.advanceTimersByTime(501));
  expect(advanceHand).toHaveBeenCalledTimes(1);
});
