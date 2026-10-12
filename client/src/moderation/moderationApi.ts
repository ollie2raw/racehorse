import { apiDelete, apiGet, apiPost } from '../api/client';
import type { ReportCategory, ReportSource } from './moderationTypes';

/**
 * Report another player. Idempotent per (you, them, category): reporting the
 * same thing twice is accepted and stored once.
 */
export async function reportUser(input: {
  reportedUserId: string;
  category: ReportCategory;
  source: ReportSource;
}): Promise<{ error: string | null }> {
  const { error } = await apiPost<{ ok?: boolean }>('/api/moderation/reports', input);
  return { error: error ?? null };
}

/**
 * Ids of players you have blocked, or null if they couldn't be loaded.
 * Callers must treat null as "unknown" and fail closed (never as "none").
 */
export async function fetchBlockedUserIds(): Promise<string[] | null> {
  const { data, error } = await apiGet<{ ok?: boolean; blockedUserIds?: string[] }>('/api/moderation/blocks');
  if (error || !Array.isArray(data?.blockedUserIds)) return null;
  return data.blockedUserIds.filter((id): id is string => typeof id === 'string');
}

export async function blockUser(userId: string): Promise<{ error: string | null }> {
  const { error } = await apiPost<{ ok?: boolean }>(`/api/moderation/blocks/${encodeURIComponent(userId)}`, {});
  return { error: error ?? null };
}

export async function unblockUser(userId: string): Promise<{ error: string | null }> {
  const { error } = await apiDelete<{ ok?: boolean }>(`/api/moderation/blocks/${encodeURIComponent(userId)}`);
  return { error: error ?? null };
}
