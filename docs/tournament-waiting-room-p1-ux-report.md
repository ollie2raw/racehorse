# Tournament Waiting Room P1 UX Report

**Date:** 2026-06-01  
**Scope:** Client-only waiting-room UX, layout, copy, and CSS. No tournament runtime, registration, bracket generation, bot-fill timing, match attach, or server changes.

---

## Files changed

| File | Change |
|------|--------|
| `client/src/tournament/TournamentBracketScreen.tsx` | `WaitingRoomPanel` redesign: event command strip, flow stepper, registered field roster with badges, projected/bracket preview, toolbar copy |
| `client/src/tournament/tournamentBracket.css` | Waiting-room visual system: command strip hierarchy, flow stepper, roster badges, preview cards, responsive tweaks, removed fill-bar gradient |

---

## Before / after UX summary

### Before

- Static two-column hero (countdown + fill) with modest typography and thin progress bar
- “Players in Lobby” list with minimal seat styling and a single “YOU” tag
- Dashed placeholder bracket grid labeled “Bracket Preview”
- No tournament flow guidance
- Overall feel closer to an admin/status page than a live competitive lobby

### After

- **Event command strip:** Primary countdown card (“Registration closes in”, large timer, lock/start copy) paired with “Field filling” card (player count, thicker progress bar, contextual subtext for open seats vs field locked vs bot fill at lock)
- **Flow stepper:** “What happens next” strip (Register → Bracket locks → Round 1 → Semifinal → Final) with current step highlighted during waiting room
- **Registered field:** Full `max_players` roster with seat numbers, Open seat rows, Your seat / Bot / In badges, stronger current-user row treatment
- **Projected bracket:** Four quarterfinal matchup cards before pairings; “Projected bracket” + pairing subtitle; when QF matches exist, shows names or “Open · Bot fill” without implying future rounds are complete
- **Toolbar:** Kicker “Waiting room”, title “Tournament Lobby”, subline with field size and win target
- **Visual polish:** Matte navy/gold panels, restrained borders, no loud gradients on progress fill, improved spacing and readable type sizes, internal scroll on long rosters

---

## Logic intentionally not changed

- Tournament registration / withdraw handlers and API calls
- Countdown source (`countdownAt`, `countdownKind`, `registration_close_at`) and 1s tick
- `isWaitingRoom` detection (`registered` phase or `registration_open` with zero matches)
- Bracket generation, bot-fill timing, scheduled start dispatch (server)
- Main bracket view `MatchCard` + `isBracketLobby` + `isBracketMatchCompletedForDisplay` (P0.1 display guard)
- Live match attach, game-over overlay, `winTarget` from config, tournament postgame deferral
- Bracket polling interval (20s)
- `buildWaitingFieldRows` uses existing `activeEntrants` + seed ordering only for display

---

## Build result

```text
npm run build --prefix client
```

**Result:** Success (`tsc -b && vite build`, exit 0).

Server build not run (no server changes).

---

## Manual QA checklist

Use a tournament in registration with partial fill (e.g. 1/8 players).

- [ ] Waiting room feels premium: countdown dominates, gold/navy identity, no casino green or loud gradients
- [ ] Countdown card shows “Registration closes in”, large timer, “Bracket locks at close · Tournament starts [time] PT”
- [ ] Field filling shows `N / max` players, progress bar fills proportionally
- [ ] With open seats: subtext mentions seats open and Fritz bots at lock
- [ ] When full: subtext reads “Field locked”
- [ ] Registered field lists all seats; open rows dashed; your row highlighted with “Your seat”
- [ ] Bot registrants show “Bot” badge when present in lobby data
- [ ] Projected bracket shows four QF cards with “Open · Bot fill” before pairings exist
- [ ] After pairings exist (if visible in waiting state): names appear; no SF/Final completed styling in waiting room
- [ ] Flow stepper visible; “Register” step current in waiting room
- [ ] Withdraw still works when provided
- [ ] Back navigation unchanged
- [ ] Page scrolls internally on short laptop viewport; no awkward body overflow
- [ ] Bracket lobby / live match / game-over at 30 unchanged (smoke after any tournament start)

---

## Deferred P2 polish

- Animate flow stepper current step on phase transitions (bracket lock → R1)
- Subtle CSS-only pulse on countdown final minute (optional, accessibility-reviewed)
- Richer bot tier labels in roster when server exposes tier on registration
- Dedicated empty-state illustration for 0/8 vs 1/8 without changing layout structure
- Consolidate waiting-room vs bracket-lobby countdown card components for DRY (cosmetic only)

---

## Related docs

- `docs/tournament-mode-runtime-stabilization-report.md` (P0 runtime)
- `docs/tournament-mode-p0-manual-qa-report.md` (P0.1 bracket display guard)
- `docs/agent-skills/racehorse-design-source-of-truth.md` (visual identity)
