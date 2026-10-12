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

/** Ids of players you have blocked. Empty when signed out or on failure. */
export async function fetchBlockedUserIds(): Promise<string[]> {
  const { data, error } = await apiGet<{ ok?: boolean; blockedUserIds?: string[] }>('/api/moderation/blocks');
  if (error || !Array.isArray(data?.blockedUserIds)) return [];
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
