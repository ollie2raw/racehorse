import { Router } from 'express';
import { supabaseFetch } from '../supabaseUtils';
import { requireAuth } from '../social/socialAuth';
import { childLogger } from '../logger';

const log = childLogger('account');

/**
 * Account deletion.
 *
 * Deletes the **auth user**, not the profile row. Every table that belongs to
 * a player hangs off `auth.users` with `on delete cascade` — profiles,
 * friends, ranked_games.player_id, ghost_profiles, daily_fritz_attempts,
 * puzzle_rush runs — so removing the auth user is what actually erases the
 * account. Deleting `profiles` alone would leave a sign-in-able account with
 * no profile, which is worse than not deleting at all.
 *
 * What deliberately survives:
 *
 *  - `ranked_games` rows where the deleted user was the *opponent*.
 *    `opponent_id` is a bare uuid with no foreign key, so those rows are
 *    untouched and the other player's rating history stays intact and
 *    recomputable. The cost is that the id no longer resolves to a profile, so
 *    an opponent shows as unknown. Anonymising them instead would be a bigger
 *    change with no better outcome for the surviving player, and rewriting
 *    them would corrupt the very history it is meant to protect.
 *  - `matches.winner_user_id` / `loser_user_id` and the tournament tables,
 *    which are `on delete set null` — the match happened, the player is gone.
 *
 * This needs the service-role key. `supabaseFetch` uses it by default.
 */
export function registerAccountRoutes(router: Router): void {
  router.delete('/', async (req, res) => {
    const userId = await requireAuth(req, res);
    if (!userId) return;

    const confirm = typeof req.body?.confirm === 'string' ? req.body.confirm.trim().toLowerCase() : '';

    try {
      const profiles = await supabaseFetch<Array<{ username: string }>>(
        `/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=username&limit=1`,
      );
      const username = profiles?.[0]?.username;
      if (!username) {
        res.status(404).json({ error: 'Account not found.' });
        return;
      }

      // Typed confirmation, checked here as well as in the UI: this is
      // irreversible and a client is not the place to enforce intent.
      if (confirm !== username.trim().toLowerCase()) {
        res.status(400).json({ error: 'Type your username exactly to confirm deletion.' });
        return;
      }

      await supabaseFetch(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });

      log.info({ userId }, 'account deleted');
      res.json({ ok: true });
    } catch (err) {
      log.error({ err, userId }, 'account deletion failed');
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Unable to delete your account.',
      });
    }
  });
}

export const accountRouter = Router();
registerAccountRoutes(accountRouter);
