import { z } from 'zod';
import { PUZZLE_RUSH_CONFIG } from '../puzzleRush/config';
import { RECORD_MATCH_MODES, RECORD_MATCH_OPPONENT_TYPES } from '../stats/recordUserMatch';

/**
 * Strict descriptions of the bodies the client actually sends (roadmap 3.3). They run in shadow mode first (http/validation.ts): the
 * handlers keep their own tolerant parsing, and these say what a well-formed request looks like, so the log shows how often real traffic
 * differs from it before anything is rejected.
 *
 * Bounds mirror what the server already enforces or what the client can legitimately produce; they are not new product rules.
 */

const nonNegativeNumber = z.number().finite().min(0);
const idString = z.string().min(1).max(64);

// ── Puzzle Rush ─────────────────────────────────────────────────────────────

/** A submitted line is a handful of moves; the cap keeps a hostile body from making the replay do unbounded work. */
const MAX_SUBMITTED_LINE_MOVES = 64;

export const puzzleRushReportBody = z.strictObject({
  runId: idString,
  puzzleId: idString,
  ordinal: z.number().int().min(1).max(PUZZLE_RUSH_CONFIG.run.puzzlesPerRun),
  clientRawScore: nonNegativeNumber,
  submittedLine: z.array(z.record(z.string(), z.unknown())).max(MAX_SUBMITTED_LINE_MOVES),
  // observational telemetry; an unknown key is rejected by the route's own isPuzzleRushStageKey, so any short string is described here
  stageReachedKey: z.string().min(1).max(32).optional(),
});

export const puzzleRushCompleteBody = z.strictObject({
  runId: idString,
  clientReportedScore: nonNegativeNumber,
});

// ── Stats: record a finished match ──────────────────────────────────────────

/** recordUserMatch caps a score at 200 and the metadata at 8 KiB serialized, and silently turns anything else into null. */
const MAX_SCORE = 200;
const MAX_METADATA_JSON_BYTES = 8_192;
const optionalUserId = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();
const optionalScore = z.number().int().min(0).max(MAX_SCORE).nullable().optional();

export const recordMatchBody = z.strictObject({
  mode: z.enum(RECORD_MATCH_MODES),
  opponentType: z.enum(RECORD_MATCH_OPPONENT_TYPES),
  winnerUserId: optionalUserId,
  loserUserId: optionalUserId,
  winnerScore: optionalScore,
  loserScore: optionalScore,
  moveCount: z.number().int().min(0).nullable().optional(),
  roomCode: z.string().max(32).nullable().optional(),
  metadata: z
    .record(z.string(), z.unknown())
    .refine((value) => JSON.stringify(value).length <= MAX_METADATA_JSON_BYTES, { message: 'metadata too large' })
    .optional(),
});
