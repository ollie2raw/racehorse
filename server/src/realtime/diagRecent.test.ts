import { describe, it } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';

describe('diagRecent', () => {
  it('queries recent oliver games', async () => {
    const oliverId = '3d70f65e-e9a1-4c47-abb8-8bf2fc020295';
    try {
      const rows = await supabaseFetch<any[]>(
        `/rest/v1/ranked_games?player_id=eq.${oliverId}&played_at=gt.2026-07-07T00:00:00.000Z&order=played_at.desc`
      );
      console.log('OLIVER_GAMES_SINCE_JULY_7:', JSON.stringify(rows, null, 2));
    } catch (err) {
      console.error('ERROR:', err);
    }
  });
});
