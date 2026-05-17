export type MatchRowForDedupe = {
  winner_user_id: string | null;
  loser_user_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  created_at: string;
  room_code?: string | null;
};

/** Collapse duplicate rows written when both clients recorded the same online game. */
export function dedupeMatchRows<T extends MatchRowForDedupe>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const [idx, row] of rows.entries()) {
    const roomCode = row.room_code?.trim();
    const createdKey = row.created_at ? row.created_at.slice(0, 19) : `idx:${idx}`;
    const key = roomCode
      ? `room:${roomCode}:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}`
      : `match:${row.winner_user_id ?? ''}:${row.loser_user_id ?? ''}:${row.winner_score ?? ''}:${row.loser_score ?? ''}:${createdKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
