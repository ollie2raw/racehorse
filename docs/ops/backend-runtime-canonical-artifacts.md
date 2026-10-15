# Backend runtime canonical artifacts — 2026-10-15

| Role | Canonical source / reviewed artifact |
|---|---|
| NEW candidate | Current remote `feat/app-store-candidate` HEAD after the final runtime gate; resolve and record its exact SHA in deployment preflight. Validated runtime code is `cba5667564c956c1f269a492e06ad107ce3af2f3`; the final documentation-only descendant contains the gate report. |
| Corrected BRIDGE | `release/rating-cutover-bridge` at **`3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353`** |
| Production reference | `main` / `3a65ab1c37f098aa94c306c755eca8fbbc65aee2`; not changed or deployed by this gate |

Do not use candidate `74ad0fec46dc6b79c7c1689f95b16ce93b7e4a67` as the launch
artifact. Do not deploy historical BRIDGE
`e3517fb0da9644ccede64697309d7af8d9ffb8ee`: its scheduled catch-up bypassed drain
accounting. History remains available; neither branch was squashed or rewritten.

[Final gate evidence](../audits/backend-runtime-final-gate.md) covers both R1s,
full-schema migration replay, exact BRIDGE/NEW runtime tests and request budgets.
[The cutover runbook](senior-audit-rating-rush-cutover.md) is authoritative for
production sequencing. Ranked context follows ranked claim and precedes NEW;
contracts remain last. Updating Git artifacts does **not** execute a cutover.
