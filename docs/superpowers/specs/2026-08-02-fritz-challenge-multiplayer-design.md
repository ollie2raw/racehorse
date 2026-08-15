# Fritz Challenge (shared anytime BO3) — Design

**Date:** 2026-08-02  
**Status:** Approved for planning  
**Owner:** Product / Racehorse  

## 1. Problem

Daily Fritz is once per day. Players want another fixed best-of-3 Fritz set they can create anytime, share with friends, and compare results on the **same deals** — without turning Daily Fritz into “play twice a day.”

## 2. Goals

- Create an **additional** Daily Fritz–style best-of-3 at any time.
- Share one fixed seed/set with **up to 4 other players** (5 total including creator).
- Async play: each participant plays their own BO3 vs Fritz on identical deals.
- **Live challenge leaderboard** as people finish (same feel as Daily Fritz).
- Prevent creator **scouting** (playing the set before anyone else has joined).

## 3. Non-goals (v1)

- Live spectating mid-set
- Push notifications / SMS
- Public discovery lobbies / matchmaking
- Rematch flows
- Betting / stakes
- Replacing Daily Fritz

## 4. Locked product rules

| Rule | Decision |
|------|----------|
| Format | Best of 3 vs Fritz, winning score 60 (same as Daily Fritz) |
| Roster | Creator + **max 4 others** (5 seats total) |
| Start — invitee | May start as soon as they have joined |
| Start — creator | May start only after **≥1 other** has joined (anti-scout) |
| Results | **Live leaderboard** — finish → appear; others append as they complete |
| Fairness | One shared seed; deals identical for all participants |
| Auth | Sign-in required to create, join, and play |

### Anti-scout meaning

Creator cannot start (and therefore cannot learn the fixed deals) until at least one other player has joined the challenge.

## 5. User flow

```text
Creator: entry → configure tier/deal (reuse PVF setup defaults) → Create
       → Challenge Room (share link, roster empty of invitees)
Invitee: open #/fritz/challenge/{CODE} → Join (if seat available)
Invitee: Start → BO3 match (DF rails) → return to room → on leaderboard
Creator: after ≥1 join → Start → same → on leaderboard
Room: poll/refresh roster + live leaderboard until expired/cancelled
```

### Deep link

`{origin}{pathname}#/fritz/challenge/{8-char share code}`  
(Existing link helper; keep stable.)

## 6. Entry points (v1 → v1.1)

**v1:** Keep create CTA on Play vs Fritz (“Challenge a Friend” → rename to Challenge / Challenge Friends).  
**v1.1:** First-class Solo hub card + optional Friends surface; history of my open/active challenges.

Room and match chrome should brand as **Challenge**, not Daily Fritz, even while reusing DF match machinery.

## 7. Architecture (approach #2)

Evolve the existing Fritz Challenge WIP from **1 opponent** to **multi-participant**.

### 7.1 Data model

**`fritz_challenges`** (challenge shell)

- Keep: `id`, `share_code`, `creator_user_id`, `seed` (server-only), format/tier/deal/winning_score/version fields, `status`, `created_at`, `expires_at`, `completed_at`
- Deprecate reliance on `opponent_user_id` for roster (nullable legacy or drop via migration once participants table is source of truth)
- Add: `max_participants int not null default 5` (creator + 4), optional `join_open boolean` (default true until full/cancelled)

**`fritz_challenge_participants`** (new)

- `challenge_id`, `user_id`, `role` (`creator` | `invitee`), `joined_at`
- Unique `(challenge_id, user_id)`
- Constraint / app check: participant count ≤ 5
- Creator row created at challenge create time

**`fritz_challenge_attempts`** (existing)

- Keep one attempt per `(challenge_id, user_id)`
- Status: `started` | `completed` | `abandoned`
- Do **not** mark parent challenge `completed` when the first attempt finishes

**`fritz_challenge_hands`** (existing)

- Shared deals keyed by `(challenge_id, game_number, hand_index)` generated from challenge seed

### 7.2 Challenge status semantics

