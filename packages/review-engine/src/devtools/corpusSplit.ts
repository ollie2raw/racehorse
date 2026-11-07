/**
 * The tuning / held-out split of the recorded corpus, fixed once and used by every study in docs/review-performance-measurement-2026-11-07.md: the corpus is two
 * files of five games (an "ordinary" policy and a "strong" policy, both bot play). Games 0 to 2 of each file are TUNING (6 games), games 3 and 4 of each are
 * HELD-OUT (4 games). Anything tuned (a threshold, a minimum N) is tuned on `tuning` only and reported on `heldout`.
 */
export type CorpusSplit = 'tuning' | 'heldout';

export const splitOf = (gameId: string): CorpusSplit => (Number(gameId.split(':').at(-1)) >= 3 ? 'heldout' : 'tuning');
