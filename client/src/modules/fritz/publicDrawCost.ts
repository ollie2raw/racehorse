// GC-4 (HARDENING_PLAN §7.3): bot heuristics live on the `/bot` subpath, not the
// root barrel, so verifier code can't import the one non-integer computation.
export { drawableBoneyardCount, estimateDrawCostFromPublicInfo } from '@racehorse/game-core/bot';
