import type { GuidedMatchCandidate } from './guidedMatchCandidateTypes';

export interface GuidedMatchCandidateImportResult {
  candidate: GuidedMatchCandidate | null;
  errors: string[];
}

export function prepareGuidedMatchCandidateImport(rawJson: string): GuidedMatchCandidateImportResult {
  try {
    const parsed = JSON.parse(rawJson) as Partial<GuidedMatchCandidate>;
    const imported = parsed as GuidedMatchCandidate;
    const errors: string[] = [];
    if (imported.version !== 1) errors.push('version must be 1');
    if (!imported.candidateId) errors.push('candidateId is required');
    if (imported.targetScore !== 60) errors.push('targetScore must be 60');
    if (imported.opponent !== 'standard-fritz') errors.push('opponent must be standard-fritz');
    if (imported.dealSize !== 7) errors.push('dealSize must be 7');
    if (imported.result !== 'won' && imported.result !== 'lost') errors.push('result must be won or lost');
    if (!imported.finalScore) errors.push('finalScore is required');
    if (!imported.initialMatchSnapshot) errors.push('initialMatchSnapshot is required');
    if (!imported.finalMatchSnapshot) errors.push('finalMatchSnapshot is required');
    if (!Array.isArray(imported.events) || imported.events.length === 0) {
      errors.push('events must be a non-empty array');
    }

    const events = Array.isArray(imported.events) ? imported.events : [];
    const playerTileEventCount = events.filter(
      (event) => event.kind === 'tile-play' && event.actor === 'player',
    ).length;
    if (playerTileEventCount <= 0) errors.push('playerTileEventCount must be greater than 0');

    if (errors.length > 0) {
      return { candidate: null, errors };
    }

    const handCount = new Set(events.map((event) => event.handNumber)).size;
    const now = new Date().toISOString();
    return {
      candidate: {
        ...imported,
        createdAt: imported.createdAt || now,
        updatedAt: now,
        title: imported.title || 'Imported Guided Match Candidate',
        notes: imported.notes || '',
        fritzTier: imported.fritzTier || 'standard',
        rootSeed: imported.rootSeed ?? null,
        eventCount: events.length,
        playerTileEventCount,
        handCount,
      },
      errors: [],
    };
  } catch (error) {
    return {
      candidate: null,
      errors: [error instanceof Error ? `Import JSON parse failed: ${error.message}` : 'Import JSON parse failed.'],
    };
  }
}
