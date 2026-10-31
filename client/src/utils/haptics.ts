// client/src/utils/haptics.ts
//
// Touch feedback for the native app: a tile you place lands with a light tap, a score you make with a firmer
// one, a blocked hand with a double, and the end of a hand or match with the system's success / warning
// pattern. Fired at the same moments as the sounds, so what you hear and what you feel arrive together.
//
// Native only, by design. On the web `navigator.vibrate` exists on Android Chrome alone (iOS Safari has none,
// desktop has none), so a web version would reach almost nobody and feel different on the few it does. On the
// web every call here is a no-op.
//
// Separate from mute: sound off does not mean haptics off. The Settings "Haptics" switch controls this.
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { hapticsPreference } from './hapticsPreference';

export type HapticCue =
  | 'tilePlaced' // your tile landing
  | 'opponentTile' // Fritz's / your opponent's tile landing: a faint tick, never a tap
  | 'score' // you scored
  | 'bigScore' // you scored 10 or more
  | 'blocked' // the hand is blocked: a double tap
  | 'handWon'
  | 'handLost'
  | 'matchWon'
  | 'matchLost';

/** The gap between the two taps of a blocked hand. */
export const DOUBLE_TAP_GAP_MS = 90;
/** A 10+ point score is the "big" one. */
export const BIG_SCORE_POINTS = 10;

export function hapticsSupported(): boolean {
  return Capacitor.isNativePlatform();
}

function fire(action: () => Promise<void>): void {
  // A haptic must never break a move: any native failure is swallowed.
  void action().catch(() => {});
}

export function playHaptic(cue: HapticCue): void {
  if (!hapticsSupported() || !hapticsPreference.get()) return;
  switch (cue) {
    case 'tilePlaced':
      fire(() => Haptics.impact({ style: ImpactStyle.Light }));
      break;
    case 'opponentTile':
      fire(() => Haptics.selectionChanged());
      break;
    case 'score':
      fire(() => Haptics.impact({ style: ImpactStyle.Medium }));
      break;
    case 'bigScore':
      fire(() => Haptics.impact({ style: ImpactStyle.Heavy }));
      break;
    case 'blocked':
      fire(() => Haptics.impact({ style: ImpactStyle.Medium }));
      setTimeout(() => {
        if (hapticsPreference.get()) fire(() => Haptics.impact({ style: ImpactStyle.Medium }));
      }, DOUBLE_TAP_GAP_MS);
      break;
    case 'handWon':
    case 'matchWon':
      fire(() => Haptics.notification({ type: NotificationType.Success }));
      break;
    case 'handLost':
    case 'matchLost':
      fire(() => Haptics.notification({ type: NotificationType.Warning }));
      break;
  }
}

/** The haptic for a score the player just made. */
export function scoreCue(points: number): HapticCue {
  return points >= BIG_SCORE_POINTS ? 'bigScore' : 'score';
}
