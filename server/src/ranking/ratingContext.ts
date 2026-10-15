import type { MatchOutcome } from './glicko2';

export type RankedRatingTreatment = 'standard' | 'disconnect_forfeit';
export type RankedRatingContext = {
  version: 1;
  treatment: RankedRatingTreatment;
  outcome: MatchOutcome;
  opponent: { rating: number; rd: number };
};

/** NULL/absent belongs only to historical/old-writer rows, never new payloads. */
export function readRankedRatingContext(raw: unknown): RankedRatingContext | null {
  if (raw == null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid ranked rating context');
  const row = raw as Record<string, unknown>;
  const opponent = row.opponent as Record<string, unknown> | null;
  if (Object.keys(row).sort().join(',') !== 'opponent,outcome,treatment,version'
    || row.version !== 1 || !['standard', 'disconnect_forfeit'].includes(row.treatment as string)
    || !['win', 'loss', 'draw'].includes(row.outcome as string)
    || !opponent || typeof opponent !== 'object' || Array.isArray(opponent)
    || Object.keys(opponent).sort().join(',') !== 'rating,rd'
    || typeof opponent.rating !== 'number' || !Number.isFinite(opponent.rating)
    || typeof opponent.rd !== 'number' || !Number.isFinite(opponent.rd) || opponent.rd <= 0) {
    throw new Error('Invalid ranked rating context');
  }
  return { version: 1, treatment: row.treatment as RankedRatingTreatment, outcome: row.outcome as MatchOutcome,
    opponent: { rating: opponent.rating as number, rd: opponent.rd as number } };
}

export function rankedRatingWeight(context: RankedRatingContext | null): number {
  return context?.treatment === 'disconnect_forfeit' ? 0.5 : 1;
}
