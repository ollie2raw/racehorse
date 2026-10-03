# Tournament format proposal — while live tournaments are paused

Status: **proposal only, nothing built.** Written 2026-10-03, alongside the
tournaments pause (`docs/tournament-review.md`, "Status update — tournaments
paused").

## The data this rests on
- **30 days of scheduled events (2026-09-03 → 10-03):** 1,440 events, one every 30 minutes.
  - 1,438 had **0** registered humans.
  - 1 had **1** human, and 1 had **2**.
  - **0 completed**; all 1,440 were cancelled.
  - Only **2 distinct accounts** registered, and both look like test accounts.
- **All time:** 7 accounts have ever registered, 37 registrations in total. The last completed event was **2026-07-09**.
- **A defect hid demand:** the match-completion functions (08-31 migration) were never applied to production. So no human event could have finished even with players. Low supply is real, but it isn't the only reason nothing completed.

A scheduled bracket needs several people present at the same moment. With
this supply, a live format cannot run, so the choice is between a solo format
now and a gated live format later.

## 1. Fritz Gauntlet (solo, recommended now)
**What it is:** three wins in a row against escalating Fritz bots, using the bracket presentation. It is labelled honestly as a solo challenge, never as a live tournament.

| | Gauntlet |
|---|---|
| Opponents | Round 1 Fritz **Standard**, Round 2 **Elite**, Round 3 **Master**. These are the tiers the live bracket already gives bot-filled QF / SF / Final slots (`_tournament_advance_target` in the 08-31 migration) |
| Format | First to 30 per match, as tournament matches are today. A loss ends the run |
| Start | Tap **Start Gauntlet**: no registration, seats, countdown or waiting |
| Copy | "Fritz Gauntlet — beat three Fritz bots in a row." The final win reads "Gauntlet cleared", **not** "Champion". No seat numbers, no "8 players", no other players' names |
| UI | Reuse `TournamentBracketScreen`'s bracket layout as a 3-step ladder (QF/SF/Final columns become rounds 1-3), with the amber Tournament accent. The match itself is the existing Play vs Fritz bot match screen |
| Where it lives | A card in the Single Player hub, and the home "next move" slot after a Daily Fritz is done. Not the Tournament tab, which stays hidden |
| Server cost | **About zero.** Matches run in the browser like Play vs Fritz. No scheduler, no rooms, no 30 s tick. Optionally record the run result in one row per attempt |
| Review | Each match can use the existing on-demand review (#325). The job starts only when the player opens it |
| Rating | **No Glicko change** at first (bot games). Revisit once the format proves itself |
| Optional, later | A weekly "cleared" leaderboard (fewest points conceded); a streak for consecutive clears |

**Effort:**
- About 3–5 days client: ladder view, run state (local storage plus an optional server record), copy, and entry cards.
- About 1 day server, only if runs are recorded: one table, one insert route through the existing verifier pattern.
- No migration if runs stay local.

**Risks:**
- *Fake-tournament feel:* avoided by the copy rules above, and by never showing other players or "live".
- *Name clash:* the retired daily **Gauntlet** (hidden 2026-03-31) still has `gauntlet_*` RPCs and tables in production. Either name this "Fritz Gauntlet" in the UI with a distinct internal name (`fritz_ladder_*`), or formally retire the old RPCs first.
- *Cannibalising Play vs Fritz:* it's the same matches with a goal on top. Watch whether total bot matches grow or just move.

## 2. Re-enable rule for live tournaments
**Rule:** a live event **runs only if at least N humans are registered when registration closes**. Otherwise it is cancelled with `cancel_reason = 'not_enough_humans'`, and registrants are told so in-app, with no bot-filled "champion".

**Proposed starting value: N = 4.**
- Half the bracket human, so every human plays at least one human in the quarter-finals.
- Bots then fill only the other half.
- Below 4, the event is mostly a solo bot ladder, which the Gauntlet already provides honestly.

**Cadence:** **do not** return to 48 events a day. Start with **1–2 events a day**, at the hour or hours with the most signed-in players, and add slots only when slots routinely reach N.

**Data needed to pick N and the slots** (none of this is collected today):

| Measure | Why | How to get it |
|---|---|---|
| Signed-in daily active players, by hour (Pacific) | where a slot could plausibly reach N | existing auth/session or PostHog data |
| Visits to the "coming back soon" screen per day | latent interest while paused | one counter (like #325's funnel), not built |
| "Notify me when tournaments return" taps | the size of a first-event pool | a button on that screen, not built |
| Gauntlet starts and clears per day (if built) | a willingness-to-compete signal that needs no other players | run records |
| For a trial event: registrants at close vs show-ups at start | no-show rate, which decides how far above N to aim | existing match rows (`player*_joined_at`) |

**Suggested decision rule:** re-enable a slot when, over two weeks, the projected registrations at close (notify-me pool × observed sign-up rate, or a trial event's count) would reach **N ≥ 4 in at least 70% of events** in that slot. Re-check monthly. If a slot falls below that for two weeks, drop it.

## 3. Rewards and stakes (L3), for later
Nothing should be promised before live events can actually complete.
- **Gauntlet:** a cosmetic badge for a first clear and a clear streak; no rating.
- **Live events once re-enabled:** placement badges on the profile, and a small rated bonus only for wins over humans.

Bot wins should never feed rating or "champion" activity posts. That's the same principle as the A3 decision.
