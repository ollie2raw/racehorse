// GC-4 (HARDENING_PLAN §7.3): the one non-integer computation in game-core lives
// on the `/bot` subpath, off the root barrel, so a verifier cannot pull it in.
export { drawableBoneyardCount, estimateDrawCostFromPublicInfo } from '@racehorse/game-core/bot';
