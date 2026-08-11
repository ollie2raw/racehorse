# Daily Fritz skunk — source of truth

Daily Fritz is a **best-of-3** daily set. Skunk rules apply on **any game (1, 2, or 3)** but only **games 1 and 2** can change set outcome mechanically.

## Definition

A **skunk** is winning a game while the **opponent’s final score is under 30** (0–29). A score of **30 or more** is never a skunk.

Implementation: `isDailyFritzSkunk(losingScore)` where `losingScore` is the defeated side’s points.

## Mechanical set impact (games 1–2 only)

Only a skunk in **game 1** or **game 2** can end the full set early by counting as **two game wins** for the skunking side:

| Scenario | Set result | Notes |
|----------|------------|--------|
| Player skunks Fritz in **game 1** | Player wins set immediately; published score **0–1** | `instantSkunk: true`; internal clinch remains 2–0 |
| Fritz skunks player in **game 1** | Fritz wins set **0–2** immediately | `instantSkunk: true` |
| Player skunks Fritz in **game 2** after winning game 1 | Player wins set **2–0** (two games played) | Two real wins; G2 skunk is metadata |
| Player skunks Fritz in **game 2** after losing game 1 (1–1) | Player wins set immediately | G2 skunk ends set at **1–1 games played** |
| Fritz skunks player in **game 2** after player won game 1 (1–1) | **Fritz wins set immediately** | G2 skunk ends set at **1–1 games played** |
| Fritz skunks player in **game 2** after Fritz won game 1 | Fritz wins set **0–2** (two games played) | Two real Fritz wins; G2 skunk is metadata |

Skunk does **not** apply after the set is already decided (e.g. no further games once a side has two wins).

## Game 3 — metadata only

A skunk in **game 3** is still detected and stored (`skunk: true`, “Decider Skunk” badges, leaderboard rank tiers) because the loser was under 30.

It has **no mechanical set impact**: the set is already going to a decider at 1–1, and the winner is determined by that single game win (set finishes **2–1**). Game 3 skunk does **not** inflate game counts or trigger `instantSkunk`.

## Leaderboard priority

Only a player who **wins the set by skunking Fritz** receives skunk priority. Every such result ranks above a normal set win regardless of point differential. Player skunks rank by earliest game (game 1, then game 2, then game 3); player skunks in the same game are ordered by total point differential. Being skunked by Fritz never grants leaderboard priority.

## Normal (non-skunk) games

Each non-skunk win counts as **one** game toward the best-of-3. First side to **two** game wins wins the set (2–0, 2–1, 0–2, or 1–2).

## Code references

| Area | File |
|------|------|
| Server rules + set assembly | `server/src/dailyFritzSkunk.ts` |
| Server tests | `server/src/dailyFritzSkunk.test.ts` |
| Client labels / overlays | `client/src/dailyFritz/skunk.ts` |

## QA checklist

- [ ] G1 player skunk → internal clinch 2–0, published score 0–1, no game 2
- [ ] G1 Fritz skunk → set 0–2, no game 2
- [ ] G1 player win, G2 Fritz skunk (player &lt; 30) → Fritz wins set immediately
- [ ] G1 Fritz win, G2 player skunk (Fritz &lt; 30) → player wins set immediately at 1–1
- [ ] G1 player win, G2 player skunk → set 2–0
- [ ] G1/G2 loser at 30+ → no skunk flag
- [ ] G3 decider skunk → skunk badge present, set 2–1, `instantSkunk: false`
