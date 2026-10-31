// client/src/components/board/useTileFlight.ts
//
// Makes a newly placed tile TRAVEL to its place (motion model: tileFlight.ts). Purely visual: it reads
// the DOM, draws a copy of the tile on an overlay, and hides the real board tile until the copy lands.
// It never touches game state or timing, every failure path simply leaves the tile where the board put it
// (with its existing "land" animation), and it only runs when placement feedback is enabled (which
// already excludes reduced motion, hidden tabs, history views and static boards).
//
// A copy on a body-level overlay rather than animating the board tile itself because the board container
// clips its contents and the flight starts OUTSIDE it (the hand below, or Fritz's rack above).
//
// Where the tile came from:
//   - the player tapped a drop zone: the selected hand tile's rectangle, captured on the zone's click
//     (before the tile leaves the hand);
//   - the player dragged: the held tile's rectangle at the moment of release (useTileDrag records it);
//   - otherwise (Fritz): his rack.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  centreOf,
  flightFrame,
  hasFreshFlightSource,
  planFlight,
  recordFlightSource,
  takeFlightSource,
  type FlightPoint,
  type FlightRect,
} from './tileFlight';
import { claimTileImpact, landTileImpact, setTileFlightActive } from '../../utils/tileImpact';

const ARRIVING = ".board-tile-wrapper[data-placement-feedback='arrive']";
const HAND_SELECTED_TILE = '.hand-area .domino-tile[aria-pressed="true"]';
const OPPONENT_RACK = '.rh-tile-rack';
/** A drag records its own source on release; the zone click that follows must not overwrite it. */
const DRAG_SOURCE_FRESH_MS = 300;

function rectOf(el: Element): FlightRect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** Fritz's tile comes from his rack: the rack's centre, at the size of one of its tiles. */
function opponentRackSource(): FlightRect | null {
  const rack = document.querySelector(OPPONENT_RACK);
  if (!rack) return null;
  const box = rack.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return null;
  const sample = rack.querySelector('.rh-tile-rack__tile')?.getBoundingClientRect();
  const width = sample && sample.width > 0 ? sample.width : 14;
  const height = sample && sample.height > 0 ? sample.height : 32;
  return { left: box.left + box.width / 2 - width / 2, top: box.top + box.height / 2 - height / 2, width, height };
}

/** The board tile's rotation in degrees, from its inline `rotate(Ndeg)` transform. */
function rotationOf(tile: HTMLElement): number {
  const match = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(tile.style.transform);
  return match ? Number(match[1]) : 0;
}

export function useTileFlight(containerRef: RefObject<HTMLElement | null>, arrivingTile: string | null, enabled: boolean) {
  const cancelRef = useRef<((landImpact?: boolean) => void) | null>(null);

  // Impact sounds wait for a flight only while flights are running.
  useEffect(() => {
    setTileFlightActive(enabled);
    return () => setTileFlightActive(false);
  }, [enabled]);

  // Capture where a tapped tile is, on the zone's click: before React's handler runs and the tile leaves the hand.
  useEffect(() => {
    if (!enabled) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest?.('.placement-zone')) return;
      if (hasFreshFlightSource(performance.now(), DRAG_SOURCE_FRESH_MS)) return;
      const selected = document.querySelector(HAND_SELECTED_TILE);
      if (selected) recordFlightSource(rectOf(selected));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled]);

  useLayoutEffect(() => {
    // A newer arrival lands the previous flight immediately. Its impact was already released when the new move armed its own
    // (armTileImpact), so this cancel must not touch the impact: it would play the new move's clack before its flight starts.
    cancelRef.current?.(false);
    if (!enabled || !arrivingTile) return;
    const container = containerRef.current;
    if (!container) return;
    const wrapper = container.querySelector<HTMLElement>(ARRIVING);
    const tile = wrapper?.querySelector<HTMLElement>(':scope > .domino-tile');
    if (!wrapper || !tile) return;
    const source = takeFlightSource() ?? opponentRackSource();
    if (!source) return;

    try {
      const canvas = container.querySelector<HTMLElement>('.board-canvas');
      const cameraScale = canvas && canvas.offsetWidth > 0 ? canvas.getBoundingClientRect().width / canvas.offsetWidth : 1;
      const naturalW = tile.offsetWidth;
      const naturalH = tile.offsetHeight;
      if (naturalW <= 0 || naturalH <= 0) return;

      // Where the real tile is, centred, at its on-screen (camera-scaled, unrotated) size. Read live: the camera glides.
      const liveTo = (): FlightPoint => {
        const box = centreOf(rectOf(tile)); // the rotated bounding box's centre is the tile's centre
        return { cx: box.cx, cy: box.cy, width: naturalW * cameraScale, height: naturalH * cameraScale };
      };
      const start = liveTo();
      const rotation = rotationOf(tile);
      const plan = planFlight(source, { left: start.cx - start.width / 2, top: start.cy - start.height / 2, width: start.width, height: start.height }, rotation);

      const ghost = tile.cloneNode(true) as HTMLElement;
      ghost.classList.add('tile-flight-clone');
      ghost.removeAttribute('aria-label');
      ghost.removeAttribute('aria-pressed');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.tabIndex = -1;
      ghost.style.transform = '';
      document.body.appendChild(ghost);
      wrapper.setAttribute('data-flight', 'active');

      let raf = 0;
      let finished = false;
      const finish = (landImpact = true) => {
        if (finished) return;
        finished = true;
        window.cancelAnimationFrame(raf);
        ghost.remove();
        wrapper.removeAttribute('data-flight');
        // The settle: the real tile arrives with a little weight.
        if (typeof tile.animate === 'function') {
          tile.animate(
            [{ scale: 1.045 }, { scale: 1 }],
            { duration: 150, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
          );
        }
        if (landImpact) landTileImpact(); // the clack (and any score ping behind it) plays as the tile arrives
        cancelRef.current = null;
      };
      cancelRef.current = finish;
      claimTileImpact(plan.durationMs + 400);

      const t0 = performance.now();
      const step = (now: number) => {
        if (finished) return;
        const p = (now - t0) / plan.durationMs;
        const f = flightFrame(plan, liveTo(), p);
        ghost.style.transform =
          `translate3d(${f.cx - naturalW / 2}px, ${f.cy - naturalH / 2}px, 0) ` +
          `rotate(${f.rotateDeg}deg) scale(${f.width / naturalW}, ${f.height / naturalH})`;
        if (p >= 1) finish();
        else raf = window.requestAnimationFrame(step);
      };
      step(t0);
    } catch {
      wrapper.removeAttribute('data-flight');
    }
  }, [arrivingTile, enabled, containerRef]);

  // Never leave a copy on <body> or a hidden tile behind when the board goes away.
  useEffect(() => () => cancelRef.current?.(), []);
}
