import type { MatchExpectation } from './persistence';
import type { EnginePersistence } from './persistenceInterface';

/**
 * Compare-and-set a match: apply `patch` only if the match still holds exactly
 * `expected` (one conditional update in production). True when applied;
 * false means another process changed the match first — concurrent progress,
 * not an error: nothing is overwritten.
 */
export async function updateMatchIfUnchanged(
  persistence: EnginePersistence,
  matchId: string,
  expected: MatchExpectation,
  patch: Parameters<EnginePersistence['updateMatch']>[1],
): Promise<boolean> {
  if (persistence.updateMatchIf) return persistence.updateMatchIf(matchId, expected, patch);
  // Test doubles without the conditional write only.
  const current = await persistence.fetchMatchById(matchId);
  if (!current) return false;
  const holds = (Object.keys(expected) as Array<keyof MatchExpectation>)
    .every((field) => (current[field] ?? null) === (expected[field] ?? null));
  if (holds) await persistence.updateMatch(matchId, patch);
  return holds;
}
