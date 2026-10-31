// client/src/components/board/contactRing.ts
//
// The table's answer when a tile lands: a thin ivory ring leaves the tile's footprint and fades, a quiet
// "contact" cue that gives the landing weight without adding bounce (the identity is weighted and controlled,
// never springy). It is its own short-lived element on <body>, like the flight copy, rather than a pseudo-element
// on the board tile, because the board tiles carry drop-shadow filters that would put a dark halo on a ring.
//
// Purely cosmetic: it never reads or writes game state, removes itself, and does nothing without the Web
// Animations API (so unsupported environments and tests simply skip it).

export interface RingFootprint {
  /** Centre of the tile on screen, in px. */
  cx: number;
  cy: number;
  /** Camera-scaled, unrotated size of the tile, in px. */
  width: number;
  height: number;
}

/** How long the ring takes to leave and fade. Short enough to read as contact, not as an effect. */
export const CONTACT_RING_MS = 280;
/** How far the ring grows, as a multiple of the tile's size. */
export const CONTACT_RING_GROWTH = 1.3;
/** Its brightness at the moment of contact. */
export const CONTACT_RING_OPACITY = 0.5;

export function spawnContactRing(footprint: RingFootprint, rotationDeg: number): void {
  if (typeof document === 'undefined' || footprint.width <= 0 || footprint.height <= 0) return;
  const ring = document.createElement('div');
  if (typeof ring.animate !== 'function') return;

  ring.className = 'tile-contact-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.style.left = `${footprint.cx - footprint.width / 2}px`;
  ring.style.top = `${footprint.cy - footprint.height / 2}px`;
  ring.style.width = `${footprint.width}px`;
  ring.style.height = `${footprint.height}px`;
  ring.style.transform = `rotate(${rotationDeg}deg)`;
  document.body.appendChild(ring);

  try {
    const animation = ring.animate(
      [
        { opacity: CONTACT_RING_OPACITY, scale: '1' },
        { opacity: 0, scale: String(CONTACT_RING_GROWTH) },
      ],
      { duration: CONTACT_RING_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
    );
    animation.onfinish = () => ring.remove();
    animation.oncancel = () => ring.remove();
  } catch {
    ring.remove();
  }
}
