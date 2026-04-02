# Supabase Setup (Fast Path v1)

1. Create a Supabase project.
2. Open **SQL Editor** and run `supabase/schema.sql`.
3. Run `supabase/daily_puzzle.sql` to add Daily Puzzle tables/policies.
4. In `client/.env` (or `.env.local`) set:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_ADMIN_EMAIL=you@example.com
```

6. Start the client normally (`npm run dev` in `client/`).
7. In `supabase/daily_puzzle.sql`, replace `admin@example.com` with the same email as `VITE_ADMIN_EMAIL` before running it.

## Notes
- If env vars are missing, the app stays in Guest mode and gameplay still works.
- Auth methods enabled in Supabase should include Email/Password.
- Stats writes are client-side and protected by RLS policies in `schema.sql`.
