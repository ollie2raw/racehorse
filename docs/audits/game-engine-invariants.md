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
does), so the blocking pass produced a state indistinguishable by sequence from the one before it. The client watermark accepts an
equal sequence, so this was not a dropped update there; the consumers that key on strict advancement (command envelopes
`sequence === state.sequence`, change detection, durability/receipt ordering) saw no transition. Fixed with exactly one increment
(`lowestPips` unchanged); the harness asserts "the blocking pass advances the sequence by exactly 1" for both rules.

## Mutation sanity
Three deliberately broken engines (doubles lose the extra turn, open double counted once, a dead tile made drawable) are each caught by
the first generated game.

## Final review additions
* The oracle imports nothing (no production module). The harness imports the engine only as the subject under test, the repo's PRNG/shuffle
  to build decks, and `DEFAULT_CONFIG` (pinned to literals in `engineRegressions.test.ts`). Shared conventions are documented in the oracle:
  the opening tile's `low` pip is the left port, and hub ids are assigned in placement order.
* Oracle sanity: ten mutants (pass offered/accepted with a play, wrong player keeps the turn, double score, tile left in hand, wrong
  branch exposed end metadata, wrong blocked-hand winner, terminal moves offered, passes not reset, go-out bonus lost, plus the three
  earlier ones) are each caught. The branch-tip mutant was NOT caught until arm/hub metadata (`openEnd`, `openEndIsDouble`,
  `isCrossed`, `leftEndIsDouble`/`rightEndIsDouble`) was compared against the oracle.
* Opening-tile orientation is a pure mirror image (test `opening-tile orientation is a pure mirror image`): same scores, hands,
  boneyard, turn flow and sequence, mirrored legal moves, open ends and mainline order; a reversed double is the identical board.
* Daily Fritz verifier transcript normalization / omitted-draw reconstruction / Fritz policy replay are a separate subsystem pass; the
  engine's own correctness does not depend on them (they call `applyMove`/`drawOne`/`canDraw`, which this suite constrains).
