import { supabaseFetch } from '../supabaseUtils';

export async function upsertPresence(
  userId: string,
  status: 'online' | 'in_game' | 'offline',
  currentMode?: string | null,
): Promise<void> {
  await supabaseFetch('/rest/v1/player_presence', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      user_id: userId,
      status,
      current_mode: currentMode ?? null,
      last_seen: new Date().toISOString(),
    }),
  });
}

export async function getPresenceBatch(
  userIds: string[],
): Promise<Map<string, { status: string; current_mode: string | null }>> {
  if (!userIds.length) return new Map();
  const filter = userIds.map((id) => `user_id.eq.${encodeURIComponent(id)}`).join(',');
  const rows = await supabaseFetch<
    Array<{ user_id: string; status: string; current_mode: string | null }>
  >(`/rest/v1/player_presence?or=(${filter})&select=user_id,status,current_mode`);
  const map = new Map<string, { status: string; current_mode: string | null }>();
  for (const row of rows) {
    map.set(row.user_id, { status: row.status, current_mode: row.current_mode });
  }
  return map;
}
