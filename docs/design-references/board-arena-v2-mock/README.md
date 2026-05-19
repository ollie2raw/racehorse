# Board Arena v2 — Design Reference Mock

Static HTML/CSS exploration for the in-game Racehorse domino board redesign.

## View locally

```bash
cd docs/design-references/board-arena-v2-mock
python3 -m http.server 8765
# Open http://localhost:8765
```

## Export PNG

```bash
npx --yes playwright screenshot \
  --viewport-size=1440,900 \
  http://localhost:8765/index.html \
  ../board-arena-v2-mock.png
```

Canonical reference images:

- **Polished review mock:** `docs/design-references/board-arena-v2-mock-reference.png`
- **HTML render capture:** `docs/design-references/board-arena-v2-mock.png` (re-capture at 1440×900 for best results)

## Design intent

- **Branching-aware arena** — sample state shows a double hub with north/south branches plus a secondary branch (5 open-end markers, 4 listed in utility panel).
- **Endpoint markers** — blue rings anchored at live branch tips, not a fixed two-end lane.
- **Open Ends module** — dynamic chips (value + compass tag) plus open sum for Racehorse scoring.
- **Zone architecture** — opponent rail, framed play arena, right utility column, bottom tray dock.

Use alongside `docs/match-board-target.md` and homepage identity (`AGENTS.md`).
