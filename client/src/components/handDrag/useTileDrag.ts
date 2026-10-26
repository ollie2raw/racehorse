// client/src/components/handDrag/useTileDrag.ts
//
// Drag a tile from the hand onto an open end, in addition to tap-then-tap (which is unchanged).
//
// It is deliberately DOM-driven and has no knowledge of the game. A drag is built from the same two
// clicks a player makes by hand:
//   - when the drag starts, it clicks the tile (selecting it, exactly as a tap does, so the legal
//     drop zones appear);
//   - when the pointer is released over a drop zone, it clicks that zone (placing the tile, through
//     the very handler a tap would call).
// So a drag can never do anything a tap could not, in Play vs Fritz, multiplayer or any other mode,
// and no gameplay code changes. If the pointer is released anywhere else the tile simply stays
// selected, as after a tap, and the player can tap a zone or press the tile again.
//
// Attach `onPointerDown` to the hand container. Pressing a tile that is playable (class `highlight`,
// not `disabled`) and moving it past DRAG_START_PX picks it up:
//   - a copy of the tile follows the pointer (lifted above a finger on touch);
//   - the source tile dims, and the nearest drop zone within ZONE_SLOP_PX is highlighted;
//   - release over a zone places it; Escape or a cancelled pointer drops it.
// A sideways touch drag is the rack scrolling and is left alone (dragIntent).
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { PlacementPosition } from '../../types';
import {
  dragIntent,
  pickDropZone,
  type DropZoneRect,
  type PointerKind,
} from './tileDragGesture';
import './tileDrag.css';

const ZONE_SELECTOR = '.placement-zone.active[data-position]';
const TILE_SELECTOR = '.domino-tile';
/** On touch the held tile is lifted this far above the fingertip so the finger does not hide it. */
const TOUCH_LIFT_PX = 44;
/** A drag that ends over the tile it started on can still produce a click; swallow it for this long. */
const CLICK_SWALLOW_MS = 400;

interface ActiveDrag {
  pointerId: number;
  kind: PointerKind;
  startX: number;
  startY: number;
  source: HTMLElement;
  phase: 'pending' | 'dragging';
  ghost: HTMLElement | null;
  ghostW: number;
  ghostH: number;
  overZone: HTMLElement | null;
}

function pointerKind(event: { pointerType?: string }): PointerKind {
  return event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse';
}

function readZones(): Array<DropZoneRect & { el: HTMLElement }> {
  const zones: Array<DropZoneRect & { el: HTMLElement }> = [];
  for (const el of document.querySelectorAll<HTMLElement>(ZONE_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    zones.push({
      el,
      position: el.dataset.position as PlacementPosition,
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
    });
  }
  return zones;
}

function makeGhost(source: HTMLElement): { ghost: HTMLElement; w: number; h: number } {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.remove('selected', 'disabled', 'new-draw');
  ghost.classList.add('tile-drag-ghost');
  ghost.removeAttribute('aria-label');
  ghost.removeAttribute('aria-pressed');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.tabIndex = -1;
  document.body.appendChild(ghost);
  return { ghost, w: rect.width, h: rect.height };
}

export interface UseTileDragResult {
  /** Attach to the hand container (the element that holds the tile buttons). */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function useTileDrag(): UseTileDragResult {
  const dragRef = useRef<ActiveDrag | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const end = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  // A drag in flight must not outlive the screen (a ghost left on <body> would be a stuck tile).
  useEffect(() => end, [end]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (dragRef.current) return;
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      const source = (event.target as HTMLElement).closest<HTMLElement>(TILE_SELECTOR);
      // Only a playable tile can be dragged: legal on some open end (`highlight`) and not locked (`disabled`).
      if (!source || !source.classList.contains('highlight') || source.classList.contains('disabled')) return;

      const drag: ActiveDrag = {
        pointerId: event.pointerId,
        kind: pointerKind(event),
        startX: event.clientX,
        startY: event.clientY,
        source,
        phase: 'pending',
        ghost: null,
        ghostW: 0,
        ghostH: 0,
        overZone: null,
      };
      dragRef.current = drag;

      const lift = drag.kind === 'touch' ? TOUCH_LIFT_PX : 0;
      const moveGhost = (x: number, y: number) => {
        if (!drag.ghost) return;
        drag.ghost.style.transform = `translate3d(${x - drag.ghostW / 2}px, ${y - drag.ghostH / 2 - lift}px, 0) scale(1.04)`;
      };
      const setOver = (zone: HTMLElement | null) => {
        if (drag.overZone === zone) return;
        drag.overZone?.removeAttribute('data-drag-over');
        zone?.setAttribute('data-drag-over', 'true');
        drag.overZone = zone;
      };

      // Swallow only the one REAL click (isTrusted) that can trail the release. The clicks this hook dispatches
      // itself (select at pick-up, place at drop) are synthetic, and a second drag started within the window
      // must still be able to select its tile.
      const swallowClick = (e: Event) => {
        if (!e.isTrusted) return;
        e.stopPropagation();
        e.preventDefault();
        window.removeEventListener('click', swallowClick, { capture: true });
      };

      const teardown = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        setOver(null);
        drag.ghost?.remove();
        drag.source.removeAttribute('data-dragging');
        document.body.classList.remove('rh-tile-dragging');
        dragRef.current = null;
        cleanupRef.current = null;
      };

      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== drag.pointerId) return;
        if (drag.phase === 'pending') {
          const intent = dragIntent(e.clientX - drag.startX, e.clientY - drag.startY, drag.kind);
          if (intent === 'pending') return;
          if (intent === 'abandon') {
            teardown();
            return;
          }
          // Pick the tile up: select it exactly as a tap would, so the drop zones appear.
          if (drag.source.getAttribute('aria-pressed') !== 'true') drag.source.click();
          const made = makeGhost(drag.source);
          drag.ghost = made.ghost;
          drag.ghostW = made.w;
          drag.ghostH = made.h;
          drag.source.setAttribute('data-dragging', 'true');
          document.body.classList.add('rh-tile-dragging');
          drag.phase = 'dragging';
        }
        moveGhost(e.clientX, e.clientY);
        const zones = readZones();
        const hit = pickDropZone(zones, e.clientX, e.clientY);
        setOver(hit ? (zones.find((z) => z.position === hit)?.el ?? null) : null);
      };

      const finish = (e: PointerEvent, place: boolean) => {
        if (e.pointerId !== drag.pointerId) return;
        const wasDragging = drag.phase === 'dragging';
        const target = place && wasDragging ? drag.overZone : null;
        teardown();
        if (!wasDragging) return; // a plain tap: the browser's click does the work
        // Place through the zone's own handler, the same call a tap makes.
        if (target?.isConnected) target.click();
        // A click can still follow the release (when it ends over the tile it started on); that is not a tap.
        window.addEventListener('click', swallowClick, { capture: true });
        window.setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), CLICK_SWALLOW_MS);
      };
      const onUp = (e: PointerEvent) => finish(e, true);
      const onCancel = (e: PointerEvent) => finish(e, false);
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && drag.phase === 'dragging') teardown();
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      cleanupRef.current = teardown;
    },
    [],
  );

  return { onPointerDown };
}
