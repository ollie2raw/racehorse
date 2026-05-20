import {
  GUIDED_MATCH_CANDIDATE_VERSION,
  GUIDED_MATCH_CANDIDATES_STORAGE_KEY,
  type GuidedMatchCandidate,
} from './guidedMatchCandidateTypes';

function warnCandidateStorage(message: string, detail?: unknown): void {
  if (import.meta.env.DEV) {
    console.warn(`[guided-match-candidates] ${message}`, detail);
  }
}

function safeRead(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    warnCandidateStorage('localStorage read failed', error);
    return null;
  }
}

function safeWrite(key: string, value: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    warnCandidateStorage('localStorage write failed', error);
    return false;
  }
}

function isCandidateLike(value: unknown): value is GuidedMatchCandidate {
  const candidate = value as GuidedMatchCandidate | null;
  return Boolean(
    candidate &&
      candidate.version === GUIDED_MATCH_CANDIDATE_VERSION &&
      typeof candidate.candidateId === 'string' &&
      typeof candidate.createdAt === 'string' &&
      typeof candidate.updatedAt === 'string' &&
      candidate.opponent === 'standard-fritz' &&
      candidate.fritzTier === 'standard' &&
      candidate.dealSize === 7 &&
      candidate.targetScore === 60 &&
      Array.isArray(candidate.events),
  );
}

function sortNewestFirst(candidates: GuidedMatchCandidate[]): GuidedMatchCandidate[] {
  return [...candidates].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export function loadGuidedMatchCandidates(): GuidedMatchCandidate[] {
  const raw = safeRead(GUIDED_MATCH_CANDIDATES_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      warnCandidateStorage('candidate store was not an array');
      return [];
    }
    return sortNewestFirst(parsed.filter(isCandidateLike));
  } catch (error) {
    warnCandidateStorage('candidate store JSON was corrupted', error);
    return [];
  }
}

export function saveGuidedMatchCandidates(candidates: GuidedMatchCandidate[]): boolean {
  return safeWrite(GUIDED_MATCH_CANDIDATES_STORAGE_KEY, JSON.stringify(sortNewestFirst(candidates)));
}

export function upsertGuidedMatchCandidate(candidate: GuidedMatchCandidate): boolean {
  const candidates = loadGuidedMatchCandidates();
  const next = [
    candidate,
    ...candidates.filter((existing) => existing.candidateId !== candidate.candidateId),
  ];
  return saveGuidedMatchCandidates(next);
}

export function deleteGuidedMatchCandidate(candidateId: string): boolean {
  const candidates = loadGuidedMatchCandidates();
  return saveGuidedMatchCandidates(candidates.filter((candidate) => candidate.candidateId !== candidateId));
}

export function getGuidedMatchCandidate(candidateId: string): GuidedMatchCandidate | null {
  return loadGuidedMatchCandidates().find((candidate) => candidate.candidateId === candidateId) ?? null;
}

export function createGuidedMatchCandidateId(): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `guided-match-candidate-${suffix}`;
}
