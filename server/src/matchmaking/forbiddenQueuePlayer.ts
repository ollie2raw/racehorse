import type { QueuedPlayer } from './types';

/**
 * Quick match must be human vs human only. Sim / dev bots use synthetic userIds
 * (`sim:…`), `isSim: true`, or the legacy display name `Bot (sim)`.
 */
export function isForbiddenMatchmakingPlayer(
  p: Pick<QueuedPlayer, 'userId' | 'username' | 'isSim'>,
): boolean {
  if (p.isSim) return true;
  const uid = String(p.userId ?? '').trim().toLowerCase();
  if (uid.startsWith('sim:')) return true;
  const un = String(p.username ?? '').trim().toLowerCase();
  return un === 'bot (sim)' || un === 'bot(sim)';
}
