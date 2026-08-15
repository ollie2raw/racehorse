const STORAGE_KEY = 'racehorse_circuit_progress_v1';

export type CircuitProgressRecord = {
  personalBest: number;
  deepestGate: number;
  bestAccuracy: number;
  runsCompleted: number;
  lastRunScore: number | null;
  lastRunAt: string | null;
  updatedAt: string;
};

function emptyProgress(): CircuitProgressRecord {
  return {
    personalBest: 0,
    deepestGate: 0,
    bestAccuracy: 0,
    runsCompleted: 0,
    lastRunScore: null,
    lastRunAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function loadCircuitProgress(userId?: string | null): CircuitProgressRecord {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Partial<CircuitProgressRecord>;
    return {
      personalBest: Number(parsed.personalBest) || 0,
      deepestGate: Number(parsed.deepestGate) || 0,
      bestAccuracy: Number(parsed.bestAccuracy) || 0,
      runsCompleted: Number(parsed.runsCompleted) || 0,
      lastRunScore: parsed.lastRunScore == null ? null : Number(parsed.lastRunScore) || 0,
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : emptyProgress().updatedAt,
    };
  } catch {
    return emptyProgress();
  }
}

export function saveCircuitRunResult(
  input: {
    score: number;
    deepestGate: number;
    accuracy: number;
  },
  userId?: string | null,
): CircuitProgressRecord {
  const prev = loadCircuitProgress(userId);
  const next: CircuitProgressRecord = {
    personalBest: Math.max(prev.personalBest, input.score),
    deepestGate: Math.max(prev.deepestGate, input.deepestGate),
    bestAccuracy: Math.max(prev.bestAccuracy, input.accuracy),
    runsCompleted: prev.runsCompleted + 1,
    lastRunScore: input.score,
    lastRunAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(next));
  }
  return next;
}

function storageKey(userId?: string | null): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}
