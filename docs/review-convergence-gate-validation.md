# F3a — Convergence coverage-gate validation

Provenance: selective port of `ce2a658c` onto main after #292.
Proposed thresholds (precommitted, not tuned on this run):
- existing coverage gate: `coverage >= 0.02`
- proposed convergence gate: coverage >= 0.02 AND sameTopAction AND valueDelta <= 0.26

## Exact-overlap population (locked yard, both solvers)

- Recorded self-play decisions replayed: 1212
- Client-policy snapshot replay: SKIPPED (Recorded cursor mismatch: demo-client-policy-standard-1:game0:1)
- Eligible locked-yard non-forced positions: 19
- Exact-incomplete excluded: 2
- Exact-infeasible excluded: 1
- Search-infeasible excluded: 0
- Exact-complete validation denominator: 16

Solvers: `solveExactEndgame` (ground truth) + `solveMidgameDeterminization` (deterministic). Fritz not invoked.

| metric | existing gate | convergence / newly admitted |
| --- | ---: | ---: |
| exact-complete validation positions | 16 | 16 |
| admitted | 16 | newly admitted 0 (convergence total 16) |
| exact-action errors | 3 | 0 |
| error rate | 18.75% | n/a |
| 95% CI (Wilson) | [6.59%, 43.01%] | n/a |

Mismatch breakdown (exact-action errors):
- existing admitted: same-tile/wrong-end 0, different action 3
- newly admitted: same-tile/wrong-end 0, different action 0

| gate flip | count | percent of exact-complete |
| --- | ---: | ---: |
| newly admitted | 0 | 0.00% |
| newly rejected | 0 | 0.00% |
| any flip | 0 | 0.00% |

## Projected corpus tier mix (100-game recorded evaluations)

Measurement only — production dispatch unchanged.

- Total recorded decisions: 12973
- Non-forced: 6791
- Midgame-attempted (has convergence diagnostic): 6674
- Corpus flips (non-forced): 337 (4.96%)
- Corpus newly admitted (heuristic→search): 0
- Corpus newly rejected (search→heuristic): 337

| tier | before (existing gate) | after (projected convergence) |
| --- | ---: | ---: |
| exact | 109 | 109 |
| search | 3689 | 3352 |
| heuristic | 2993 | 3330 |

## Decision rule

PASS iff newly_admitted_error_rate ≤ existing_search_error_rate on exact-complete overlap; otherwise FAIL. Inconclusive samples are FAIL.

F3 DECISION: FAIL — retain existing coverage gate

Internal classification: `INSUFFICIENT_EVIDENCE`.

No production gate, `accuracyModelVersion`, `MINIMUM_COVERAGE_FLOOR`, or calibration changed.
