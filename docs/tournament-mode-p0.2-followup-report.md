# Tournament Mode P0.2 Follow-Up Report

**Date:** 2026-06-01  
**Scope:** Three targeted fixes — hand-rack spacing parity, human-centered bracket completion display, distinct Fritz bot labels. No tournament runtime, scoring, attach flow, or server simulation changes.

---

## A. Hand-rack spacing parity

### Root cause

Tournament and private multiplayer both use `LiveMatchScreen` → `MatchLiveLayout` → `rh-live-hand-deck`, but two issues made the rack look tighter than other live matches:

1. **Missing `hand-row` structure** — `HandView` rendered tiles as direct children of `.hand-container` without `.has-single-row` / `.hand-row`. Live-match CSS applies `gap: clamp(10px, 1.3vw, 22px)` on `.hand-row`, so tiles did not get row gap spacing (BotMatchScreen and the design system use the row wrapper).

2. **Compressed hand-deck height** — `board-hand-dock.css` applied `flex: 0 0 142px` (116px on short viewports) to `.bot-match-screen .rh-live-hand-deck`. Live match screens use both `bot-match-screen` and `rh-match-live`, so tournament/multiplayer inherited the bot-only height cap and squeezed the dock.

### Fix

- `LiveMatchScreen.tsx` — single-row hands now use `hand-container has-single-row` + `hand-row` (same as Fritz/bot live layout).
- `board-hand-dock.css` — height cap scoped to `:not(.rh-match-live)` so private MP and tournament use `board-shell.css` `flex: 0 0 auto` for the hand deck.

### Acceptance

Tournament hand rack should match private multiplayer spacing (row gap + unconstrained dock height). Other `rh-match-live` screens benefit equally; legacy bot-only routes unchanged.

---

## B. Bracket progression display gating

### Problem

Server may persist bot-only quarterfinal results at bracket lock. P0.1 only hid **round > 1** completions during `bracket_lobby`. Other **round 1** bot-vs-bot matches still showed as completed before the human played.

### How gating works now

`computeBracketRevealThroughRound(matches, youUserId)`:

| Human state | Display behavior |
|-------------|------------------|
| No completed human match | Hide completed styling on matches the human is not in (`revealThroughRound = 0`). During `bracket_lobby`, also hide non-human completions. |
| Won last completed match at round R | Reveal completed styling for other matches with `round ≤ R` only. |
| Lost last completed match | `revealAll` — show full resolved bracket (eliminated). |
| No `youUserId` (spectator) | Show all completions from data. |

Human’s own matches always reflect true completed state when data says complete.

`isBracketMatchCompletedForDisplay(match, ctx)` takes `BracketDisplayContext`: `{ isBracketLobby, youUserId, matches }`.

Server simulation and match resolution are unchanged; this is display-only.

### Acceptance

- At bracket lock / before human QF: other QF bot matches do not appear completed.
- After human completes QF: other QF results may appear; SF/Final bot results stay pending until human completes that stage (or is eliminated).

---

## C. Distinct Fritz naming

### Assignment

Bot IDs are already stable: `bot:fritz:{tournamentId}:{n}` (see `server/src/scheduledTournament/engine.ts`).

Client `tournamentBotDisplayIndex()` parses `n` from the ID. `botDisplayNameFromTier(tier, n)` produces:

- Round 1 (standard): `Fritz 1`, `Fritz 2`, …
- Round 2 (elite): `Elite Fritz 1`, …
- Round 3 (master): `Master Fritz 1`, …

`resolveTournamentPlayerName` / `registrationNameFor` use the index for all bracket, lobby, and opponent labels. Generic username `"Fritz"` on registrations is ignored when the ID is a bot token.

No participant identity or match resolution changes.

---

## Files changed

| File | Change |
|------|--------|
| `client/src/match/LiveMatchScreen.tsx` | Hand row wrapper for spacing parity |
| `client/src/styles/board/board-hand-dock.css` | Exclude `rh-match-live` from bot-only 142px hand-deck cap |
| `client/src/tournament/tournamentBracketDisplay.ts` | Human progression reveal gate + updated API |
| `client/src/tournament/tournamentBracketDisplay.behaviorTests.ts` | Tests for lobby, QF gate, elimination reveal-all |
| `client/src/tournament/TournamentBracketScreen.tsx` | Pass `bracketDisplay` context to `MatchCard` / champion |
| `client/src/tournament/displayNames.ts` | `tournamentBotDisplayIndex`, numbered Fritz labels |
| `client/src/tournament/displayNames.behaviorTests.ts` | Naming stability tests |

---

## Build / test results

```text
npm run build --prefix client   # OK
npm run build --prefix server   # OK
npm test --prefix server -- tournament scheduledTournament registerRoomSessionHandlers.tournament tournamentCompletion tournamentExit
# 19 files, 103 tests passed

npx ts-node --esm src/tournament/tournamentBracketDisplay.behaviorTests.ts  # ok
npx ts-node --esm src/tournament/displayNames.behaviorTests.ts              # ok
```

---

## Manual QA checklist

- [ ] Enter tournament with mostly bots; bracket at lock — other QFs not shown completed
- [ ] Play human quarterfinal to completion — other QF bot results appear
- [ ] SF/Final bot-only results stay pending until you finish that round (or after elimination, full bracket shows)
- [ ] Tournament live match hand tile gap matches private multiplayer
- [ ] Bracket shows `Fritz 1`, `Fritz 2`, etc. (tier prefix when round advances)
- [ ] P0 runtime unchanged: game-over at win target, attach, bot sim timing after `scheduled_start`

---

## Deferred (P1 bracket polish)

- Waiting-room / bracket visual pass items from `docs/tournament-waiting-room-p1-ux-report.md`
- Flow stepper phase transitions when leaving waiting room
- Optional server-side `display_name` on bot registrations (not required; client index from ID is sufficient)

---

## Related docs

- `docs/tournament-mode-runtime-stabilization-report.md` (P0 runtime)
- `docs/tournament-mode-p0-manual-qa-report.md` (P0.1 lobby future-round guard)
- `docs/tournament-waiting-room-p1-ux-report.md` (waiting room UX)
