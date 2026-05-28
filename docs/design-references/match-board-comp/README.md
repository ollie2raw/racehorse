# Match board comp — Phase 1

Static HTML/CSS source of truth for the in-game Fritz / Daily Fritz board (**boardmock1** layout + product **region C** peg track).

## Open locally

From repo root:

```bash
open docs/design-references/match-board-comp/index.html
```

Or serve (optional, for consistent font loading):

```bash
npx --yes serve docs/design-references/match-board-comp -p 5199
# http://localhost:5199
```

## Review ritual

1. Full viewport **1440×900** (and one mobile width ~390px).
2. Enable **Overlay boardmock1** — align HUD, arena frame, meta stack, hand dock by eye.
3. Enable **Region outlines** — confirm B / C / D / E1 placement.
4. List gaps **by region** in GitHub issue or chat; max 8 bullets.
5. Say **“comp approved”** or send revision notes → only then **Phase 2** (React port).

## Files

| File | Purpose |
|------|---------|
| `index.html` | DOM contract (`data-ui` hooks match reset plan) |
| `match-board.tokens.css` | Design tokens → copy to `client/src/match/board/` in Phase 2 |
| `match-board-comp.css` | Layout + theme for comp |

## Not included (by design)

- Region **A** (app nav) — stays in app chrome
- Real `Board.tsx` / gameplay
- Region **E2** action dock (not in boardmock1)

## Gate

Phase 1 is complete when you approve this comp vs [`boardmock1.png`](../boardmock1.png).
