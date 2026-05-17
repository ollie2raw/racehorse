import { describe, expect, it } from 'vitest';
import { dedupeMatchRows } from './dedupeMatchRows';

describe('dedupeMatchRows', () => {
  it('removes identical online rows recorded by both clients', () => {
    const rows = [
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        winner_score: 66,
        loser_score: 19,
        created_at: '2026-05-15T12:00:00.123Z',
        room_code: 'ABC123',
      },
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        winner_score: 66,
        loser_score: 19,
        created_at: '2026-05-15T12:00:00.456Z',
        room_code: 'ABC123',
      },
    ];
    expect(dedupeMatchRows(rows)).toHaveLength(1);
  });

  it('keeps separate games in the same room when scores differ', () => {
    const rows = [
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        winner_score: 66,
        loser_score: 19,
        created_at: '2026-05-15T12:00:00.000Z',
        room_code: 'ABC123',
      },
      {
        winner_user_id: 'a',
        loser_user_id: 'b',
        winner_score: 50,
        loser_score: 40,
        created_at: '2026-05-15T12:20:00.000Z',
        room_code: 'ABC123',
      },
    ];
    expect(dedupeMatchRows(rows)).toHaveLength(2);
  });
});
