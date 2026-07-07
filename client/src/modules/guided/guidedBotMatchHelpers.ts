/**
 * Guided/learn mode helpers for BotMatchScreen.
 *
 * These functions support the guided (V1/V2) and lesson authoring
 * modes that run within BotMatchScreen. Isolated here so the
 * BotMatchScreen module stays focused on match orchestration.
 *
 * V1 board parser note: parseGuidedBoardState handles the legacy V1
 * wire format. The V2 canonical parser is parseLessonV2BoardState in
 * lessonV2.ts — do not unify without careful V1/V2 format audit.
 */

import type { AuthoredStep, FrozenLesson } from '../../learn/guidedAuthoring.ts';
import type { LessonV2Event } from '../../learn/lessonV2.ts';
import type { BoardState, BranchArm, HubDouble, PlacedTile, Tile } from '../../types.ts';
import { hydrateBoardForOpenEnds, type BotMatchState, type BotPlayerId } from '../match/runtime/botEngine.ts';
import {
  COACHING_SUMMARY_BLOCK_RE,
  GUIDED_COACH_PREVIEW_MAX_CHARS,
  type GuidedLessonCoachContent,
} from '../match/types/matchRuntimeTypes.ts';

export function splitCoachingSummaryBlock(raw: string): { summary: string | null; body: string } {
  const match = raw.match(COACHING_SUMMARY_BLOCK_RE);
  if (!match) return { summary: null, body: raw };
  return {
    summary: match[1]?.trim() || null,
    body: match[2] ?? '',
  };
}

export function buildCoachPreviewText(bodyText: string, summary: string | null): string {
  if (summary?.trim()) return summary.trim();
  const normalized = bodyText.replace(/\n+/g, ' ').trim();
  if (normalized.length <= GUIDED_COACH_PREVIEW_MAX_CHARS) return normalized;
  const slice = normalized.slice(0, GUIDED_COACH_PREVIEW_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > GUIDED_COACH_PREVIEW_MAX_CHARS * 0.65 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

export function formatLessonTileLabel(tileKey: string | null | undefined): string | null {
  if (!tileKey) return null;
  return tileKey.replace(/\|/g, '-');
}

export function parseGuidedLessonCoachContent(
  coachingText: string,
  explicitSummary?: string | null,
): GuidedLessonCoachContent {
  const { summary: inlineSummary, body: coachingBody } = splitCoachingSummaryBlock(coachingText);
  const summary = explicitSummary?.trim() || inlineSummary;
  const normalized = coachingBody.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {
      title: 'Your decision',
      bodyParagraphs: ['Study the board, compare your options, and follow the coached line.'],
      summary,
    };
  }

  const lines = normalized.split('\n');
  const firstMeaningfulIndex = lines.findIndex((line) => line.trim().length > 0);
  const firstMeaningful = firstMeaningfulIndex >= 0 ? lines[firstMeaningfulIndex]!.trim() : '';
  const useFirstLineAsTitle =
    Boolean(firstMeaningful) &&
    firstMeaningful.length <= 72 &&
    !/^play:/i.test(firstMeaningful);

  const title = useFirstLineAsTitle ? firstMeaningful : 'Your decision';
  const bodySource = useFirstLineAsTitle
    ? lines.slice(firstMeaningfulIndex + 1).join('\n').trim()
    : normalized;
  const bodyParagraphs = bodySource
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\n/g, ' ').trim())
    .filter(Boolean);
  const safeBodyParagraphs = bodyParagraphs.length > 0 ? bodyParagraphs : [bodySource || normalized];

  return {
    title,
    bodyParagraphs: safeBodyParagraphs,
    summary,
  };
}

export function syncGuidedBoneyardCount(current: Tile[], targetCount: number): Tile[] {
  if (current.length === targetCount) return current;
  if (current.length > targetCount) return current.slice(0, targetCount);
  return [
    ...current,
    ...Array.from({ length: targetCount - current.length }, () => ({ low: 0, high: 0 })),
  ];
}

