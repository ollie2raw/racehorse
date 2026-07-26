import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  type DailyFritzTranscript,
} from '@racehorse/game-core';
import type { MoveEntry } from '../game/moveLogger.ts';

function duplicatePlacementEvidenceKey(entry: MoveEntry): string | null {
  if (entry.action !== 'place') return null;
  const { moveNumber: _moveNumber, ...evidence } = entry;
  return JSON.stringify(evidence);
}

function currentHandEntries(
  moveLog: readonly MoveEntry[],
  handNumber: number,
): MoveEntry[] {
  const entries: MoveEntry[] = [];
  let previousPlacementKey: string | null = null;

  for (const entry of moveLog) {
    if (entry.handNumber !== handNumber) continue;
    const placementKey = duplicatePlacementEvidenceKey(entry);
    if (placementKey && placementKey === previousPlacementKey) {
      // Mobile double-click recovery: two handlers can capture the identical
      // pre-move evidence before React commits the first accepted placement.
      continue;
    }
    entries.push(entry);
    previousPlacementKey = placementKey;
  }

  return entries;
}

export function buildDailyFritzTranscript(input: {
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  handNumber: number;
  moveLog: readonly MoveEntry[];
}): DailyFritzTranscript {
  const entries = currentHandEntries(input.moveLog, input.handNumber);
  const actions = entries.map((entry, sequence) => {
    const actor = entry.player === 'you' ? 'player' as const : 'fritz' as const;
    if (entry.action === 'place') {
      if (!entry.tile || !entry.position) {
        throw new Error('Daily Fritz play transcript is missing its tile or placement.');
      }
      return {
        sequence,
        actor,
        kind: 'play' as const,
        tile: { low: entry.tile[0], high: entry.tile[1] },
        position: entry.position,
      };
    }
    return { sequence, actor, kind: entry.action } as const;
  });

  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    challengeId: input.challengeId,
    attemptId: input.attemptId,
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
    actions,
  };
}
