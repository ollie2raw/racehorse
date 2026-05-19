---
name: racehorse-design-review
description: Use when reviewing Racehorse screenshots, mockups, UI directions, or current-vs-target comparisons before coding.
---

# Racehorse Design Review Skill

Before reviewing or critiquing UI, read `docs/agent-skills/racehorse-design-source-of-truth.md`. The Play vs Fritz matte/neon panel system is canonical; walnut-era naming and old warm themes are not valid design direction.

## Purpose

Use this skill before coding when reviewing Racehorse UI.

The goal is to provide sharp product/design feedback, identify what matters most, and produce a better implementation brief before any code changes happen.

This skill is for analysis and planning, not implementation.

## Brand anchor

The Racehorse homepage remains the platform identity anchor; **evaluate execution** against the Play vs Fritz matte/neon panel system (`docs/agent-skills/racehorse-design-source-of-truth.md`). Homepage-level themes include:
- premium daily strategy-game platform
- deep midnight navy / blue-black background
- electric blue/cyan UI energy
- restrained brass/warm gold emphasis
- warm ivory typography
- premium dark glass cards
- realistic ivory domino tiles
- clean modern hierarchy
- subtle geometric linework
- controlled glow and depth

Avoid:
- casino
- fantasy
- western
- generic SaaS
- childish mobile-game styling
- unrelated sci-fi skin
- brown felt/casino table identity
- excessive neon

## Required review workflow

When reviewing a screenshot or mockup:

1. Identify the screen type.
2. State what is working.
3. State what feels off.
4. Compare against the locked Racehorse homepage identity.
5. If a target screenshot is provided, compare current vs target by region.
6. Identify the highest-leverage changes.
7. Identify what should not change.
8. Recommend a scoped implementation order.
9. Produce a copy-paste implementation prompt if requested.

## For current-vs-target comparisons

Break the review into regions:

1. overall identity match
2. top bar / brand area
3. primary content area
4. cards / panels / containers
5. board or game surface, if relevant
6. navigation / dock / controls
7. typography hierarchy
8. color and accent usage
9. spacing and density
10. polish, depth, shadows, glow

For each region, say:
- current issue
- target behavior
- recommended fix
- priority level

## Output style

Be direct and specific.

Avoid vague feedback like:
- “make it better”
- “more premium”
- “clean it up”
- “add polish”

Instead use concrete design language:
- “increase card border contrast”
- “reduce vertical dead space”
- “make the score track a stronger identity object”
- “compress the HUD row”
- “use brass only for Racehorse/scoring emphasis”
- “align this panel treatment with the homepage hero cards”

## Important rules

- Do not edit files while using this skill unless explicitly told to proceed.
- Do not suggest a full redesign if a fidelity pass is enough.
- Do not drift away from the locked homepage identity.
- Separate design critique from implementation.
- If the screen is already close, recommend small polish changes only.
- If the screen is off-direction, identify the identity mismatch clearly.

## Final response format

For design reviews, end with:

- What is working
- What is off
- Highest-priority changes
- What not to change
- Recommended next implementation prompt
