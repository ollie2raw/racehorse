import type { LucideIcon } from 'lucide-react';
import {
  Ban,
  Flag,
  Layers3,
  LockKeyhole,
  Repeat2,
  SquareCheckBig,
} from 'lucide-react';

export type LearnIconType =
  | 'must-play'
  | 'keep-turn'
  | 'auto-draw'
  | 'race-to-60'
  | 'blocked'
  | 'pile-locked';

/** Canonical Learn icon mapping — Lucide primitives only. */
export const learnIcons = {
  mustPlay: SquareCheckBig,
  keepTurn: Repeat2,
  autoDraw: Layers3,
  raceTo60: Flag,
  canPlay: SquareCheckBig,
  scoreOrDouble: Repeat2,
  blocked: Ban,
  pileLocked: LockKeyhole,
} as const satisfies Record<string, LucideIcon>;

export const LEARN_ICON_STROKE = 2.25;

export const ICON_BY_TYPE: Record<LearnIconType, LucideIcon> = {
  'must-play': learnIcons.mustPlay,
  'keep-turn': learnIcons.keepTurn,
  'auto-draw': learnIcons.autoDraw,
  'race-to-60': learnIcons.raceTo60,
  blocked: learnIcons.blocked,
  'pile-locked': learnIcons.pileLocked,
};
