# Board Arena v2 — Design System Notes

## Problem (current board)

From live board screenshots (`client/.screenshots/live-match-landscape.png`):

- Center playfield is a large empty void with only a faint watermark.
- No tactical framing, grid, or arena identity.
- Open ends are a single corner pill (`OPEN 0`) with no branch awareness.
- HUD zones (opponent, arena, tray) feel like separate floating cards.
- Branching doubles topology is not surfaced visually.

## Architecture (v2)

| Zone | Role |
|------|------|
| Top chrome | Brand + match context (mode, hand #, race target) |
| Opponent rail | Avatar, pip/tile stats, face-down hand, turn/timer pill |
| Play arena | Framed recessed surface; chain + branches live here |
| Right utility | Race track, **Open Ends module**, boneyard, actions |
| Player command zone | Score card + tray dock with selection/play hints |

## Branching & open ends

**On-arena:** Endpoint markers (blue ring + value) attach to each **live branch tip**, not fixed left/right slots. Branch guides (thin blue stems) connect doubles to child arms. Double hubs get a subtle gold frame + `×2` badge.

**Off-arena:** Open Ends panel lists every active endpoint as a chip (`value` + compass tag L/N/S/B). Count badge (`4 active`) and **open sum** (Racehorse scoring) stay in sync with geometry.

Sample state in mock:

- Mainline: 6–5 · 5–4 · **4–4** · 4–3 · 3–1
- North arm from 4–4: 4–6 (open **6**)
- South arm from 4–4: 4–2 (open **2**)
- South arm from 5–4: 5–0 (open **0**)
- West tip: open **6** on 6–5

= **5 endpoint markers**, **4** listed in utility (east tip dimmed / blocked in sample).

## Visual language

- Matte obsidian/navy surfaces; **no** wood, felt, or 3D perspective.
- Gold: framing, Fritz/opponent, turn emphasis, open sum.
- Blue: playable endpoints, selected tile, match hints, your score.
- Ivory tiles, sharp pip contrast, restrained glow.
- Subtle grid + R watermark inside arena only.

## Production translation (later)

1. Extend `Board.tsx` layout output — endpoint markers already exist as placement zones; style as rings anchored to zone coordinates.
2. Replace `BoardOpenEndsPill` sum-only pill with utility-column **OpenEndsPanel** fed by `computeOpenEndsSum` + per-endpoint list from geometry.
3. Wrap `rh-live-board-zone` with arena frame tokens from this mock (gold inner stroke, grid surface).
4. Move race track + boneyard into right column grid in `BotMatchScreen` / shared match shell.
5. Tray dock: reuse hand row; add `match-hint` from legal moves API.

## Reference assets

- **Polished review image:** `docs/design-references/board-arena-v2-mock-reference.png`
- **Inspectable HTML/CSS:** `index.html` + `board-arena-v2-mock.css` (open locally for pixel tweaks)
