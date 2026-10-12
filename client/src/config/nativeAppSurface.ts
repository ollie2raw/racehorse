import { Capacitor } from '@capacitor/core';

/**
 * The iOS app doesn't show features that aren't open yet — no "Soon" tab, no
 * locked "coming soon" card. App Review treats placeholder features as an
 * incomplete app (Guideline 2.1), and a store build can't be updated the way
 * the website can.
 *
 * The website keeps its coming-soon surfaces unchanged. Nothing is deleted:
 * when a feature opens (e.g. VITE_ENABLE_TOURNAMENTS=true in .env.ios) it
 * appears in the next native build.
 */
export function hidesComingSoonSurfaces(isNativeApp: boolean = Capacitor.isNativePlatform()): boolean {
  return isNativeApp;
}