| Status | Meaning |
|--------|---------|
| `open` | Joinable; may have 1–N participants; creator may not yet be eligible to start |
| `active` | At least one attempt started **or** ≥2 participants (implementation may collapse with `open` if simpler — prefer: `open` until first start, then `active`) |
| `completed` | All joined participants have finished or abandoned **and** at least one completed attempt exists — **or** expiry policy closes it. v1 may instead leave `active` until `expires_at` and never require “all done.” |
| `expired` / `cancelled` | No new joins / starts |

**v1 preference:** Keep challenge joinable until full or expired; mark `completed` only when expired **or** creator cancels **or** all participants completed/abandoned (whichever product prefers). Minimum bar: **never** set `completed` solely because one player finished.

### 7.3 Server APIs (evolve existing)

| Endpoint | Behavior |
|----------|----------|
| `POST /api/fritz-challenges` | Create challenge + creator participant; generate seed + share code |
| `GET /api/fritz-challenges/:code` | Sanitized view: roster, seat count, canJoin, canStart, live leaderboard rows, never expose seed |
| `POST .../join` | Auth user joins if seat &lt; 5, not already in, not expired |
| `POST .../start` | Start/resume attempt; **reject creator** if invitee count = 0 |
| `POST .../next-hand` / `record-game` | Existing verified DF-style path scoped by challenge attempt |
| Leaderboard | Built from completed attempts for this `challenge_id` (same sort keys as Daily Fritz where applicable) |

### 7.4 Client

- `FritzChallengeDialog` / Room: multi-seat roster, share, live board, start gating copy for creator
- Match: continue mapping challenge package → BotMatch on DF lifecycle with `challenge_code`
- Back navigation returns to challenge room hash, not Solo hub
- Feature flag: `VITE_FRITZ_CHALLENGES_ENABLED` (dev on by default)

### 7.5 Ranking (challenge board)

Reuse Daily Fritz ordering intent among **completed verified** attempts on this challenge:

1. Set wins (player games won)
2. Skunk quality / ranks (same helpers as DF when fields exist)
3. Point differential
4. Earlier `completed_at` wins ties

Incomplete participants show as “In progress” / “Not started” in the room UI, not as ranked rows (same as DF board only listing finishers).

## 8. UX copy principles

- Position as **your own shared Fritz set**, not a second Daily.
- Creator waiting: “Waiting for a friend to join before you can start” (anti-scout, plain language).
- Full: “Challenge is full (5/5).”
- Leaderboard empty: “Finish your set to take the board.”

## 9. Security & fairness

- Seed never returned to clients
- RLS deny-all on challenge tables; service role via API only
- Creator cannot self-join as second seat
- Start gate enforced in SQL/RPC, not only UI
- Transcript verification for hand/game advance (existing path)

## 10. Migration from current WIP

1. Add `fritz_challenge_participants`; backfill creator (+ opponent if present) from existing rows
2. Update claim/join RPC from single `opponent_user_id` to insert participant with capacity check
3. Update start RPC creator gate: `exists invitee participant`
4. Fix completion: remove “first finisher completes challenge”
5. Extend GET payload with `participants[]` + `leaderboard[]`
6. Update room UI + tests + one e2e happy path

## 11. Success criteria

- Creator creates, shares; up to 4 others join
- Creator Start blocked until ≥1 join; invitee Start works immediately after join
- All players receive identical deals for game/hand indices
- Each completion appears on the challenge leaderboard without waiting for others
- Challenge is not closed by the first completion
- Flag + schema + API committed and runnable in staging/prod

## 12. Open items (resolve during planning if needed)

- Exact expiry default (e.g. 72h)
- Whether joins remain open after creator has started
- Cancel / leave semantics for invitees mid-roster
- Solo hub card timing (v1 vs v1.1)

## 13. References

- Existing WIP: `client/src/fritzChallenge/*`, `server/src/fritzChallenge.ts`, `server/src/http/routes/fritzChallenges.ts`, `server/src/http/stores/fritzChallengeStore.ts`
- Schema: `supabase/fritz_challenges.sql`
- Daily Fritz leaderboard patterns: `server/src/dailyFritz.ts`, `buildDailyFritzLeaderboard`