export function sameTileKeyMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of b) {
    const remaining = counts.get(key) ?? 0;
    if (remaining <= 0) return false;
    if (remaining === 1) counts.delete(key);
    else counts.set(key, remaining - 1);
  }
  return counts.size === 0;
}

export function guidedWinnerIdFromScores(playerScore: number, fritzScore: number): BotPlayerId {
  return playerScore >= fritzScore ? 'you' : 'bot';
}

export function notifyGuidedV2EventToasts(
  event: LessonV2Event,
  opponentLabel: string,
  callbacks: {
    showScoreToast: (player: 'you' | 'bot', points: number) => void;
    showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  },
): void {
  if (event.pointsScored > 0) {
    callbacks.showScoreToast(event.actor === 'player' ? 'you' : 'bot', event.pointsScored);
  }
  if (event.action === 'draw') {
    const label = event.actor === 'player' ? 'You' : opponentLabel;
    callbacks.showBoardToast(`${label} drew a tile`, 'bot');
  } else if (event.action === 'pass') {
    const label = event.actor === 'player' ? 'You' : opponentLabel;
    callbacks.showBoardToast(
      `${label} passed`,
      event.actor === 'player' ? 'you' : 'bot',
    );
  }
}

/**
 * Deserialize a serialized boardState string back to a renderable BoardState.
 * Returns null for an empty / missing board (same sentinel as BotMatchState.board).
 */
/**
 * Deserialize a board state string produced by serializeGhostBoardState().
 *
 * serializeGhostBoardState() does NOT produce a raw BoardState JSON — it uses a
 * compressed wire format where:
 *   - hubDoubles is stored under the key "hubs"
 *   - PlacedTile.tile is stored as [low, high] number arrays, not {low, high} objects
 *
 * A raw JSON.parse cast therefore produces a structurally incorrect BoardState:
 *   board.hubDoubles === undefined  → crashes getOpenEnds (board.hubDoubles.length)
 *   board.mainLine[n].tile         → is an array, not a Tile object
 *
 * This function performs the structural remapping so the returned BoardState
 * is fully compatible with botEngine / getLegalMoves / getOpenEnds.
 */
