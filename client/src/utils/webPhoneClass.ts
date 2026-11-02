// client/src/utils/webPhoneClass.ts
//
// Marks `<html class="rh-web-phone">` on a phone's BROWSER (a touch-only device that is not the installed app). The compact match
// layout in styles/native-landscape.css is keyed to `.rh-native` (the app) or this class, so a phone held sideways in Safari gets the
// same height-bound-board layout as the app instead of the roomy desktop one: measured, the board is 204px tall there against the
// app's 250px (docs/board-camera-baseline.md). The stylesheet only applies it in short landscape, so portrait and tablets are not
// affected, and a desktop window made short is not either, because a mouse has hover and a fine pointer.

const PHONE_BROWSER_QUERY = '(pointer: coarse) and (hover: none)';

/** Sets the class now and keeps it right if the device's input capabilities change. Returns a function that undoes it. */
export function installWebPhoneClass(root: HTMLElement = document.documentElement): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(PHONE_BROWSER_QUERY);
  const apply = () => {
    // The installed app has its own class and its own rules; the two never both apply.
    root.classList.toggle('rh-web-phone', mql.matches && !root.classList.contains('rh-native'));
  };
  apply();
  mql.addEventListener?.('change', apply);
  return () => {
    mql.removeEventListener?.('change', apply);
    root.classList.remove('rh-web-phone');
  };
}
