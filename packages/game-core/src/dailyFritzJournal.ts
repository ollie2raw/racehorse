import type { DailyFritzTranscriptAction } from './dailyFritzTranscript';

/**
 * An official Daily Fritz action, recorded at the moment the engine accepted
 * the command that produced it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Daily Fritz verification evidence used to be *reconstructed* from the UI
 * move log — an array appended by React effects across animation timers, run
 * tokens and checkpoint restores. That reconstruction can never be exactly
 * right, for two independent reasons:
 *
 *  1. The engine deliberately hides steps. `applyMove` resolves an entire
 *     forced-draw chain inside a single 'play' command, and can recurse into
 *     an unlogged embedded pass. No MoveEntry is ever produced for those.
 *  2. The presentation layer can miss or repeat an observation — a cancelled
 *     local run, a remounted effect, or a checkpoint written between the
 *     engine commit and the append. The engine state still advanced.
 *
 * Every compensating heuristic for (1) and (2) — blocked-hand pass "sealing",
 * inferred mandatory draws, draw-count capping — closed one divergence and
 * opened the next, producing a run of distinct unrecoverable verifier
 * rejections that stranded real players on the Hand Over screen.
 *
 * The journal removes the reconstruction step entirely. It is appended inside
 * the same state transition that applies the command, so it is carried BY the
 * state it describes: any match state you hold contains exactly the actions
 * that produced it. A cancelled or duplicated effect discards or duplicates
 * the state and its journal together, and can no longer desynchronise them.
 *
 * Granularity is deliberately the *command* — the same granularity the server
 * verifier replays. Steps the engine resolves internally (chain draws, the
 * embedded pass) are NOT recorded here, because the verifier's own engine
 * reproduces them when it replays the command that absorbed them.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Distributive so the play/draw-pass union members stay discriminated. */
export type DailyFritzJournalAction = DistributiveOmit<DailyFritzTranscriptAction, 'sequence'>;

/** Command payload accepted by appendDailyFritzJournalAction (no actor/digest). */
export type DailyFritzJournalActionInput = DistributiveOmit<
  DailyFritzJournalAction,
  'actor' | 'preStateDigest'
>;

export type DailyFritzJournal = {
  /** The hand these actions belong to (1-based, matching GameState.handNumber). */
  handNumber: number;
  actions: DailyFritzJournalAction[];
};

export function createDailyFritzJournal(handNumber: number): DailyFritzJournal {
  return { handNumber, actions: [] };
}

/**
 * Append one accepted command to the journal.
 *
 * A journal from a previous hand is replaced rather than extended: hands are
 * verified independently, and a stale journal must never leak across a hand
 * boundary.
 */
export function appendDailyFritzJournalAction(
  journal: DailyFritzJournal | null | undefined,
  handNumber: number,
  action: DailyFritzJournalAction,
): DailyFritzJournal {
  const base = journal && journal.handNumber === handNumber
    ? journal
    : createDailyFritzJournal(handNumber);
  return { handNumber, actions: [...base.actions, action] };
}

/**
 * Project the journal into transcript actions, assigning the contiguous
 * sequence numbers the transcript schema requires.
 */
export function toDailyFritzTranscriptActions(
  journal: DailyFritzJournal | null | undefined,
  handNumber: number,
): DailyFritzTranscriptAction[] | null {
  if (!journal || journal.handNumber !== handNumber) return null;
  return journal.actions.map((action, sequence) => ({ ...action, sequence }));
}
