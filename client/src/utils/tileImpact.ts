// client/src/utils/tileImpact.ts
//
// Holds a tile's impact sound until the tile LANDS. Since the tile flight (useTileFlight) a placed tile
// travels 200-380 ms from the hand or rack to its place, but the clack used to fire the instant the move
// was made, so the ear heard the hit while the eye still saw the tile in the air. Here the sound waits for
// the flight, so the clack, the settle and the score ping all arrive together.
//
// Protocol:
//   armTileImpact(play)     the call site that used to play the clack. It plays now unless a flight is
//                           about to carry this tile; then it plays on landing.
//   claimTileImpact(maxMs)  the flight, as it starts, takes the armed impact.
//   landTileImpact()        the flight, as it lands (or is cut short), releases it.
//   afterTileImpact(play)   a sound that belongs AFTER the clack (the score ping) waits for it.
//
// It can never leave a sound unplayed: an armed impact that no flight claims within ARM_FALLBACK_MS plays
// anyway (reduced motion, a hidden tab, a slow network round trip), and a claimed one that never lands
// plays at the flight's own maximum length.

/** How long an armed impact waits for a flight to claim it. A flight starts within a frame or two of the move. */
export const ARM_FALLBACK_MS = 120;

interface Follower {
  play: () => void;
  delayMs: number;
}

interface Impact {
  play: () => void;
  followers: Follower[];
  phase: 'armed' | 'flying';
  timer: ReturnType<typeof setTimeout> | null;
}

let current: Impact | null = null;
let flightsActive = false;

/** Whether tile flights are running at all; with none, impacts play at once. */
export function setTileFlightActive(active: boolean): void {
  flightsActive = active;
  if (!active && current) release();
}

function schedule(play: () => void, delayMs: number): void {
  if (delayMs <= 0) play();
  else setTimeout(play, delayMs);
}

function release(): void {
  const impact = current;
  if (!impact) return;
  current = null;
  if (impact.timer !== null) clearTimeout(impact.timer);
  impact.play();
  for (const follower of impact.followers) schedule(follower.play, follower.delayMs);
}

export function armTileImpact(play: () => void): void {
  release(); // a newer move lands the previous one's sound now
  if (!flightsActive) {
    play();
    return;
  }
  const impact: Impact = { play, followers: [], phase: 'armed', timer: null };
  impact.timer = setTimeout(() => {
    if (current === impact) release();
  }, ARM_FALLBACK_MS);
  current = impact;
}

/** The flight starts: it now owns the armed impact. False when nothing was armed. */
export function claimTileImpact(maxMs: number): boolean {
  const impact = current;
  if (!impact || impact.phase !== 'armed') return false;
  if (impact.timer !== null) clearTimeout(impact.timer);
  impact.phase = 'flying';
  impact.timer = setTimeout(() => {
    if (current === impact) release();
  }, maxMs);
  return true;
}

/** The flight landed (or was cut short): the clack plays, then anything waiting on it. */
export function landTileImpact(): void {
  release();
}

/** A sound that follows the clack (the score ping). With no impact pending it plays after `delayMs` as before. */
export function afterTileImpact(play: () => void, delayMs = 0): void {
  if (current) current.followers.push({ play, delayMs });
  else schedule(play, delayMs);
}

/** Test seam: forget everything. */
export function resetTileImpactForTests(): void {
  if (current?.timer != null) clearTimeout(current.timer);
  current = null;
  flightsActive = false;
}
