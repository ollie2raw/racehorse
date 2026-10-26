// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTileDrag } from './useTileDrag.ts';

const onTileClick = vi.fn();
const onZoneClick = vi.fn();

function Hand({ tileClass = 'domino-tile highlight', pressed = false }: { tileClass?: string; pressed?: boolean }) {
  const drag = useTileDrag();
  return (
    <div role="group" aria-label="Your hand" onPointerDown={drag.onPointerDown}>
      <button type="button" className={tileClass} aria-pressed={pressed} onClick={onTileClick}>
        5-6
      </button>
    </div>
  );
}

/** A drop zone with a fixed on-screen rectangle (jsdom has no layout). */
function addZone(position: string, rect: { left: number; top: number; width: number; height: number }) {
  const el = document.createElement('button');
  el.className = 'placement-zone active';
  el.dataset.position = position;
  el.addEventListener('click', () => onZoneClick(position));
  el.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function pointer(type: string, x: number, y: number, init: { pointerType?: string; pointerId?: number } = {}) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  Object.defineProperty(e, 'isPrimary', { value: true });
  return e;
}

const down = (el: Element, x: number, y: number, init?: { pointerType?: string; pointerId?: number }) =>
  act(() => void el.dispatchEvent(pointer('pointerdown', x, y, init)));
const move = (x: number, y: number, init?: { pointerType?: string; pointerId?: number }) =>
  act(() => void window.dispatchEvent(pointer('pointermove', x, y, init)));
const up = (x: number, y: number, init?: { pointerType?: string; pointerId?: number }) =>
  act(() => void window.dispatchEvent(pointer('pointerup', x, y, init)));

let tile: HTMLElement;

beforeEach(() => {
  onTileClick.mockClear();
  onZoneClick.mockClear();
});

afterEach(() => {
  document.querySelectorAll('.placement-zone, .tile-drag-ghost').forEach((n) => n.remove());
  document.body.classList.remove('rh-tile-dragging');
});

function mountHand(props?: Parameters<typeof Hand>[0]) {
  const view = render(<Hand {...props} />);
  tile = view.container.querySelector('.domino-tile') as HTMLElement;
  tile.getBoundingClientRect = () =>
    ({ left: 10, top: 300, width: 60, height: 120, right: 70, bottom: 420, x: 10, y: 300, toJSON: () => ({}) }) as DOMRect;
  return view;
}

