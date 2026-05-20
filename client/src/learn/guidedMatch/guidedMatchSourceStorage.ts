import type { GuidedMatchCandidate } from './guidedMatchCandidateTypes';

export const GUIDED_MATCH_SOURCE_STORAGE_KEY = 'racehorse:guided-match:source:v1';

function warnSourceStorage(message: string, detail?: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[guided-match-source] ${message}`, detail);
  }
}

function isSourceLike(value: unknown): value is GuidedMatchCandidate {
  const source = value as GuidedMatchCandidate | null;
  return Boolean(
    source &&
      source.version === 1 &&
      typeof source.candidateId === 'string' &&
      source.targetScore === 60 &&
      source.opponent === 'standard-fritz' &&
      source.dealSize === 7 &&
      Array.isArray(source.events),
  );
}

export function loadGuidedMatchSource(): GuidedMatchCandidate | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(GUIDED_MATCH_SOURCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isSourceLike(parsed)) {
      warnSourceStorage('stored source was not a valid guided match source');
      return null;
    }
    return parsed;
  } catch (error) {
    warnSourceStorage('source read failed', error);
    return null;
  }
}

export function saveGuidedMatchSource(source: GuidedMatchCandidate): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(GUIDED_MATCH_SOURCE_STORAGE_KEY, JSON.stringify(source));
    return true;
  } catch (error) {
    warnSourceStorage('source write failed', error);
    return false;
  }
}
