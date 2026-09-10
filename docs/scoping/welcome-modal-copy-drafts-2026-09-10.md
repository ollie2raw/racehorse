# Welcome-modal copy drafts — for review

**Date:** 2026-09-10. **No UI built.** Three content directions + a minimal
fallback, drafted against the **current** mode lineup (verified in-code, not the
stale 2026 modal). Pick a direction (or mix), then it becomes a build task.

Companion to `welcome-modal-decision-package-2026-09-10.md` (history + the
zero-state screenshots).

---

## Ground truth — the modes, as they read in the product today

Pulled from the live cards/hubs so drafts use real product voice:

| Mode | Route | Where it lives now | Current one-liner (verbatim from the app) |
|---|---|---|---|
| **Daily Fritz** | `/daily-fritz` | Home "Today's Race" card | "Best of 3 series. Same deal for everyone." |
| **Daily Puzzles** | `/puzzle-rush` | Home "Today's Race" card | "Beat the clock. Solve as many as you can." |
| **Play vs Fritz** | `/solo/fritz` | Single Player tab | "Fritz doesn't go easy. Find out if you're good enough." |
| **Ghost Mode** | `/solo/ghost` | Single Player tab | "Race against a model of your own game. Can you beat yourself?" |
| **Journey** | `/journey` | **no discoverable home entry** (deep-link / challenge-return only) | "A long march through Fritz — a deliberate test of instinct, tempo, and score pressure." (6 chapters, 108 nodes) |
| **The Lab** | `/practice` | Learn tab | "Some starting hands win in one turn — all 7 tiles in a single chain. Learn to spot them." |
| **Guided Match** | `/learn/…` | Learn tab | "One coached game, every move narrated." |
| **How to Play** | `/learn/how-to-play` | Learn tab | "Walk through the rules and core instincts." |
| **Multiplayer** | `/multiplayer` | Multiplayer tab | live 1v1 — matchmaking or a private room code |
| **Tournament** | `/tournament` | Tournament tab | round-robin lobby → full bracket |
| **Social** | `/social` `/friends` `/stats` | Social tab | friends, activity feed, leaderboard, your stats |

**What the zero-state home screen actually shows** (from the screenshots): the
two "Today's Race" cards + a 5-tab strip (`Multiplayer · Single Player ·
Tournament · Social · Learn`). No descriptions, no "start here", **Journey is
invisible**, and "Single Player" hides Fritz + Ghost behind one word.

---

## Direction A — "Mode picker" (the 2026 modal, refreshed)

The direct descendant of what was cut. A first-visit dialog that lays out every
place to play in one screen, grouped so the 11 modes don't read as a wall.

> ### Welcome to Racehorse Dominoes
> Dominoes as a thinking game. Everything you play is tracked automatically —
> pick where to start.
>
> **Every day**
> - **Daily Fritz** — a best-of-3 series against the bot. Same deal for everyone; compare your run on the leaderboard.
> - **Daily Puzzles** — beat the clock. Solve as many as you can before it runs out.
>
> **Solo**
> - **Play vs Fritz** — a full match against the AI. Four difficulty tiers; Fritz doesn't go easy.
> - **Ghost Mode** — race a model of your own past games. Can you beat yourself?
> - **Journey** — a long campaign through Fritz: 6 chapters of instinct, tempo, and score-pressure tests.
> - **The Lab** — some starting hands clear all 7 tiles in one turn. Learn to spot them instantly.
>
> **With other people**
> - **Multiplayer** — live 1v1. Match with anyone, or share a room code with a friend.
> - **Tournament** — round-robin lobby into a full knockout bracket.
>
> **Learn**
> - **How to Play** + **Guided Match** — the rules, then one coached game with every move narrated.
>
> `[ Start with today's Daily Fritz ]`   ·   `Just look around`

Notes:
- CTA goes to the highest-intent single action (the daily), not a dead "OK".
- "Just look around" dismisses without picking — closes the same as the ✕.
- Long. Needs the grouped layout to not overwhelm; scrollable on mobile.
- Surfaces **Journey**, which currently has no home entry — a real bonus.

---

## Direction B — "Start with today" (funnel to the daily habit)

The home screen already leads with the two daily cards; this leans all the way
in. First visit = do today's challenge, everything else is a short "later" list.
Lowest cognitive load; strongest habit hook.