describe('useTileDrag', () => {
  it('leaves a plain tap alone: no ghost, no extra clicks from the hook', () => {
    mountHand();
    down(tile, 40, 350);
    up(40, 350);
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
    expect(onTileClick).not.toHaveBeenCalled(); // the browser's own click is what taps; the hook adds none
    expect(onZoneClick).not.toHaveBeenCalled();
  });

  it('picks the tile up past the threshold: selects it with a click and shows a ghost', () => {
    mountHand();
    down(tile, 40, 350);
    move(40, 300); // 50 px up
    expect(onTileClick).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.tile-drag-ghost')).not.toBeNull();
    expect(tile.getAttribute('data-dragging')).toBe('true');
    expect(document.body.classList.contains('rh-tile-dragging')).toBe(true);
  });

  it('does not re-click a tile that is already selected (a click would toggle it off in multiplayer)', () => {
    mountHand({ pressed: true });
    down(tile, 40, 350);
    move(40, 300);
    expect(onTileClick).not.toHaveBeenCalled();
    expect(document.querySelector('.tile-drag-ghost')).not.toBeNull();
  });

  it('highlights the zone under the pointer and places by clicking it on release', () => {
    mountHand();
    const left = addZone('left', { left: 100, top: 100, width: 60, height: 30 });
    const right = addZone('right', { left: 300, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(130, 115); // over the left zone
    expect(left.getAttribute('data-drag-over')).toBe('true');
    expect(right.getAttribute('data-drag-over')).toBeNull();
    up(130, 115);
    expect(onZoneClick).toHaveBeenCalledTimes(1);
    expect(onZoneClick).toHaveBeenCalledWith('left');
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
    expect(left.getAttribute('data-drag-over')).toBeNull();
    expect(tile.getAttribute('data-dragging')).toBeNull();
  });

  it('forgives a release a little outside the zone', () => {
    mountHand();
    addZone('right', { left: 300, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(375, 115); // 15 px right of the zone
    up(375, 115);
    expect(onZoneClick).toHaveBeenCalledWith('right');
  });

  it('releasing away from every zone places nothing and keeps the tile selected', () => {
    mountHand();
    addZone('left', { left: 100, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(500, 500);
    up(500, 500);
    expect(onZoneClick).not.toHaveBeenCalled();
    expect(onTileClick).toHaveBeenCalledTimes(1); // the select-click only: still selected, as after a tap
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
  });

  it('Escape drops the tile without placing it', () => {
    mountHand();
    addZone('left', { left: 100, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(130, 115);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    up(130, 115);
    expect(onZoneClick).not.toHaveBeenCalled();
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
  });

  it('a pointercancel (the browser took the gesture) drops the tile without placing it', () => {
    mountHand();
    addZone('left', { left: 100, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(130, 115);
    act(() => void window.dispatchEvent(pointer('pointercancel', 130, 115)));
    expect(onZoneClick).not.toHaveBeenCalled();
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
  });

  it('a sideways touch is the rack scrolling: no drag starts', () => {
    mountHand();
    down(tile, 40, 350, { pointerType: 'touch' });
    move(120, 352, { pointerType: 'touch' });
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
    expect(onTileClick).not.toHaveBeenCalled();
    expect(tile.getAttribute('data-dragging')).toBeNull();
  });

  it('an upward touch drag starts, and the ghost is lifted above the finger', () => {
    mountHand();
    down(tile, 40, 350, { pointerType: 'touch' });
    move(42, 300, { pointerType: 'touch' });
    const ghost = document.querySelector<HTMLElement>('.tile-drag-ghost');
    expect(ghost).not.toBeNull();
    // Held 44 px above the fingertip: y - height/2 - 44 = 300 - 60 - 44.
    expect(ghost?.style.transform).toContain('196px');
  });

  it('ignores a tile that is not playable or is locked', () => {
    mountHand({ tileClass: 'domino-tile' });
    down(tile, 40, 350);
    move(40, 300);
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
  });

  it('ignores a locked tile (opponent\'s turn)', () => {
    mountHand({ tileClass: 'domino-tile highlight disabled' });
    down(tile, 40, 350);
    move(40, 300);
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
  });

  it('ignores a right-click and a second pointer', () => {
    mountHand();
    const e = pointer('pointerdown', 40, 350);
    Object.defineProperty(e, 'button', { value: 2 });
    act(() => void tile.dispatchEvent(e));
    move(40, 300);
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();

    down(tile, 40, 350, { pointerId: 1 });
    move(40, 300, { pointerId: 1 });
    move(130, 115, { pointerId: 2 }); // another finger: ignored
    expect(document.querySelectorAll('.tile-drag-ghost')).toHaveLength(1);
  });

  it('a second drag started right after a drop still selects its tile (the swallow only targets a real click)', () => {
    mountHand();
    addZone('left', { left: 100, top: 100, width: 60, height: 30 });
    down(tile, 40, 350);
    move(40, 300);
    move(130, 115);
    up(130, 115);
    onTileClick.mockClear();
    down(tile, 40, 350);
    move(40, 300);
    expect(onTileClick).toHaveBeenCalledTimes(1);
  });

  it('never swallows a synthetic click, only a trusted one (the trusted case is covered in the browser e2e)', () => {
    mountHand();
    down(tile, 40, 350);
    move(40, 300);
    up(40, 340);
    onTileClick.mockClear();
    act(() => void tile.click()); // synthetic: isTrusted is false in jsdom, as for the clicks the hook dispatches itself
    expect(onTileClick).toHaveBeenCalledTimes(1);
  });

  it('removes its ghost if the screen unmounts mid-drag', () => {
    const view = mountHand();
    down(tile, 40, 350);
    move(40, 300);
    expect(document.querySelector('.tile-drag-ghost')).not.toBeNull();
    view.unmount();
    expect(document.querySelector('.tile-drag-ghost')).toBeNull();
    expect(document.body.classList.contains('rh-tile-dragging')).toBe(false);
  });
});