interface RawTile { low: number; high: number }
interface RawPlaced { orientation: PlacedTile['orientation']; tile: [number, number] | RawTile }
interface RawBranch { openEnd: number; openEndIsDouble: boolean; tiles: RawPlaced[] }
interface RawHub {
  hubId: number; laneType: string; laneRef: string; branchDepth: number;
  tileIndex: number; mainlineIndex: number; hubValue: number;
  leftSideFilled: boolean; rightSideFilled: boolean; isCrossed: boolean;
  branches: (RawBranch | null)[];
}
interface RawBoardState {
  mainLine: RawPlaced[];
  hubs?: RawHub[];
  hubDoubles?: RawHub[];
  leftEnd?: number;
  rightEnd?: number;
}
export function parseGuidedBoardState(boardState: string): BoardState | null {
  if (!boardState || boardState === 'board:empty') return null;
  try {
    const raw = JSON.parse(boardState) as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const board = raw as RawBoardState;

    // Remap mainLine: tile arrays [low, high] → { low, high }
    const mainLine: PlacedTile[] = (board.mainLine ?? []).map(
      (placed): PlacedTile => ({
        orientation: placed.orientation,
        tile: Array.isArray(placed.tile)
          ? { low: placed.tile[0] as number, high: placed.tile[1] as number }
          : (placed.tile as Tile),
      }),
    );

    // Remap hubs → hubDoubles; remap branch tiles the same way
    const hubDoubles: HubDouble[] = (board.hubs ?? board.hubDoubles ?? []).map(
      (hub): HubDouble => ({
        hubId:           hub.hubId,
        laneType:        hub.laneType as HubDouble['laneType'],
        laneRef:         hub.laneRef,
        branchDepth:     hub.branchDepth,
        tileIndex:       hub.tileIndex,
        mainlineIndex:   hub.mainlineIndex,
        hubValue:        hub.hubValue,
        leftSideFilled:  Boolean(hub.leftSideFilled),
        rightSideFilled: Boolean(hub.rightSideFilled),
        isCrossed:       Boolean(hub.isCrossed),
        branches: (hub.branches ?? []).map((branch): BranchArm | null =>
          branch
            ? {
                openEnd:         branch.openEnd,
                openEndIsDouble: Boolean(branch.openEndIsDouble),
                tiles: (branch.tiles ?? []).map((placed): PlacedTile => ({
                  orientation: placed.orientation,
                  tile: Array.isArray(placed.tile)
                    ? { low: placed.tile[0] as number, high: placed.tile[1] as number }
                    : (placed.tile as Tile),
                })),
              }
            : null,
        ) as BranchArm[],
      }),
    );

    // Run recomputeBoardEnds first so it fills in leftEndIsDouble, rightEndIsDouble,
    // hub isCrossed, and branch openEnd correctly from tile geometry.
    // Then override leftEnd/rightEnd with the authoritative serialized values —
    // endpointMatchFromOrientation (used inside recomputeBoardEnds) can return the
    // wrong exposed pip when tile.low coincidentally matches a pip in the adjacent
    // tile, causing legality mismatches and broken board-state round-trips.
    const base: BoardState = {
      mainLine,
      leftEnd: -1,
      rightEnd: -1,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles,
    };
    const reconciled = hydrateBoardForOpenEnds(base);
    return {
      ...reconciled,
      leftEnd: typeof board.leftEnd === 'number' ? board.leftEnd : reconciled.leftEnd,
      rightEnd: typeof board.rightEnd === 'number' ? board.rightEnd : reconciled.rightEnd,
    };
  } catch {
    return null;
  }
}

export function getGuidedV1AuthoredStepByIndex(
  lesson: FrozenLesson,
  stepIndex: number,
): AuthoredStep | null {
  if (stepIndex < 0) return null;
  return lesson.steps.find((step) => step.chosenMove !== null && step.stepIndex === stepIndex) ?? null;
}

export function getGuidedV1OrderedAuthoredSteps(lesson: FrozenLesson): AuthoredStep[] {
  return lesson.steps
    .filter((step) => step.chosenMove !== null)
    .slice()
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

export function getNextGuidedV1StepIndex(lesson: FrozenLesson, currentStepIndex: number): number | null {
  const next = getGuidedV1OrderedAuthoredSteps(lesson).find((step) => step.stepIndex > currentStepIndex);
  return next?.stepIndex ?? null;
}

export function restoreGuidedV1NextFullMatchState(
  lesson: FrozenLesson,
  currentStepIndex: number,
): { nextStepIndex: number | null; nextState: BotMatchState | null } {
  let scanStepIndex = getNextGuidedV1StepIndex(lesson, currentStepIndex);
  while (scanStepIndex != null) {
    const nextStep = getGuidedV1AuthoredStepByIndex(lesson, scanStepIndex);
    const nextState = restoreGuidedV1StepMatchState(nextStep);
    if (nextState) {
      return {
        nextStepIndex: scanStepIndex,
        nextState,
      };
    }
    scanStepIndex = getNextGuidedV1StepIndex(lesson, scanStepIndex);
  }
  return { nextStepIndex: null, nextState: null };
}

export function restoreGuidedV1StepMatchState(step: AuthoredStep | null): BotMatchState | null {
  if (!step?.matchStateJson) return null;
  try {
    return JSON.parse(step.matchStateJson) as BotMatchState;
  } catch {
    return null;
  }
}

export function parseGuidedTranscriptState(stateJson: string): BotMatchState | null {
  if (!stateJson) return null;
  try {
    return JSON.parse(stateJson) as BotMatchState;
  } catch {
    return null;
  }
}
