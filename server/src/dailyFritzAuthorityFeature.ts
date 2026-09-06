/**
 * Expand-first rollout gate. Keep false until all 2026-08-01 Daily Fritz
 * migrations are applied; then enable on every server instance together.
 *
 * Manifest: docs/server-feature-flags.md (rollout / migration-gate).
 * remove-when: 2026-08-01 migrations confirmed applied in prod → make the
 * transactional path unconditional and delete this helper + the .env.example
 * line. (The "enable-when" above is documented; the "then delete it" is not.)
 */
export function isDailyFritzTransactionalAuthorityEnabled(): boolean {
  return process.env.DAILY_FRITZ_TRANSACTIONAL_COMMANDS === 'true';
}
