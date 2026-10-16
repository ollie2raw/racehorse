# Game engine invariants & property-based correctness

Base `origin/feat/app-store-candidate` `60a1963e`; branch `audit/game-engine-invariants`. No dependency added (the repo has no
property-testing library): generation is seeded (`createDeterministicRandom`) so every case is reproducible by string seed.

## Method
`packages/game-core/src/__tests__/support/engineOracle.ts` is an independent reference model of the rules (board topology, hub
crossing, arm tips, scoring, forced-draw chain, pass/block, go-out and blocked-hand bonuses, game winner, next starter). It shares no
code with `engine.ts`/`scoring.ts`/`openEndsGeometry.ts`. `engineHarness.ts` lets the ORACLE choose the action (so legality is not
derived from the engine), the ENGINE execute it on a deep-frozen input state, and after EVERY transition compares the two
(tile conservation, hands, boneyard order, dead-tail, board tile set, open-end ports, mainline adjacency, legal plays, pass/draw
legality, turn, passes, scores, hand/game status, winner, starters) plus `collectGameStateViolations`, score monotonicity, sequence
advance, "points awarded == oracle award" and non-mutation of the input. Eight variants (2p default/short/long, noScore blocked rule,
no end bonus, 14 tiles/no dead tiles, 3p, 4p) x five policies (random, score-greedy, doubles, branch, low-score); the opening tile is
randomly submitted in either orientation.

## Suites
* `engineInvariants.property.test.ts` - generated games (default 4/cell; `ENGINE_PROPERTY_GAMES`, `ENGINE_PROPERTY_SEED`).
* `engineInvariants.replay.test.ts` - transcript replay through the command path, JSON round trip at every step, determinism
  (Math.random/Date.now forbidden after the deal), invalid-action non-mutation, terminal-state rules, the "relevant pips already
  known" forced-draw case, oracle self-check.
* `engineRegressions.test.ts` - E1 reproducer.
* `server/src/game/serverEngineOracleParity.test.ts` - the authoritative multiplayer path (`startGame`/`act`/`nextHand`, aggregated
  forced draws, mandatory auto-passes) vs the same oracle.
* `client/src/game/openEndsOracleParity.test.ts` - the client's own copy of the open-ends geometry vs the oracle.

## Finding
E1: `resolveBlockedHand` under `blockedHandRule: 'noScore'` ended the hand without advancing `state.sequence` (the `lowestPips` branch
does). Clients order state updates by sequence, so the hand-over update was indistinguishable from the previous one. Fixed
(`sequence + 1`); reproducer in `engineRegressions.test.ts`.

## Mutation sanity
Three deliberately broken engines (doubles lose the extra turn, open double counted once, a dead tile made drawable) are each caught by
the first generated game.
