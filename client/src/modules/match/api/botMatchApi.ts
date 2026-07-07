/**
 * API client for standalone Play vs Fritz match recording.
 * Separate from the shared apiPost because the bot match start/abandon
 * path uses a ref-based token (populated once at match start) rather than
 * per-request getSession(), and supports keepalive for unload abandon.
 */

import { resolveGameServerUrl } from '../../../lib/gameServerUrl.ts';

export async function startLocalBotMatch(
  body: Record<string, unknown>,
  accessToken: string | null,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${resolveGameServerUrl()}/api/bot-matches/local/start`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `start failed with ${response.status}`);
  }
  if (response.status === 204) return null;
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function abandonLocalBotMatch(
  body: Record<string, unknown>,
  accessToken: string | null,
  options?: { keepalive?: boolean },
): Promise<void> {
  await fetch(`${resolveGameServerUrl()}/api/bot-matches/local/abandon`, {
    method: 'POST',
    credentials: 'include',
    keepalive: options?.keepalive ?? false,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  // Fire-and-forget on keepalive path; errors not surfaced
}
