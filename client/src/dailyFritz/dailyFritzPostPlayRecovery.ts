import type { DailyFritzTranscriptAction } from '@racehorse/game-core';
import type { MoveEntry } from '../game/moveLogger.ts';

/**
 * Protocol 2 contract: `applyMove` absorbs the forced-draw chain inside a
 * scoring/double play. Separate draw actions logged immediately after that
 * play are obsolete recovery noise — the same class protocol 1 skipped via
 * `allowLegacyRecoverySkip` when `!canDraw`.
 *
 * Passes are NOT stripped here: an extra-turn play with an empty drawable
 * boneyard and no legal follow-up returns without an embedded pass, and the
 * client must still journal an explicit pass (fidelity seed 28).
 *
 * Aunt G2H6 (2026-08-20): a mid-presentation race re-ran the no-move draw
 * path after `play 1|5` had already embedded `2|2` / `1|6`, producing an
 * illegal protocol-2 `draw` and stranding verification.
 */
export function isPostPlayRecoveryMoveLogEntry(
  previous: Pick<MoveEntry, 'action' | 'player' | 'handNumber'> | null | undefined,
  entry: Pick<MoveEntry, 'action' | 'player' | 'handNumber'>,
): boolean {
  if (!previous) return false;
  if (previous.handNumber !== entry.handNumber) return false;
  if (previous.action !== 'place' || previous.player !== entry.player) return false;
  return entry.action === 'draw';
}

export function stripPostPlayRecoveryTranscriptActions(
  actions: readonly DailyFritzTranscriptAction[],
): DailyFritzTranscriptAction[] {
  const out: DailyFritzTranscriptAction[] = [];
  let lastPlayActor: DailyFritzTranscriptAction['actor'] | null = null;
  for (const action of actions) {
    if (lastPlayActor === action.actor && action.kind === 'draw') {
      continue;
    }
    out.push({ ...action, sequence: out.length });
    lastPlayActor = action.kind === 'play' ? action.actor : null;
  }
  return out;
}
