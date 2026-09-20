# Phase F positional feature parity

| Feature group | Original / provenance | Acceptance tolerance |
|---|---|---|
| Pip denial / opponent outs | `botHeuristics.ts:estimateOpponentCanPlayProbability` matching-tile numerator; `solveHeuristicOpening.ts:computeEndDangerPenalty` | Absolute error ≤1e-9; raw unseen counts, not claimed actual opponent holdings |
| End/number control | `solveHeuristicOpening.ts:computeEndControlScore` | Absolute error ≤1e-9 |
| Hand-shape bottleneck | `solveHeuristicOpening.ts:computeTrapPenalty` playableNext/orphanTiles outputs; mobility = their difference | Exact integer equality |
| Missing-pip pressure | `solveHeuristicOpening.ts:computePressureScore` | Absolute error ≤1e-9 with identical evidence weights |
| Score-margin urgency | New feature; no original numeric equivalent | Range [-100,100]; swapping scores negates the value; action-independent |
| Tile-count/boneyard pressure | New feature; no original numeric equivalent | Range [0,100]; increasing drawable supply cannot increase pressure; action-independent |
| Double/hub-opening risk | `botHeuristics.ts:branchPenalty` + `earlyDoubleExposurePenalty` | Absolute error ≤1e-9 with identical hand, board, and hold weights |

`positionalFeatures.recordedParity.test.ts` reconstructs positions from the committed `recorded-self-play` seeds and recorded played actions. It validates actor/hand cursors and completion without rerunning either policy. Every legal action is compared; composite-best ranking agreement is not parity evidence.

Private Fritz functions are extracted from their actual source with the TypeScript parser in the test only. Production files remain unmodified. Exported Review Engine functions are reused directly; parity checks their feature inputs and outputs. This does not claim that a feature explains the internal reason for a minimax choice.

Intentional differences: the review's missing-pip weights are 4 per pass/draw and 5 per authority observation with no age decay, matching the existing review helper, not Fritz's decayed live inference. Hold weights use the existing review approximation (1 or 0.05), not Fritz's sampled posterior. Scores and supply pressure are new contextual measures, not fabricated ports.

Verification status: code prepared while F1 preflight runs; tests and counts pending. No prose UI activation or measured parity claim yet.
