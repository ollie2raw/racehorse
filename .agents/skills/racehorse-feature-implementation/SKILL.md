---
name: racehorse-feature-implementation
description: Use when implementing or changing Racehorse product features while preserving architecture, gameplay logic, and visual identity.
---

# Racehorse Feature Implementation Skill

## Purpose

Use this skill for feature work.

Examples:
- Daily Fritz best-of-3 changes
- Daily Puzzle improvements
- leaderboard/results screens
- multiplayer features
- bot mode changes
- Ghost Mode features
- Learn/guided lesson changes
- tournament flow
- profile/rating/streak/progression features

The goal is to implement the requested product behavior cleanly without accidental redesigns, broad rewrites, or unrelated logic changes.

## Required workflow

Before editing:
1. Read AGENTS.md.
2. Restate the intended product behavior.
3. Identify the affected user flow.
4. Identify the likely files involved.
5. Read the relevant files before changing anything.
6. Identify existing state, props, data flow, storage, and API usage.
7. Identify high-risk areas.
8. Propose a scoped implementation plan.
9. Wait for approval unless the user explicitly says to proceed.

When implementing:
1. Preserve existing working behavior outside the requested feature.
2. Prefer incremental changes.
3. Keep data flow explicit and readable.
4. Do not mix unrelated UI redesign with feature logic unless requested.
5. Do not change database shape, API contracts, or persistence behavior without explaining why.
6. Keep changes testable.
7. Use existing project patterns where possible.

## High-risk Racehorse systems

Be careful around:
- score calculations
- winning score logic
- race track/progress display
- Daily Fritz attempt/result persistence
- Daily Puzzle submissions/scoring
- bot match lifecycle
- forced draw / manual draw / pass flow
- multiplayer room state and reconnection
- rematch flow
- Supabase stats and ratings
- guided Learn capture/playback/frozen lesson state

For these:
- explain the existing behavior first
- explain the intended behavior second
- make minimal targeted changes
- verify with builds/tests

## UI requirements for feature work

If the feature includes UI:
- align with the locked homepage identity
- use Racehorse’s dark navy, blue/cyan, restrained brass, ivory tile system
- avoid new competing visual systems
- preserve clean premium web-game hierarchy
- use the race/scoring identity intentionally
- do not make feature screens look like generic dashboards

## Verification

After editing:
1. Run relevant build/test commands.
2. For client feature work, run: npm run build --prefix client
3. For server feature work, run: npm run build --prefix server
4. If the feature touches both, run both.
5. If existing smoke tests are relevant, mention whether they were run or not.

## Final response format

Every feature task should end with:
- intended behavior implemented
- files changed
- what changed
- build/test result
- known limitations or follow-up risks
