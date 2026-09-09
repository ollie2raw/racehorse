// Compatibility alias. The Fritz bot heuristics moved to
// `modules/fritz/botHeuristics.ts` in the `d9e82c8e` architecture refactor;
// this shim is kept because four `learn/` modules still import
// `chooseBotMove` / `evaluateMove` / `toBotVisibleState` / `BotChoice` from the
// old `../bot/botHeuristics` path (LearnScenarioScreen, feedback[.test],
// guidedMatchRecorderEngine). Not dead — do not delete without repointing them.
export * from '../modules/fritz/botHeuristics.ts';
