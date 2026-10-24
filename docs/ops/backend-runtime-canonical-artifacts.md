# Backend runtime canonical artifacts — 2026-10-15 (candidate pin updated 2026-10-16)

| Role | Canonical source / reviewed artifact |
|---|---|
| NEW candidate | `feat/app-store-candidate`. **Last reviewed release candidate: `4e670955326ce811161516e1806706b69f421f5b`.** Any descendant after it is limited to test/CI-contract and documentation changes (the server-suite environment fix); at deployment preflight resolve the branch HEAD, record its exact SHA, and confirm the diff from `4e670955326ce811161516e1806706b69f421f5b` to that HEAD touches no runtime source. |
| BRIDGE′ (BRIDGE Prime; the only BRIDGE to deploy) | `release/rating-cutover-bridge-prime` at **`7f5003404e6e87f06b8d4028130fb213340a77be`** |
| Historical BRIDGE (superseded; never deploy, never roll back to) | `release/rating-cutover-bridge` at `3ccd6ff8c73c5cfd0efb24dde83d62cca82f7353` |
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
