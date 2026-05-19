---
name: racehorse-ui-fidelity
description: Use when refining Racehorse Dominoes UI. Always read docs/agent-skills/racehorse-design-source-of-truth.md first; Play vs Fritz matte/neon panels are canonical. Then align to homepage/target references as needed.
---

# Racehorse UI Fidelity Skill

Before doing any UI work, read (in order):

1. `docs/agent-skills/racehorse-design-source-of-truth.md` — **global identity law**; overrides legacy class names, old screenshots, and walnut-era references.
2. This skill file.

The Play vs Fritz matte/neon panel system is the canonical design source of truth. Walnut is deprecated as a visual direction; legacy filenames like `walnut-live.css` are implementation artifacts only.

## Purpose

Use this skill for Racehorse visual/UI refinement tasks.

The goal is not to invent a new design direction. The goal is to make the current screen more faithful to:
1. the Play vs Fritz matte/neon panel system (primary),
2. the locked Racehorse homepage identity where it aligns with that system, and
3. any supplied target/reference screenshot for that specific screen.

## Brand anchor

The Racehorse homepage remains a platform identity anchor, but **visual execution** should match the Play vs Fritz matte/neon panel treatment (see `docs/agent-skills/racehorse-design-source-of-truth.md`). Homepage-level themes include:
- deep midnight navy / blue-black background
- premium dark glass cards
- thin blue/brass borders
- electric blue/cyan accents
- restrained brass/warm gold emphasis
- warm ivory typography
- realistic ivory domino tiles
- clean premium web-game feel
- modern editorial hierarchy
- subtle geometric background linework
- controlled glow and depth
- matte solid surfaces with crisp borders and subtle shadows (not gradient fills)

Avoid:
- gradients across the app (they feel less premium and less aligned with Play vs Fritz—prefer matte solids, crisp borders, subtle shadows, restrained accents)
- casino styling
- fantasy styling
- western/racetrack cliché styling
- generic SaaS dashboards
- childish mobile-game UI
- brown table/casino felt identity
- neon overload
- unrelated sci-fi skins

## Required workflow

Before editing:
1. Read `docs/agent-skills/racehorse-design-source-of-truth.md`.
2. Read AGENTS.md (especially the Racehorse Design Source of Truth section).
3. Read the relevant screen/component/CSS files.
4. Identify the smallest responsible set of files.
5. Compare current UI vs Play vs Fritz / homepage identity and/or target screenshot by region.
6. Write a visual gap analysis.
7. Propose a scoped implementation plan.
8. Wait for approval unless the user explicitly says to proceed.

When implementing:
1. Preserve gameplay logic and data flow.
2. Prefer CSS/presentational changes.
3. Do not rewrite working game systems.
4. Do not opportunistically refactor.
5. Improve fidelity in focused passes.
6. Avoid mixing multiple design systems.

For in-game board work, compare by these regions:
1. global/top bar
2. match HUD/player cards
3. center turn badge
4. race score track
5. main board arena
6. hand tray/domino row
7. bottom action dock
8. typography, spacing, glow, depth

After editing:
1. Run the relevant build command.
2. Report files changed.
3. Report what changed.
4. Report build/test result.
5. Report remaining visual gaps vs target.

## Pass structure for big redesigns

Use one pass at a time:

- Pass 1: layout, structure, proportions
- Pass 2: board/card/frame depth and visual system alignment
- Pass 3: HUD, score track, iconography, controls
- Pass 4: final polish, typography, shadows, glows, spacing

Never do all passes at once unless explicitly requested.