> ### Welcome. Here's today.
> Racehorse is built around two daily challenges — start with one, and your
> streak begins.
>
> **🏇 Daily Fritz** — best-of-3 against the bot. ~5 minutes.
> **🧩 Daily Puzzles** — solve as many as you can before the clock runs out.
>
> `[ Play Daily Fritz ]`   `[ Play Daily Puzzles ]`
>
> ---
> *When you want more:* full matches vs Fritz or a **Ghost** of your own game ·
> live **Multiplayer** and **Tournaments** · the **Journey** campaign · rules and
> coached games under **Learn**. All from the tabs below.
>
> `Got it`

Notes:
- Two concrete CTAs (both dailies), the rest is one sentence of orientation.
- Sets the expectation that Racehorse is a *daily* thing — matches the "One daily tradition" tagline already on the home screen.
- Doesn't teach the game; assumes "dominoes" is enough and How to Play is one tab away.
- Risk: a player who wants multiplayer *first* has to read the fine print.

---

## Direction C — "30-second version, then pick" (orientation + navigation)

Two beats: what the game is, then where to go. For players who may not know
Racehorse's specific spin (score on your opponent's pips, spinners, the boneyard).

> ### New here? The 30-second version.
> - It's dominoes — match tiles end to end, first to empty your hand wins the hand.
> - You **score** every time the open ends add up to a multiple of five.
> - Doubles are spinners — the line can branch four ways.
> - Can't play? Draw from the boneyard.
>
> **Full walkthrough:** How to Play (in the Learn tab) · or just start and pick it up.
>
> ---
> ### Where to start
> - **Today's Race** — Daily Fritz + Daily Puzzles. One run each, every day.
> - **Single Player** — full matches vs Fritz, or Ghost, or the Journey campaign.
> - **Multiplayer / Tournament** — play live against other people.
>
> `[ Play Daily Fritz ]`   ·   `Explore on my own`

Notes:
- The rules bullets are drafted from the actual scoring model — **confirm they're
  right** (esp. "multiple of five" and the four-way spinner) before shipping.
- Heavier read than A or B; best if analytics later show new users bounce
  without understanding the scoring.
- Could be a **two-panel** modal (rules → start) rather than one long scroll.

---

## Direction D — Minimal (a toast / one-liner, not a modal)

If the appetite is "acknowledge the gap without a full modal": a dismissible
banner on the home screen for first-visit only.

> **New here?** Start with **Daily Fritz** or a **Daily Puzzle** above — your
> streak begins today. Everything else is in the tabs. `[ ✕ ]`

Notes:
- Cheapest to build (no dialog, no backdrop, no focus-trap).
- Doesn't surface Journey or explain the tabs.
- Reuses the `hasSeenWelcome` flag that already exists.

---

## Comparison

| | A — Mode picker | B — Start with today | C — 30s + pick | D — Minimal banner |
|---|---|---|---|---|
| Orients to **all** modes | ✅ full | ⚠️ one sentence | ⚠️ 3 groups | ❌ |
| Teaches the **game** | ❌ | ❌ | ✅ | ❌ |
| Surfaces **Journey** (no home entry today) | ✅ | ✅ (named) | ✅ (named) | ❌ |
| Cognitive load | high | low | medium-high | minimal |
| Build cost | modal + grid layout | modal, simple | modal, 2-panel | banner only |
| Matches current home voice ("One daily tradition") | partial | ✅ strong | partial | ✅ |
| Best if… | modes are genuinely the value and discovery is the problem | the daily habit is the retention lever | new users don't get the scoring | you want to close the gap this week |

**One opinion, not a decision:** **B** fits the product as it stands — the home
screen already frames Racehorse as a daily ritual, and B reinforces that with two
one-click CTAs while still naming the other modes. If discovery of the deeper
modes (Journey especially) is the real concern, **A**. **C** only if there's
evidence new players don't understand the scoring. **D** as a stopgap.

## Open items for whichever direction wins

- **Journey has no home-screen entry at all** — a welcome modal can name it, but
  that's a workaround. Worth its own small task (a card or a Learn/Single-Player
  entry) regardless.
- Rebuild as `<Modal>` primitive (the 2026 markup is inline-styled, pre-token).
- Trigger stays `hasSeenWelcome` in `localStorage` (already wired in `useAppSessionUi`).
- Decide: dismiss-writes-flag only, or also a "don't show again" checkbox.
