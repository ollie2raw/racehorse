// client/src/components/deal/pileSnapshot.ts
//
// Where the pre-game draw's face-down tiles are lying, remembered so the deal can start from them.
//
// The tiles you pick from are on screen right up to the instant the match begins, and then that whole board is
// replaced by the live one. To make the opening one continuous piece of staging (those same tiles are scrambled,
// dealt into both hands, and the rest swept into the boneyard) the deal needs their positions, and by the time
// it runs they are already gone from the DOM. So the draw board writes them down after every render
// (recordPileSnapshot), and the deal takes them once (takePileSnapshot).
//
// Pure bookkeeping: it reads the document's geometry and nothing else, and holds one snapshot at a time.

export interface PilePiece {
  /** Centre of the tile on screen, in px. */
  cx: number;
  cy: number;
  /** Unrotated size, in px. */
  width: number;
  height: number;
  rotationDeg: number;
}

export interface PileLook {
  backgroundColor: string;
  backgroundImage: string;
  border: string;
  borderRadius: string;
  boxShadow: string;
}

export interface PileSnapshot {
  pieces: PilePiece[];
  /** How a face-down tile of the pile looks, so the scrambled cards match what was on screen a moment ago. */
  look: PileLook | null;
}

const SLOT = '.pre-game-draw-board__tile-slot.is-face-down';
const FACE = '.pre-game-draw-tile';

let current: PileSnapshot | null = null;

/** The rotation, in degrees, written into an inline `transform: translate(...) rotate(Ndeg)`. */
export function rotationFromTransform(transform: string): number {
  const match = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(transform);
  return match ? Number(match[1]) : 0;
}

/** Write down the face-down tiles currently lying inside `board`. Safe to call after every render. */
export function recordPileSnapshot(board: Element | null): void {
  if (!board) return;
  const boardRect = board.getBoundingClientRect();
  const boardLayoutWidth = (board as HTMLElement).offsetWidth;
  // A parent's uniform scale shrinks the on-screen box but not the layout size: recover it, so sizes are on-screen px.
  const scale = boardLayoutWidth > 0 && boardRect.width > 0 ? boardRect.width / boardLayoutWidth : 1;

  const pieces: PilePiece[] = [];
  let look: PileLook | null = null;
  for (const slot of board.querySelectorAll<HTMLElement>(SLOT)) {
    const box = slot.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) continue;
    pieces.push({
      cx: box.left + box.width / 2,
      cy: box.top + box.height / 2,
      width: slot.offsetWidth * scale,
      height: slot.offsetHeight * scale,
      rotationDeg: rotationFromTransform(slot.style.transform),
    });
    if (!look) {
      const face = slot.querySelector('.domino-body') ?? slot.querySelector(FACE);
      if (face) {
        const style = window.getComputedStyle(face);
        look = {
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          border: style.border,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
        };
      }
    }
  }
  current = pieces.length > 0 ? { pieces, look } : null;
}

/** The last snapshot, once: taking it clears it, so a later hand can never replay a stale pile. */
export function takePileSnapshot(): PileSnapshot | null {
  const taken = current;
  current = null;
  return taken;
}

/** Test seam. */
export function resetPileSnapshotForTests(): void {
  current = null;
}
