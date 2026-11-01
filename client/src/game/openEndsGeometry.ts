// The open-ends geometry and scoring live in @racehorse/game-core, the one
// implementation the server replays against. This file re-exports it and keeps
// only what is client-specific: the dev-time diagnostics (they are no-ops in the
// core, which has no dev flag).
import type { BoardState } from '../types';
import { logger } from '../utils/logger';
import {
  auditOpenEndsBoard,
  computeOpenEndsSum,
  getScoringOpenEndPips,
  reconcileBoardOpenEndsMetadata,
  sanitizeBoardBranchSlots,
} from '@racehorse/game-core';

export {
  auditOpenEndsBoard,
  branchHasPlayableTiles,
  branchTipPipFromGeometry,
  computeOpenEndsSum,
  endpointPipFromOrientation,
  explainOpenEndsSum,
  findHubById,
  getScoringOpenEndPips,
  hubIdAt,
  isBranchHubCrossedGeometrically,
  isDouble,
  isHubCrossedGeometrically,
  isMainlineHubCrossedGeometrically,
  reconcileBoardOpenEndsMetadata,
  sanitizeBoardBranchSlots,
  scoreBranchArm,
} from '@racehorse/game-core';
export type { OpenEndsAuditIssue, OpenEndsContribution } from '@racehorse/game-core';

const IS_TEST = Boolean(
  (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE === 'test',
);
// Dev-only board audits — keep them out of vitest or CI logs explode (100k+ lines).
const IS_DEV =
  Boolean((import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV) && !IS_TEST;

/** Hydrate boards from snapshots, puzzles, lessons, or replay (geometry wins over stale metadata). */
export function hydrateBoardForOpenEnds(board: BoardState): BoardState {
  const sanitized = sanitizeBoardBranchSlots(board);
  const hydrated = reconcileBoardOpenEndsMetadata(sanitized);
  assertOpenEndsSumConsistent(hydrated, 'hydrateBoardForOpenEnds');
  return hydrated;
}

export function warnOpenEndsBoardIssues(board: BoardState, context = 'board'): void {
  if (!IS_DEV) return;
  const issues = auditOpenEndsBoard(board);
  if (issues.length === 0) return;
  console.warn(`[open-ends:${context}]`, issues);
}

export function assertOpenEndsSumConsistent(board: BoardState, context = 'board'): void {
  if (!IS_DEV) return;
  const sum = computeOpenEndsSum(board);
  const pipSum = getScoringOpenEndPips(board).reduce((a, b) => a + b, 0);
  if (sum !== pipSum) {
    logger.error('openEndsGeometry.ts', new Error(`[open-ends:${context}] computeOpenEndsSum=${sum} != pip breakdown ${pipSum}`));
  }
  warnOpenEndsBoardIssues(board, context);
}

export function assertDisplayedOpenCountMatchesCanonical(
  board: BoardState,
  displayedSum: number,
  context = 'ui',
): void {
  if (!IS_DEV) return;
  const canonical = computeOpenEndsSum(board);
  if (displayedSum !== canonical) {
    logger.error(
      'openEndsGeometry.ts',
      new Error(`[open-ends:${context}] displayed open count ${displayedSum} != canonical ${canonical}`),
    );
    auditOpenEndsBoard(board).forEach((issue) => {
      console.warn(`[open-ends:${context}]`, issue);
    });
  }
}
