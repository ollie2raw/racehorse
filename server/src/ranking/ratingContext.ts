import type { MatchOutcome } from './glicko2';

export type RankedRatingTreatment = 'standard' | 'disconnect_forfeit';
export type RankedCompletionCause = 'completed' | 'manual_forfeit' | 'disconnect_timeout';
export type RankedPlayerSnapshot = { rating: number; rd: number; vol: number; gamesPlayed: number; peakRating: number };
export type RankedRatingContext = {
  version: 1;
  treatment: RankedRatingTreatment;
  cause: RankedCompletionCause;
  outcome: MatchOutcome;
  player: RankedPlayerSnapshot;
  opponent: { rating: number; rd: number };
};
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const rating = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10000;
const rd = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000;

/** NULL is the explicit historical policy; malformed new records never use it. */
export function readRankedRatingContext(raw: unknown): RankedRatingContext | null {
  if (raw == null) return null;
  if (!object(raw) || !keys(raw, 'cause,opponent,outcome,player,treatment,version')
    || raw.version !== 1 || !['standard', 'disconnect_forfeit'].includes(raw.treatment as string)
    || !['completed', 'manual_forfeit', 'disconnect_timeout'].includes(raw.cause as string)
    || (raw.treatment === 'disconnect_forfeit') !== (raw.cause === 'disconnect_timeout')
    || !['win', 'loss', 'draw'].includes(raw.outcome as string)
    || (raw.cause !== 'completed' && raw.outcome === 'draw')
    || !object(raw.player) || !keys(raw.player, 'gamesPlayed,peakRating,rating,rd,vol')
    || !rating(raw.player.rating) || !rd(raw.player.rd) || !rating(raw.player.peakRating)
    || typeof raw.player.vol !== 'number' || !Number.isFinite(raw.player.vol) || raw.player.vol <= 0 || raw.player.vol > 1
    || !Number.isSafeInteger(raw.player.gamesPlayed) || Number(raw.player.gamesPlayed) < 0 || Number(raw.player.gamesPlayed) >= 2147483647
    || !object(raw.opponent) || !keys(raw.opponent, 'rating,rd') || !rating(raw.opponent.rating) || !rd(raw.opponent.rd)) {
    throw new Error('Invalid ranked rating context');
  }
  return { version: 1, treatment: raw.treatment as RankedRatingTreatment, cause: raw.cause as RankedCompletionCause,
    outcome: raw.outcome as MatchOutcome, player: { rating: raw.player.rating, rd: raw.player.rd, vol: raw.player.vol,
      gamesPlayed: Number(raw.player.gamesPlayed), peakRating: raw.player.peakRating },
    opponent: { rating: raw.opponent.rating, rd: raw.opponent.rd } };
}
export function rankedRatingWeight(context: RankedRatingContext | null): number {
  return context?.treatment === 'disconnect_forfeit' ? 0.5 : 1;
}
