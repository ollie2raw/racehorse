# ADR-003: CSS Token System and wl-* Freeze

**Status:** Accepted  
**Date:** 2026-06

## Context
The codebase has two CSS naming systems: legacy `wl-*` (walnut-live) and current `rh-*` (racehorse). Both are active. 163 raw hex values were replaced with tokens in Phase 4C.

## Decision
1. `src/styles/tokens.css` is the single source of truth for design tokens
2. `wl-*` classes are **frozen** — no new `wl-*` selectors may be introduced in new CSS files (enforced by stylelint)
3. 23 legacy files are grandfathered and listed in `.stylelintrc.json`
4. New components use `rh-*` class names only
5. Migration from `wl-*` to `rh-*` is Sprint 3B — component by component with visual QA

## Consequences
- stylelint blocks `wl-*` in any file not on the grandfather list
- `walnut-live.css` will be deleted at end of Sprint 3B migration
- Token authority order: `tokens.css` → component CSS → no inline hex values
