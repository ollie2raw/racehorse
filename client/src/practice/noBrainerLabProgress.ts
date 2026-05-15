const STORAGE_PREFIX = 'racehorse_nobrainer_solved_v1';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readSolvedKeys(userId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === 'string'));
  } catch {
    return new Set();
  }
}

function writeSolvedKeys(userId: string, keys: Set<string>): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(userId), JSON.stringify([...keys]));
}

/** Distinct no-brainer hands the player has cleared without hint or solution reveal. */
export function getNoBrainerSolvedCount(userId: string | null | undefined): number | null {
  if (!userId) return null;
  return readSolvedKeys(userId).size;
}

/** @returns true when this hand was newly added to the solved set */
export function markNoBrainerHandSolved(userId: string | null | undefined, handKey: string): boolean {
  if (!userId || !handKey.trim()) return false;
  const keys = readSolvedKeys(userId);
  if (keys.has(handKey)) return false;
  keys.add(handKey);
  writeSolvedKeys(userId, keys);
  return true;
}

export function hasNoBrainerHandSolved(userId: string | null | undefined, handKey: string): boolean {
  if (!userId || !handKey.trim()) return false;
  return readSolvedKeys(userId).has(handKey);
}
