/**
 * Expand-first rollout gate. Keep false until all 2026-08-01 Daily Fritz
 * migrations are applied; then enable on every server instance together.
 */
export function isDailyFritzTransactionalAuthorityEnabled(): boolean {
  return process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS === 'true';
}
