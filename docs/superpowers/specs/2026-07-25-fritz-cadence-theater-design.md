# Fritz Cadence Theater

**Date:** 2026-07-25
**Status:** Approved design — awaiting written-spec review before implementation plan
**Anchor:** Play vs Fritz matte/neon panel system; Daily Fritz brass emphasis, Play vs Fritz shares the same bot-turn spine
**Approach:** Option C — full tabletop theater (approved over timing-only polish and readable-chain-only)

## Problem

Fritz acts too fast to follow. Two distinct causes, both real:

1. **Timing was collapsing.** The think beat lived on an effect-scoped `setTimeout`, so React effect remounts cleared it and Fritz acted near-instantly. Fixed in `891852e` by claiming the turn in-flight and awaiting beats inside that lock.
2. **Board plays are not presented.** Drawn tiles fly (and that reads well — user calls it "a nice touch"), but board plays just appear. When Fritz chains scoring plays, tiles stack with no watchable beat and the player loses the thread of what happened.

Constant-tuning alone cannot fix (2). Regular gameplay also reads as "kinda boring" — the fix is presentation, not only delay length.

## Goal

Fritz should feel like a careful human opponent across the table. Every action is presented, then settles, then the next begins. The player can always narrate what just happened — especially through a multi-tile scoring chain.

## Scope

Shared Fritz bot-turn system, so both surfaces benefit from one change:

- Daily Fritz (brass identity)
- Play vs Fritz (same system, different skin)

Presentation and timing only.

## Non-goals

- Fritz policy / `fritzPolicy.ts` decision logic
- Server verifier, transcripts, deal authority, run fingerprint
- Scoring math, draw/pass rules, move validation
- Multiplayer, tournament, Learn, Daily Puzzle / Ladder pacing
- Board layout redesign or new match chrome architecture
- Bot difficulty or heuristic budgets

## Section 1 — Cadence philosophy (approved)

Variable beats, not one flat delay. Opening reads are longer than chain continues; digging through the boneyard gets its own beat.

| Moment | Feel | Rough target |
|---|---|---|
| Your tile lands → Fritz turn begins | Settle the player's move first | ~0.6–0.9s handoff |
| Fritz opening think (new turn) | Reading the board | ~2.5–3.2s |
| Fritz places a tile | Visible place + settle | ~0.7–1.0s motion + short settle |
| Score lands | Callout you cannot miss | ~1.2–1.6s held |
| Chain continue (score / double) | Shorter think, still readable | ~1.6–2.0s between tiles |
| Forced draw start | "Has to dig" beat | ~2.0–2.5s |
| Each drawn tile | Keep the fly that already works | ~1.6–1.9s |
| Post-draw before play | Breath, then commit | ~1.0–1.3s |
| Multi-score chain HUD | Running turn total, live | through the whole chain |
| Hand ends | Existing hand-over pause holds | keep ~2s+ |

**Anti-sluggish rule:** dead air without a visible state is banned. Every wait must show why we are waiting (thinking / drawing / scored / chaining). This is what separates theater from padding, and it is the guard against Option C feeling slow over a full set.

## Section 2 — Presentation layer (approved)

### 2.1 Fritz state strip

Turn chrome cycles honest states instead of a static idle board:

- `Fritz is thinking…`
- `Fritz is drawing…` (with tile count on multi-draw)
- `Fritz scores +N` / `Chain continues`
- `Your move`

Current label logic is a single ternary (`selectTurnLabel` → `Fritz thinking` / `Your move`), so this needs a real state input from the bot-turn runtime rather than just `botTurn`.

### 2.2 Tile place theater

Every Fritz board play gets a place animation plus settle flash rather than an instant pop. Player plays get the same treatment where it is cheap and does not fight input responsiveness. Draws keep the existing flying-tile treatment.

### 2.3 Score ceremony (the core chain fix)

On any score:

- Stronger on-board callout, longer hold than the current ~1.7s/2s toast
- **Running turn total** while Fritz still holds the turn (`+5`, then cumulative `Turn 12` as he chains)
- Optional soft pulse on the score track when points land (Racehorse signature element — preserve it)

When the chain ends: one final settle ("Fritz scored 12 this turn"), then handoff.

### 2.4 Chain continuity

Between linked plays, the last tile stays highlighted until the next lands, and the score surface does not hard-reset to blank between chain steps. The thread is never lost mid-run.

### 2.5 Handoff after the player

After a player play resolves (including its score toast), a short settle beat before Fritz's thinking state begins, so the player's move is not immediately overwritten.

### 2.6 Reduced motion

Under `prefers-reduced-motion`: keep the longer readable timings and all text states; drop or simplify flourish motion.

## Section 3 — Engineering plan (approved)

### Touch points

| Concern | Files |
|---|---|
| Cadence constants | `client/src/modules/bot-turn/botTurnGuards.ts` |
| Turn tenure + beat sequencing | `client/src/modules/bot-turn/useBotTurnEffect.ts` |
| Draw / post-draw beats | `botDrawPassHandler.ts`, `drawSequence.ts`, `embeddedForcedDrawPresentation.ts` |
| Score toast / last-played flash | `client/src/modules/match/hooks/useMatchPresentation.ts` |
| Fritz state strip | `client/src/bot/view/utils/botMatchHudLabels.ts` + bot match view model |
| Place / settle motion | match board CSS (`walnut-live.css` fly duration already aligned to `BOT_FLY_TILE_MS`; add place keyframes) |
| Running turn total | small view-model helper keyed off bot turn ownership (`computeBotChainPaused` already identifies chain continuation) |

Timing constants stay centralized in `botTurnGuards.ts` so CSS durations and JS waits cannot drift — `BOT_FLY_TILE_MS` ↔ `walnut-live.css` is the existing precedent and the new place beat must follow it.

### Rollout order

1. Cadence constants + variable beats (opening vs chain vs draw), tenure lock preserved
2. State strip + score ceremony + running turn total
3. Board place animation matched to the place/settle timings
4. Player → Fritz handoff settle
5. Playtest one Daily Fritz hand and one Play vs Fritz hand; tune numbers only

Each step is independently shippable and independently revertible.

### Risks

| Risk | Mitigation |
|---|---|
| Long Fritz chains make hands feel long | Chain thinks are shorter than opening thinks; no silent waits |
| Place animation desyncs from state apply | Pick one order (apply-then-present or present-then-commit) and test it; do not mix per call site |
| Competing toast/HUD surfaces during a chain | One primary score surface during a chain, not three banners |
| Constant drift between CSS and JS | Keep durations in `botTurnGuards.ts`, assert alignment in `botTurnGuards.test.ts` |
| Effect remount regressions | Preserve the in-flight tenure claim from `891852e`; do not reintroduce clearable outer timers |

### Success criteria

- A 3–4 tile Fritz scoring chain can be narrated without rewinding
- Draws still feel fun (do not regress the one thing that already works)
- Match reads premium and human, not sluggish empty waiting
- Both Daily Fritz and Play vs Fritz improve from the same change
- No change to verified transcripts, scoring, or policy behavior
