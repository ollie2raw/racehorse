// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordPileSnapshot, resetPileSnapshotForTests, rotationFromTransform, takePileSnapshot } from './pileSnapshot';

/** A pick-a-tile board with `down` face-down tiles, `up` revealed ones, each one 88x44 and tilted 10 degrees per index. */
function mountBoard(down: number, up = 0) {
  const board = document.createElement('div');
  board.className = 'pre-game-draw-board';
  Object.defineProperty(board, 'offsetWidth', { value: 1000, configurable: true });
  board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
  const add = (faceDown: boolean, i: number) => {
    const slot = document.createElement('div');
    slot.className = `pre-game-draw-board__tile-slot ${faceDown ? 'is-face-down' : 'is-revealed'}`;
    slot.style.transform = `translate(-50%, -50%) rotate(${i * 10}deg)`;
    Object.defineProperty(slot, 'offsetWidth', { value: 88, configurable: true });
    Object.defineProperty(slot, 'offsetHeight', { value: 44, configurable: true });
    slot.getBoundingClientRect = () => ({ left: 100 + i * 20, top: 50 + i * 5, width: 90, height: 60, right: 190 + i * 20, bottom: 110 + i * 5, x: 100 + i * 20, y: 50 + i * 5, toJSON: () => ({}) });
    const tile = document.createElement('div');
    tile.className = 'pre-game-draw-tile domino-tile';
    const body = document.createElement('div');
    body.className = 'domino-body';
    body.style.borderRadius = '7px';
    tile.appendChild(body);
    slot.appendChild(tile);
    board.appendChild(slot);
  };
  for (let i = 0; i < down; i += 1) add(true, i);
  for (let i = 0; i < up; i += 1) add(false, down + i);
  document.body.appendChild(board);
  return board;
}

describe('pileSnapshot', () => {
  beforeEach(() => resetPileSnapshotForTests());
  afterEach(() => {
    document.body.innerHTML = '';
    resetPileSnapshotForTests();
  });

  it('writes down where each face-down tile is lying, at its size and tilt', () => {
    recordPileSnapshot(mountBoard(3));
    const snapshot = takePileSnapshot();
    expect(snapshot?.pieces).toHaveLength(3);
    expect(snapshot?.pieces[1]).toEqual({ cx: 120 + 45, cy: 55 + 30, width: 88, height: 44, rotationDeg: 10 });
  });

  it('leaves out the tiles that were turned face up', () => {
    recordPileSnapshot(mountBoard(4, 2));
    expect(takePileSnapshot()?.pieces).toHaveLength(4);
  });

  it('reads the look of a face-down tile from its body', () => {
    recordPileSnapshot(mountBoard(2));
    expect(takePileSnapshot()?.look?.borderRadius).toBe('7px');
  });

  it('is taken once: a later hand can never replay a stale pile', () => {
    recordPileSnapshot(mountBoard(3));
    expect(takePileSnapshot()).not.toBeNull();
    expect(takePileSnapshot()).toBeNull();
  });

  it('keeps the latest render, not the first', () => {
    recordPileSnapshot(mountBoard(5));
    document.body.innerHTML = '';
    recordPileSnapshot(mountBoard(3));
    expect(takePileSnapshot()?.pieces).toHaveLength(3);
  });

  it('is empty for an empty board or no board', () => {
    recordPileSnapshot(mountBoard(0));
    expect(takePileSnapshot()).toBeNull();
    recordPileSnapshot(null);
    expect(takePileSnapshot()).toBeNull();
  });

  it('scales sizes by a parent\'s uniform zoom, so they are on-screen pixels', () => {
    const board = mountBoard(1);
    // The board is laid out 1000 wide but shown 500 wide (a zoomed-out parent): a tile's 88x44 layout size shows as 44x22.
    board.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 300, right: 500, bottom: 300, x: 0, y: 0, toJSON: () => ({}) });
    recordPileSnapshot(board);
    const piece = takePileSnapshot()!.pieces[0];
    expect(piece.width).toBe(44);
    expect(piece.height).toBe(22);
  });
});

describe('rotationFromTransform', () => {
  it('reads the tilt out of an inline transform', () => {
    expect(rotationFromTransform('translate(-50%, -50%) rotate(-17.5deg)')).toBe(-17.5);
    expect(rotationFromTransform('translate(-50%, -50%) rotate(12deg)')).toBe(12);
  });
  it('is zero when there is none', () => {
    expect(rotationFromTransform('')).toBe(0);
    expect(rotationFromTransform('translate(1px, 2px)')).toBe(0);
  });
});
