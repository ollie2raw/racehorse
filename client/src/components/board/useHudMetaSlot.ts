// client/src/components/board/useHudMetaSlot.ts
//
// On the installed phone app in landscape the board is height-bound, and the OPEN pill sitting over the board's corner costs
// real tile size (measured in docs/board-camera-baseline.md). The HUD row above it has room, so there the pill is drawn into
// the HUD's meta slot (InGameBoardHud) instead. Everywhere else the slot stays empty and the pill sits on the board as before.
import { useSyncExternalStore } from 'react';
import { useShortBoardViewport } from './useShortBoardViewport';

export const HUD_META_SLOT_SELECTOR = '[data-ui="hud-meta-slot"]';

// The slot is a DOM element that another component renders, so it is read as an external value rather than copied into state.
// On the first render it is not in the document yet; React re-reads the snapshot right after the commit and, finding it changed,
// re-renders at once, so the pill is drawn into the slot before the browser paints. It is also re-read on every later render, so a
// HUD that remounts (a hand ends, the screen changes) is found again the next time the pill updates.
const subscribe = (): (() => void) => () => {};
const readSlot = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : document.querySelector<HTMLElement>(HUD_META_SLOT_SELECTOR);
const readSlotOnServer = (): HTMLElement | null => null;

// The installed Capacitor app marks `<html class="rh-native">` (main.tsx). This repeats the one-line check in match/rackTileSizing
// (isNativeShell) rather than importing it: that module would come along into every chunk that contains the pill, the game reviewer's
// among them, and the bundle ratchet counts it.
const isNativeApp = (): boolean => typeof document !== 'undefined' && document.documentElement.classList.contains('rh-native');

/** The HUD slot to draw into, or null when the pill belongs on the board (not the installed app, or not short landscape). */
export function useHudMetaSlot(): HTMLElement | null {
  const shortLandscape = useShortBoardViewport();
  const native = isNativeApp();
  const slot = useSyncExternalStore(subscribe, readSlot, readSlotOnServer);
  return shortLandscape && native ? slot : null;
}
