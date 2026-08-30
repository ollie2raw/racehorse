import { resolveReleaseVersion } from './releaseVersion';

export type ApiHealthPayload = { ok: true; ts: number; release: string };

/**
 * The `/api/health` body.
 *
 * `release` is the point: this endpoint sits under the same `/api` prefix as
 * everything else, so it is the one people reach for first, and it was the one
 * that could not say which commit was running.
 */
export function buildApiHealthPayload(
  env: NodeJS.ProcessEnv = process.env,
  now: () => number = Date.now,
): ApiHealthPayload {
  return { ok: true, ts: now(), release: resolveReleaseVersion(env) };
}
