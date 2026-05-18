---
name: racehorse-ui-fidelity
description: Use when refining Racehorse Dominoes UI screens to match the locked homepage identity or a supplied target screenshot/reference.
---

# Racehorse UI Fidelity Skill

## Purpose

Use this skill for Racehorse visual/UI refinement tasks.

The goal is not to invent a new design direction. The goal is to make the current screen more faithful to:
1. the locked Racehorse homepage identity, and
2. any supplied target/reference screenshot for that specific screen.

## Brand anchor

The Racehorse homepage is the source of truth for platform identity:
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
1. Read AGENTS.md.
2. Read the relevant screen/component/CSS files.
3. Identify the smallest responsible set of files.
4. Compare current UI vs the homepage identity and/or target screenshot by region.
5. Write a visual gap analysis.
6. Propose a scoped implementation plan.
7. Wait for approval unless the user explicitly says to proceed.

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
