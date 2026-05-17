import type { RefObject } from 'react';

export type LayoutDebugReason =
  | 'player-draw'
  | 'fritz-draw'
  | 'leave-open'
  | 'leave-close';

function parentSummary(el: Element | null | undefined): string {
  if (!el?.parentElement) return '(none)';
  const p = el.parentElement;
  const id = p.id ? `#${p.id}` : '';
  const extra = p.className && typeof p.className === 'string'
    ? `.${p.className.trim().split(/\s+/).slice(0, 3).join('.')}`
    : '';
  return `${p.tagName.toLowerCase()}${id}${extra}`;
}

export function logLayoutDebug(
  reason: LayoutDebugReason,
  refs: {
    rootRef: RefObject<HTMLElement | null>;
    boardStageRef?: RefObject<HTMLElement | null>;
    handAreaRef: RefObject<HTMLElement | null>;
    flyingTileParent?: Element | null;
  },
): void {
  if (!import.meta.env.DEV) return;

  const root = refs.rootRef.current;
  const board =
    refs.boardStageRef?.current ??
    root?.querySelector<HTMLElement>('.wl-stage-shell') ??
    null;
  const hand =
    refs.handAreaRef.current?.closest<HTMLElement>('.wl-hand-area') ?? null;
  const shellHeight = root ? Math.round(root.getBoundingClientRect().height) : null;
  const boardTop = board ? Math.round(board.getBoundingClientRect().top) : null;
  const boardHeight = board ? Math.round(board.getBoundingClientRect().height) : null;
  const handTop = hand ? Math.round(hand.getBoundingClientRect().top) : null;
  const handHeight = hand ? Math.round(hand.getBoundingClientRect().height) : null;

  console.log('[layout-debug]', {
    reason,
    boardTop,
    boardHeight,
    handTop,
    handHeight,
    shellHeight,
    animationParentClass: refs.flyingTileParent?.className ?? '(not mounted)',
    overlayParentClass: parentSummary(refs.flyingTileParent ?? null),
  });
}
