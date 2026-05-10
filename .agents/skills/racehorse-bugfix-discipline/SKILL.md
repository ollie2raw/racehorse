---
name: racehorse-bugfix-discipline
description: Use when fixing Racehorse bugs, TypeScript/build errors, regressions, runtime issues, or broken gameplay behavior with minimal safe changes.
---

# Racehorse Bugfix Discipline Skill

## Purpose

Use this skill for bug fixes and build/test failures.

The goal is to fix the specific issue with the smallest safe change, not to redesign, refactor, or improve unrelated code.

## Core rules

- Do not redesign UI during bugfix tasks.
- Do not opportunistically refactor.
- Do not rewrite working systems.
- Do not change unrelated files.
- Preserve existing behavior unless the bug requires changing it.
- Prefer small, local, reversible edits.
- Read before editing.
- Verify after editing.

## Required workflow

Before editing:
1. Read AGENTS.md.
2. Identify the exact error, failing behavior, or regression.
3. Locate the smallest responsible file or files.
4. Inspect the relevant code before changing anything.
5. Explain the likely root cause.
6. Propose the smallest fix.
7. Wait for approval unless the user explicitly says to proceed.

When implementing:
1. Change only the responsible code.
2. Avoid broad rewrites.
3. Avoid style/design changes unless the bug is visual.
4. Do not touch gameplay systems unrelated to the bug.
5. Do not modify database/API/data model behavior unless the bug requires it.
6. Preserve existing props, state flow, callbacks, and public interfaces where possible.

After editing:
1. Run the relevant failing command again.
2. If fixing build errors, run the build.
3. If fixing client code, run: npm run build --prefix client
4. If fixing server code, run: npm run build --prefix server
5. If new errors appear, fix only errors directly caused by the change or required to complete the requested fix.

## High-risk systems

Be especially careful with:
- scoring logic
- draw/pass flow
- move validation
- bot match state
- multiplayer room state
- rematch flow
- Daily Fritz attempts/results
- Daily Puzzle scoring/submissions
- Supabase reads/writes
- guided Learn replay/capture logic

For these systems:
- explain what will be changed before changing it
- avoid touching adjacent logic unless necessary
- preserve existing tests and smoke behavior

## Final response format

Every bugfix task should end with:
- exact issue fixed
- root cause
- files changed
- what changed
- build/test result
- remaining risks
