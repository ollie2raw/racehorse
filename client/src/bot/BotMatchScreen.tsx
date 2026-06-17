import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  AnimatedScore,
  Board,
  BoardOpenEndsPill,
  BoneyardCountPill,
  DominoTile,
  FullscreenIcon,
  HomeIcon,
  ScoreTrackOverlay,
  RotateOverlay,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../components';
import type { BoardHandle } from '../components';
import { MatchNblBoardFrame } from '../components/MatchNblBoardFrame';
import TileRack from '../components/TileRack';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { buildPlayableTileKeys, getHandTileLegality } from '../utils/handTileLegality';
import type { AppMode, BoardState, BranchArm, HubDouble, Move, PlacedTile, PlacementPosition, Tile } from '../types';
import {
  fetchDailyPuzzleLeaderboard,
  upsertDailyPuzzleBestScore,
  type DailyPuzzleLeaderboardEntry,
} from '../dailyPuzzle/api';
import GameOverModal from '../components/GameOverModal';
import { POST_GAME_REVIEW_VISIBLE } from '../appRouteTypes';
import GameReviewer from '../analyzer/GameReviewer';
import { analyzeMoveLog, saveGameAnalysis, type GameAnalysis } from '../analyzer/moveAnalyzer';
import {
  type EngineBestMove,
  type MoveEntry,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from '../analyzer/moveLogger';
import {
  applyPlayMove,
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
  createBotMatch,
  createBotMatchWithStarter,
  createFixedBotMatch,
  createFixedBotMatchWithStarter,
  drawOne,
  endpointMatchFromOrientation,
  getMatchableOpenEnds,
  getDisplayOpenEnds,
  getLegalMoves,
  getPlacementTargetsForTile,
  isDouble,
  passTurn,
  previewPlayMove,
  hydrateBoardForOpenEnds,
  startNextBotHand,
  startNextFixedBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotHandDeal,
  type BotHandEndReason,
  type BotMatchState,
  type BotPlayerId,
} from './botEngine';
import { chooseBotMove, toBotVisibleState, type BotChoice } from './botHeuristics';
import { fairnessLog } from './fairnessLog';
import { FRITZ_TIERS, type FritzTier } from './fritzConfig';
import { FRITZ_POSTGAME_TRUST_LINE } from './fritzTrustCopy';
import { getLocalDateKey } from '../dailyPuzzle/date';
import {
  completeGhostGame,
  startGhostMatchSession,
  type GhostCompletionResult,
  type GhostMoveLogEntry,
  type GhostProfileSummary,
  type GhostResolvedMove,
} from '../ghost/api';
import {
  isSameResolvedMove,
  parseTileKey,
  resolveGhostMove,
  serializeGhostBoardState,
  toTileKey,
} from '../ghost/logic';
import { shareGhostResultCard } from '../ghost/share';
import {
  playBlockedSound,
  playDrawSound,
  playHandLoseSound,
  playHandWinSound,
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playTileSound,
  playYourTurnSound,
  queueSound,
} from '../utils/sound';
import { supabase } from '../lib/supabase';
import {
  buildDailyFritzCompletionHash,
  completeDailyFritz,
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  formatDailyFritzNextHandUserMessage,
  nextDailyFritzHand,
  DailyFritzEndOfRunError,
  type DailyFritzLeaderboardRow,
  type DailyFritzNextHandResponse,
  type DailyFritzStartResponse,
} from '../dailyFritz/api';
import { formatOrdinalPlace } from '../dailyFritz/format';
import { buildShareText } from '../dailyFritz/shareCard';
import { DailyFritzFinalResultOverlay } from '../dailyFritz/DailyFritzFinalResultOverlay';
import { PlayVsFritzResultOverlay } from './PlayVsFritzResultOverlay';
import { PostGameReviewPrompt } from '../training/pivotalReview/PostGameReviewPrompt';
import { PivotalTurnReviewCard } from '../training/pivotalReview/PivotalTurnReviewCard';
import { PivotalReviewSummary } from '../training/pivotalReview/PivotalReviewSummary';
import { isBotPostGameReviewEligible } from '../training/pivotalReview/postGameReviewPolicy';
import {
  buildPivotalReviewSession,
  savePivotalReviewSession,
  type PivotalReviewSession,
  type PivotalTurnReflection,
} from '../training/pivotalReview/pivotalReviewStorage';
import { selectPivotalTurnsFromAnalysis } from '../training/pivotalReview/pivotalTurnSelector';
import type { DailyFritzSetOverlayViewModel } from '../dailyFritz/setOverlayViewModel';
import {
  canApplyNextHand,
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  DAILY_FRITZ_HAND_REVEAL_DELAY_MS,
  emitHandLifecycleDebugLog,
  getDailyFritzWatchdogDelayMs,
  isDailyFritzAdvanceLocked,
  isDailyFritzSetTerminal,
  logDailyFritzHandBreadcrumb,
  logHandLifecycle,
  resolveDailyFritzNextHandCache,
  resolveHandRevealScheduleMode,
  shouldAllowBotAction,
  shouldApplyBotActionResult,
  shouldDailyFritzWatchdogAdvance,
  shouldShowHandRevealForHand,
  warnHandLifecycleStuck,
  type HandLifecyclePhase,
} from './handLifecycle';
import '../match/match-live.css';
import './PlayVsFritz.css';
import '../styles/shared-ui.css';
import '../learn/learn.css';
import { useLearningCoach } from '../learning/useLearningCoach';
import CoachPanel from '../learning/CoachPanel';
import LearningHandRecap from '../learning/LearningHandRecap';
import AuthoringCoachPanel from '../learn/AuthoringCoachPanel';
import LeaveGameModal from '../components/LeaveGameModal';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import HandOverModal from '../components/handOver/HandOverModal';
import {
  buildBotHandOverReveals,
  buildHandOverReasonCopy,
  buildNextHandDealingHint,
  loserDisplayLabel,
  resolveWinnerSide,
  winnerDisplayLabel,
} from '../components/handOver/handOverCopy';
import { logLayoutDebug } from '../match/layoutDebug';
import {
  MatchLiveLayout,
  InGameOverlayStack,
} from '../match/board';
import {
  AUTHORING_GAME_ID,
  AUTHORING_LESSON_ID,
  generateAuthoringHandDeal,
  loadAuthoringSession,
  saveAuthoringSession,
  loadFrozenLesson,
  loadOriginalGuidedTranscript,
  loadOriginalGuidedTranscriptDraft,
  exportFrozenLessonAudit,
  exportFrozenLessonBoardDiffs,
  buildOriginalTranscriptDraftFromFrozenLesson,
  saveOriginalGuidedTranscript,
  saveOriginalGuidedTranscriptDraft,
  clearOriginalGuidedTranscriptDraft,
  type AuthoredStep,
  type AuthoringSession,
  type FrozenLesson,
  type GuidedReplyEvent,
  type GuidedTranscript,
  type GuidedTranscriptDraft,
  type GuidedTranscriptMove,
  type GuidedTurn,
  type FrozenLessonAudit,
  type FrozenLessonBoardDiff,
} from '../learn/guidedAuthoring';
import {
  createV2Event,
  loadGuidedV2PlaybackLesson,
  loadV2AuthoringSession,
  nextPlayerEvent,
  parseLessonV2BoardState,
  initGuidedV2Playback,
  restoreGuidedV2HandStart,
  saveV2AuthoringSession,
  canStartGuidedV2Lesson,
  validateGuidedV2Lesson,
  validateGuidedV2LessonPlayback,
  type LessonV2,
  type LessonV2AuthoringSession,
  type LessonV2Event,
  type LessonV2HandStart,
} from '../learn/lessonV2';
import {
  copyGuidedMatchCandidateJson,
  createGuidedMatchCapture,
  getGuidedMatchCaptureStatus,
  recordGuidedMatchCandidateAction,
  recordGuidedMatchCandidateNextHand,
  type GuidedMatchCaptureState,
} from '../learn/guidedMatch/guidedMatchCapture';
import { upsertGuidedMatchCandidate } from '../learn/guidedMatch/guidedMatchCandidateStorage';
import { validateGuidedMatchCandidate } from '../learn/guidedMatch/guidedMatchCandidateValidation';
import { GuidedMatchFinalDebriefPanel } from '../learn/guidedMatch/GuidedMatchFinalDebriefPanel';
import { getPublicGuidedMatchFinalDebrief } from '../learn/guidedMatch/guidedMatchLessonLoader';
import {
  createPreGameDrawShellMatch,
  isPreGameDrawEligible,
} from '../match/preGameDraw/preGameDrawEligibility';
import { PreGameTileDrawBoard } from '../match/preGameDraw/PreGameTileDrawBoard';
import {
  initPreGameDraw,
  normalizePreGameDrawTile,
  toPreGameDrawTileId,
} from '../match/preGameDraw/preGameDrawLogic';
import { usePreGameDraw, type PreGameDrawCompletePayload } from '../match/preGameDraw/usePreGameDraw';
import '../match/preGameDraw/preGameDraw.css';

interface BotMatchScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  dealSize: BotDealSize;
  fritzTier?: FritzTier;
  mode?: 'bot' | 'ghost' | 'daily-fritz';
  dailyPuzzleDate?: string | null;
  userId?: string | null;
  username?: string | null;
  winningScore?: number;
  opponentName?: string;
  opponentUserId?: string | null;
  currentGlickoRating?: number | null;
  ghostProfile?: GhostProfileSummary | null;
  onGhostProfileChange?: ((summary: GhostProfileSummary | null) => void) | null;
  onProfileRefresh?: (() => Promise<void> | void) | null;
  onProfilePatch?: ((patch: { glicko_rating?: number | null }) => void) | null;
  dailyFritzPackage?: DailyFritzStartResponse | null;
  onDailyFritzComplete?: (() => void) | null;
  dailyFritzSetOverlay?: DailyFritzSetOverlayViewModel | null;
  onDailyFritzGameComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: MoveEntry[];
  }) => void) | null;
  isGuidedMode?: boolean;
  /** Admin-only: replace CoachPanel with an editable textarea on each player turn */
  isAuthoringMode?: boolean;
  /** Admin-only V2: record every action as a LessonV2Event flat timeline */
  isAuthoringV2Mode?: boolean;
  /** Player-facing V2: playback a frozen LessonV2 lesson */
  isGuidedV2Mode?: boolean;
  /** Admin-only passive capture for future Guided Match candidate authoring. */
  enableGuidedMatchCandidateCapture?: boolean;
  /** Active Racehorse Journey bot trial — launches from Journey map and returns on exit. */
  journeyTrial?: {
    nodeId: string;
    nodeTitle: string;
  } | null;
  onJourneyTrialComplete?: ((result: { won: boolean; nodeId: string }) => void) | null;
}

interface BotHandReveal {
  winner: 'you' | 'bot' | null;
  reason: 'domino' | 'blocked';
  pointsAwarded: number;
  loserPips: number;
  calcText: string;
  yourRemainingTiles: Tile[];
  botRemainingTiles: Tile[];
}

type LocalRunToken = {
  id: number;
  lifecycleVersion: number;
  kind: 'player-draw' | 'bot-turn';
};

type GuidedCoachViewModel = {
  stepIndex: number;
  totalSteps: number;
  coachingText: string;
  coachingSummary?: string;
  canBestMove: boolean;
  isOffAuthoredLine: boolean;
};

type GuidedLessonCoachContent = {
  title: string;
  bodyParagraphs: string[];
  summary: string | null;
};

const GUIDED_COACH_PREVIEW_MAX_CHARS = 600;
const GUIDED_COACH_MORE_MIN_EXTRA_CHARS = 16;

const COACHING_SUMMARY_BLOCK_RE = /^@summary\s*\r?\n([\s\S]*?)\r?\n---\r?\n/i;

function splitCoachingSummaryBlock(raw: string): { summary: string | null; body: string } {
  const match = raw.match(COACHING_SUMMARY_BLOCK_RE);
  if (!match) return { summary: null, body: raw };
  return {
    summary: match[1]?.trim() || null,
    body: match[2] ?? '',
  };
}

function buildCoachPreviewText(bodyText: string, summary: string | null): string {
  if (summary?.trim()) return summary.trim();
  const normalized = bodyText.replace(/\n+/g, ' ').trim();
  if (normalized.length <= GUIDED_COACH_PREVIEW_MAX_CHARS) return normalized;
  const slice = normalized.slice(0, GUIDED_COACH_PREVIEW_MAX_CHARS);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > GUIDED_COACH_PREVIEW_MAX_CHARS * 0.65 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

function formatLessonTileLabel(tileKey: string | null | undefined): string | null {
  if (!tileKey) return null;
  return tileKey.replace(/\|/g, '-');
}

function parseGuidedLessonCoachContent(
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

const BOT_MATCH_DEBUG_ENV =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_BOT_MATCH === 'true';
const DAILY_FRITZ_DEBUG_ENV =
  BOT_MATCH_DEBUG_ENV || import.meta.env.VITE_DEBUG_DAILY_FRITZ === 'true';

function hasDebugLocalStorageFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) === '1';
}

function shouldLogBotMatchDebug(): boolean {
  return BOT_MATCH_DEBUG_ENV || hasDebugLocalStorageFlag('BOT_DEBUG');
}

function shouldLogDailyFritzDebug(): boolean {
  return (
    DAILY_FRITZ_DEBUG_ENV ||
    hasDebugLocalStorageFlag('BOT_DEBUG') ||
    hasDebugLocalStorageFlag('DAILY_FRITZ_DEBUG') ||
    hasDebugLocalStorageFlag('DAILY_FRITZ_PROFILE')
  );
}

function botMatchDebugLog(...args: unknown[]): void {
  if (shouldLogBotMatchDebug()) console.log(...args);
}

function dailyFritzDebugLog(...args: unknown[]): void {
  if (shouldLogDailyFritzDebug()) console.log(...args);
}

function traceDailyFritzEvent(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (!shouldLogDailyFritzDebug()) return;
  if (typeof window === 'undefined') return;
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Number(performance.now().toFixed(2))
      : Date.now();
  const entry = { tag, timestamp, ...payload };
  const win = window as typeof window & {
    __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
  };
  const bucket = (win.__dailyFritzInteractionTrace ??= []);
  bucket.push(entry);
  if (bucket.length > 400) {
    bucket.splice(0, bucket.length - 400);
  }
  dailyFritzDebugLog(tag, entry);
}

function getGhostResultMessage(playerScore: number, ghostScore: number): string {
  const margin = playerScore - ghostScore;
  if (margin >= 15) return "You've outgrown your ghost.";
  if (margin >= 1) return 'Closer than it looks. Ghost is watching.';
  if (margin <= -15) return "Ghost didn't even break a sweat.";
  return 'Your ghost remembers this.';
}

function roundedRatingDelta(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatRatingDelta(value: number): string {
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value}`;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function isDailyFritzScriptedDrawReady(
  pkg: DailyFritzStartResponse | null | undefined,
): pkg is DailyFritzStartResponse & {
  draw_winner: 'you' | 'bot';
  draw_player_tile: Tile;
  draw_fritz_tile: Tile;
} {
  if (!pkg) return false;
  if (pkg.draw_winner !== 'you' && pkg.draw_winner !== 'bot') return false;
  return (
    normalizePreGameDrawTile(pkg.draw_player_tile) != null &&
    normalizePreGameDrawTile(pkg.draw_fritz_tile) != null
  );
}

function logDailyFritzScriptedDrawMount(payload: Record<string, unknown>): void {
  console.log('[df-scripted-draw] mount', payload);
}

/** Session storage may contain the pre-game draw shell — that is not a mid-match resume. */
function isPersistedDailyFritzPlayableResume(match: BotMatchState): boolean {
  return !(
    match.handNumber === 0 &&
    match.players.you.hand.length === 0 &&
    match.players.bot.hand.length === 0 &&
    match.handOver
  );
}

function buildDoubleSixTiles(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

function sumTilePips(hand: Tile[]): number {
  return hand.reduce((sum, tile) => sum + tile.low + tile.high, 0);
}

function findMoveForSelection(moves: Move[], tile: Tile, position: Move['position']): Move | null {
  return (
    moves.find(
      (m) => m.type === 'play' && m.tile && m.position === position && tileEquals(m.tile, tile),
    ) ?? null
  );
}

function asPlayMoves(moves: Move[]): Move[] {
  return moves.filter((m) => m.type === 'play');
}

function formatPlacementTarget(position: string | undefined): string {
  if (!position) return 'the board';
  if (position === 'left') return 'the left end';
  if (position === 'right') return 'the right end';
  const branchMatch = position.match(/^branch-(\d+)-/);
  if (branchMatch) return `the double-${branchMatch[1]} branch`;
  return 'the board';
}

function syncGuidedBoneyardCount(current: Tile[], targetCount: number): Tile[] {
  if (current.length === targetCount) return current;
  if (current.length > targetCount) return current.slice(0, targetCount);
  return [
    ...current,
    ...Array.from({ length: targetCount - current.length }, () => ({ low: 0, high: 0 })),
  ];
}

function sameTileKeyMultiset(a: string[], b: string[]): boolean {
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

function guidedWinnerIdFromScores(playerScore: number, fritzScore: number): BotPlayerId {
  return playerScore >= fritzScore ? 'you' : 'bot';
}

function normalizedBoardTileMultiset(board: BoardState | null): string[] {
  if (!board) return [];
  const keys: string[] = [];
  for (const placed of board.mainLine ?? []) {
    keys.push(toTileKey(placed.tile));
  }
  for (const hub of board.hubDoubles ?? []) {
    for (const branch of hub.branches ?? []) {
      if (!branch) continue;
      for (const placed of branch.tiles ?? []) {
        keys.push(toTileKey(placed.tile));
      }
    }
  }
  return keys.sort();
}

function normalizedOpenEndValues(board: BoardState | null): number[] {
  return getMatchableOpenEnds(board)
    .map((end) => end.matchValue)
    .sort((a, b) => a - b);
}

function guidedV2EquivalentOutcome(
  result: BotActionResult,
  expected: LessonV2Event,
): boolean {
  const expectedBoard = parseLessonV2BoardState(expected.boardAfter);
  const actualBoard = result.state.board;
  if (!sameTileKeyMultiset(
    normalizedBoardTileMultiset(actualBoard),
    normalizedBoardTileMultiset(expectedBoard),
  )) return false;
  const actualOpenEnds = normalizedOpenEndValues(actualBoard);
  const expectedOpenEnds = normalizedOpenEndValues(expectedBoard);
  if (actualOpenEnds.length !== expectedOpenEnds.length) return false;
  for (let i = 0; i < actualOpenEnds.length; i += 1) {
    if (actualOpenEnds[i] !== expectedOpenEnds[i]) return false;
  }

  const actualPlayerHand = result.state.players.you.hand.map(toTileKey);
  const actualFritzHand = result.state.players.bot.hand.map(toTileKey);
  if (!sameTileKeyMultiset(actualPlayerHand, expected.playerHandAfter)) return false;
  if (!sameTileKeyMultiset(actualFritzHand, expected.fritzHandAfter)) return false;

  const actualScored = result.scored?.points ?? 0;
  if (actualScored !== expected.pointsScored) return false;
  if (result.state.players.you.score !== expected.playerScoreAfter) return false;
  if (result.state.players.bot.score !== expected.fritzScoreAfter) return false;
  if (result.state.handOver !== expected.handOver) return false;
  if (result.state.gameOver !== expected.gameOver) return false;
  if (result.state.currentPlayer !== (expected.turnContinues ? 'you' : 'bot') && !expected.handOver && !expected.gameOver) return false;
  return true;
}

interface GuidedCoachTip {
  tile: Tile;
  bestMove: Move;
  pts: number;
  openSum: number;
  isOnlyPlay: boolean;
  isControlChoice: boolean;
  placementCount: number;
  isOpeningMove: boolean;
  isOpeningDouble: boolean;
}

function toastFromResult(result: BotActionResult, opponentLabel: string): string {
  if (result.handEnded) {
    const winner = result.handEnded.winner === 'you' ? 'You' : opponentLabel;
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.passed) return `${result.passed.player === 'you' ? 'You' : opponentLabel} passed`;
  return '';
}

function notifyGuidedV2EventToasts(
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

function moveEntriesToGhostMoveLog(entries: MoveEntry[]): GhostMoveLogEntry[] {
  return entries
    .filter((entry) => entry.player === 'you')
    .map((entry) => ({
      turn: entry.moveNumber,
      actor: 'you',
      board_state: serializeGhostBoardState(entry.boardRenderState),
      tile_played: entry.action === 'place' && entry.tile ? `${entry.tile[0]}|${entry.tile[1]}` : null,
      branch: entry.action === 'draw' ? 'draw' : entry.action === 'pass' ? 'pass' : entry.action === 'place' && entry.tile ? (entry.boardState.find(s => s.tile[0] === entry.tile![0] && s.tile[1] === entry.tile![1])?.position ?? 'left') : null,
      hand_before: entry.handBefore.map(([low, high]) => `${low}|${high}`),
      score_delta: entry.pointsScored,
    }));
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
function parseGuidedBoardState(boardState: string): BoardState | null {
  if (!boardState || boardState === 'board:empty') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = JSON.parse(boardState) as any;

    // Remap mainLine: tile arrays [low, high] → { low, high }
    const mainLine: PlacedTile[] = (raw.mainLine ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (placed: any): PlacedTile => ({
        orientation: placed.orientation,
        tile: Array.isArray(placed.tile)
          ? { low: placed.tile[0] as number, high: placed.tile[1] as number }
          : (placed.tile as Tile),
      }),
    );

    // Remap hubs → hubDoubles; remap branch tiles the same way
    const hubDoubles: HubDouble[] = (raw.hubs ?? raw.hubDoubles ?? []).map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hub: any): HubDouble => ({
        hubId:           hub.hubId,
        laneType:        hub.laneType,
        laneRef:         hub.laneRef,
        branchDepth:     hub.branchDepth,
        tileIndex:       hub.tileIndex,
        mainlineIndex:   hub.mainlineIndex,
        hubValue:        hub.hubValue,
        leftSideFilled:  Boolean(hub.leftSideFilled),
        rightSideFilled: Boolean(hub.rightSideFilled),
        isCrossed:       Boolean(hub.isCrossed),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        branches: (hub.branches ?? []).map((branch: any): BranchArm | null =>
          branch
            ? {
                openEnd:         branch.openEnd,
                openEndIsDouble: Boolean(branch.openEndIsDouble),
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                tiles: (branch.tiles ?? []).map((placed: any): PlacedTile => ({
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
      leftEnd: typeof raw.leftEnd === 'number' ? raw.leftEnd : reconciled.leftEnd,
      rightEnd: typeof raw.rightEnd === 'number' ? raw.rightEnd : reconciled.rightEnd,
    };
  } catch {
    return null;
  }
}

function getGuidedV1AuthoredStepByIndex(
  lesson: FrozenLesson,
  stepIndex: number,
): AuthoredStep | null {
  if (stepIndex < 0) return null;
  return lesson.steps.find((step) => step.chosenMove !== null && step.stepIndex === stepIndex) ?? null;
}

function getGuidedV1OrderedAuthoredSteps(lesson: FrozenLesson): AuthoredStep[] {
  return lesson.steps
    .filter((step) => step.chosenMove !== null)
    .slice()
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

function getNextGuidedV1StepIndex(lesson: FrozenLesson, currentStepIndex: number): number | null {
  const next = getGuidedV1OrderedAuthoredSteps(lesson).find((step) => step.stepIndex > currentStepIndex);
  return next?.stepIndex ?? null;
}

function restoreGuidedV1NextPlayerState(
  lesson: FrozenLesson,
  currentStepIndex: number,
  currentMatch: BotMatchState,
): { nextStepIndex: number | null; nextState: BotMatchState | null } {
  const nextStepIndex = getNextGuidedV1StepIndex(lesson, currentStepIndex);
  if (nextStepIndex == null) return { nextStepIndex: null, nextState: null };
  const nextStep = getGuidedV1AuthoredStepByIndex(lesson, nextStepIndex);
  const restored = restoreGuidedV1StepMatchState(nextStep);
  if (restored) {
    return { nextStepIndex, nextState: restored };
  }
  if (nextStep?.boardState && nextStep.playerHand.length > 0) {
    const board = parseGuidedBoardState(nextStep.boardState);
    const playerTiles = nextStep.playerHand
      .map((k) => parseTileKey(k))
      .filter((t): t is Tile => t !== null);
    return {
      nextStepIndex,
      nextState: {
        ...currentMatch,
        board,
        handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
        players: {
          ...currentMatch.players,
          you: { ...currentMatch.players.you, hand: playerTiles },
        },
        handNumber: nextStep.handNumber ?? currentMatch.handNumber,
        currentPlayer: 'you',
        handOver: false,
        gameOver: false,
      },
    };
  }
  return { nextStepIndex, nextState: null };
}

function restoreGuidedV1NextFullMatchState(
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

function restoreGuidedV1StepMatchState(step: AuthoredStep | null): BotMatchState | null {
  if (!step?.matchStateJson) return null;
  try {
    return JSON.parse(step.matchStateJson) as BotMatchState;
  } catch {
    return null;
  }
}

function parseGuidedTranscriptState(stateJson: string): BotMatchState | null {
  if (!stateJson) return null;
  try {
    return JSON.parse(stateJson) as BotMatchState;
  } catch {
    return null;
  }
}

export default function BotMatchScreen({
  onBack,
  onNavigate,
  dealSize,
  fritzTier = 'elite',
  mode = 'bot',
  dailyPuzzleDate = null,
  userId = null,
  username = null,
  winningScore = 60,
  opponentName = 'Fritz',
  opponentUserId = null,
  currentGlickoRating = null,
  ghostProfile = null,
  onGhostProfileChange = null,
  onProfileRefresh = null,
  onProfilePatch = null,
  dailyFritzPackage = null,
  onDailyFritzComplete = null,
  dailyFritzSetOverlay = null,
  onDailyFritzGameComplete = null,
  isGuidedMode: isGuidedModeProp = false,
  isAuthoringMode: isAuthoringModeProp = false,
  isAuthoringV2Mode: isAuthoringV2ModeProp = false,
  isGuidedV2Mode: isGuidedV2ModeProp = false,
  enableGuidedMatchCandidateCapture = false,
  journeyTrial = null,
  onJourneyTrialComplete = null,
}: BotMatchScreenProps) {
  const dailyFritzStorageKey =
    mode === 'daily-fritz' && dailyFritzPackage
      ? `racehorse:daily-fritz:v2:${dailyFritzPackage.attempt_id}:game:${dailyFritzPackage.current_game_number ?? 1}`
      : null;
  const [shareCopied, setShareCopied] = useState(false);
  const dailyFritzShareText = useMemo(
    () => (dailyFritzSetOverlay ? buildShareText(dailyFritzSetOverlay) : ''),
    [dailyFritzSetOverlay],
  );
  const handleShareResult = useCallback(() => {
    if (!dailyFritzShareText) return;
    const markShared = (): void => {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({
          title: 'Daily Fritz',
          text: dailyFritzShareText,
        })
        .then(() => {
          markShared();
        })
        .catch(() => {
          /* user dismissed native share */
        });
      return;
    }
    void navigator.clipboard.writeText(dailyFritzShareText).then(() => {
      markShared();
    });
  }, [dailyFritzShareText]);

  useEffect(() => {
    setShareCopied(false);
  }, [dailyFritzShareText]);

  const isGuidedMode = isGuidedModeProp && mode === 'bot';
  const isAuthoringMode = isAuthoringModeProp && mode === 'bot';
  const isAuthoringV2Mode = isAuthoringV2ModeProp && mode === 'bot';
  const isGuidedV2Mode = isGuidedV2ModeProp && mode === 'bot';
  const isLearnAcademyMode = isGuidedMode || isAuthoringMode || isAuthoringV2Mode || isGuidedV2Mode;
  const wantsOriginalGuidedRecordMode = false;
  const frozenV2Lesson = useMemo(
    () => (isGuidedV2Mode ? loadGuidedV2PlaybackLesson() : null),
    [isGuidedV2Mode],
  );
  const guidedV2BootError = useMemo(() => {
    if (!isGuidedV2Mode) return null;
    if (!canStartGuidedV2Lesson(frozenV2Lesson)) {
      return validateGuidedV2Lesson(frozenV2Lesson);
    }
    return null;
  }, [isGuidedV2Mode, frozenV2Lesson]);
  const guidedV2PlaybackReady =
    isGuidedV2Mode && guidedV2BootError === null && frozenV2Lesson !== null;

  const resolveServerBaseUrl = () => {
    return resolveGameServerUrl();
  };
  const createLocalMatchId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const loadPersistedDailyFritzMatch = () => {
    if (!dailyFritzStorageKey || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(dailyFritzStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        attemptId?: string;
        currentHandIndex?: number;
        match?: BotMatchState;
        movesUsed?: number;
        moveLog?: MoveEntry[];
      };
      if (parsed.attemptId !== dailyFritzPackage?.attempt_id || !parsed.match) return null;
      const persistedHandIndex = Number(parsed.currentHandIndex);
      const serverHandIndex = Number(dailyFritzPackage?.current_hand_index ?? 0);
      if (!Number.isFinite(persistedHandIndex) || persistedHandIndex !== serverHandIndex) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };
  const initialPersistedDailyFritzMatch = loadPersistedDailyFritzMatch();
  const resumablePersistedDailyFritzMatch =
    initialPersistedDailyFritzMatch?.match &&
    isPersistedDailyFritzPlayableResume(initialPersistedDailyFritzMatch.match)
      ? initialPersistedDailyFritzMatch
      : null;
  const dailyFritzScriptedDrawReady = isDailyFritzScriptedDrawReady(dailyFritzPackage);
  const preGameDrawEligibilityInput = {
    mode,
    dealSize,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isDailyFritzMode: mode === 'daily-fritz',
    hasPersistedDailyFritzMatch: Boolean(resumablePersistedDailyFritzMatch),
  };
  const preGameDrawEligibleBase = isPreGameDrawEligible(preGameDrawEligibilityInput);
  const preGameDrawEligible =
    preGameDrawEligibleBase &&
    (mode !== 'daily-fritz' || dailyFritzScriptedDrawReady);
  const [preGameDrawActive, setPreGameDrawActive] = useState(preGameDrawEligible);
  const preGameDrawActiveRef = useRef(preGameDrawActive);
  preGameDrawActiveRef.current = preGameDrawActive;
  const DRAW_STEP_MS = 700;
  const DAILY_FRITZ_REVEAL_DELAY_MS = DAILY_FRITZ_HAND_REVEAL_DELAY_MS;
  const DAILY_FRITZ_AUTO_ADVANCE_MS = DAILY_FRITZ_HAND_AUTO_ADVANCE_MS;
  const HAND_LIFECYCLE_DEBUG_ENDPOINT =
    'http://127.0.0.1:7933/ingest/9cab376f-7897-4cfa-8543-b458c17de979';
  const HAND_LIFECYCLE_DEBUG_SESSION = '65d5db';

  botMatchDebugLog('[mode-debug]', { mode, isGuidedModeProp, isGuidedMode, isLearnAcademyMode });

  const fritzConfig = FRITZ_TIERS[fritzTier];
  const rootRef = useRef<HTMLDivElement>(null);
  const boardStageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BoardHandle>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const guidedBoneyardAnchorRef = useRef<HTMLDivElement>(null);
  const guidedFritzAnchorRef = useRef<HTMLButtonElement>(null);
  const [frozenLesson] = useState<FrozenLesson | null>(() => {
    if (!isGuidedMode) return null;
    // Primary: explicitly frozen lesson
    const frozen = loadFrozenLesson();
    if (frozen) {
      // ── [guided-debug] log step0 hand and attempt matchStateJson parse ──────
      botMatchDebugLog('[guided-debug] frozen step0 hand =', frozen.steps[0]?.playerHand ?? []);
      const firstReal = frozen.steps.find((s) => s.chosenMove !== null);
      if (firstReal?.matchStateJson) {
        try {
          const ms = JSON.parse(firstReal.matchStateJson) as BotMatchState;
          botMatchDebugLog(
            '[guided-debug] parsed matchStateJson hand =',
            ms.players.you.hand.map((t) => `${t.low}|${t.high}`),
          );
        } catch {
          console.warn('[guided-debug] matchStateJson present but failed to parse');
        }
      } else {
        console.warn(
          '[guided-debug] matchStateJson absent or null on firstRealStep',
          '— seeded PRNG fallback will run',
          'firstRealStep.stepIndex:', firstReal?.stepIndex,
        );
      }
      return frozen;
    }
    // Fallback: use the live authoring session as the lesson if it exists and
    // has actual authored steps with moves. This lets the admin verify the
    // correct game in guided mode before ever clicking "Freeze as Lesson".
    const authoring = loadAuthoringSession();
    if (authoring && authoring.steps.some((s) => s.chosenMove !== null)) {
      console.log('[guided-debug] frozen step0 hand = (authoring fallback)', authoring.steps[0]?.playerHand ?? []);
      return authoring;
    }
    return null;
  });
  const [guidedTranscript] = useState<GuidedTranscript | null>(() => {
    if (!isGuidedMode || isAuthoringMode || isGuidedV2Mode) return null;
    const published = loadOriginalGuidedTranscript();
    if (published) return published;
    const draft = loadOriginalGuidedTranscriptDraft();
    if (draft?.transcript) return draft.transcript;
    return null;
  });

  /**
   * Which source was used to init the guided match — written during the match
   * useState lazy init so it's available by first render without a re-render.
   * 'snapshot'       = boardState + playerHand from authored step 0 (preferred).
   * 'matchStateJson' = full BotMatchState from authored step (legacy path).
   * 'seeded-deal'    = PRNG fallback; may be WRONG if authoring used different seed.
   * 'random'         = no frozen lesson; full random match.
   */
  const guidedInitSourceRef = useRef<'full-matchStateJson' | 'reduced-snapshot' | 'seeded-deal' | 'random' | null>(null);

  const [match, setMatch] = useState<BotMatchState>(() => {
    if (isAuthoringMode) {
      // Try to resume from a saved authoring session
      const saved = loadAuthoringSession();
      if (saved?.matchSnapshot) {
        try {
          return JSON.parse(saved.matchSnapshot) as BotMatchState;
        } catch {
          // fall through to fresh start
        }
      }
      return createFixedBotMatch(generateAuthoringHandDeal(0), 60, 7);
    }

    if (isAuthoringV2Mode) {
      const saved = loadV2AuthoringSession();
      if (saved?.matchSnapshot) {
        try {
          return JSON.parse(saved.matchSnapshot) as BotMatchState;
        } catch {
          // fall through to fresh fixed start
        }
      }
      return createFixedBotMatch(generateAuthoringHandDeal(0), 60, 7);
    }

    // ── V2 Guided: hydrate ONLY from frozen lesson (never random deal) ─────
    if (isGuidedV2Mode) {
      const v2Lesson = loadGuidedV2PlaybackLesson();
      if (canStartGuidedV2Lesson(v2Lesson) && v2Lesson) {
        const playback = initGuidedV2Playback(v2Lesson, 1);
        if (playback.state) {
          return playback.state;
        }
        const handStartOnly = restoreGuidedV2HandStart(v2Lesson, 1);
        if (handStartOnly.state) {
          return handStartOnly.state;
        }
        if (import.meta.env.DEV) {
          console.warn(
            '[guided-v2-init] playback restore failed; using empty fixed deal',
            validateGuidedV2LessonPlayback(v2Lesson),
          );
        }
      }
      return createFixedBotMatch(
        { player_tiles: [], fritz_tiles: [], boneyard: [], locked: [] },
        winningScore,
        dealSize,
      );
    }

    if (isGuidedMode && guidedTranscript) {
      const restored = parseGuidedTranscriptState(guidedTranscript.initialState);
      if (restored) {
        guidedInitSourceRef.current = 'full-matchStateJson';
        return restored;
      }
    }

    if (isGuidedMode && !guidedTranscript) {
      guidedInitSourceRef.current = 'seeded-deal';
      console.warn('[guided-init] source=seeded-deal — no explicit guided transcript found');
      return createFixedBotMatch(generateAuthoringHandDeal(0), winningScore, dealSize);
    }

    if (isGuidedMode && !frozenLesson) {
      guidedInitSourceRef.current = 'random';
      console.log('[guided-init] source=random (no frozen lesson found)');
      console.log('[guided-flow] initial coached board hydrated = false');
    }

    return (
      resumablePersistedDailyFritzMatch?.match ??
      (preGameDrawEligible
        ? createPreGameDrawShellMatch(winningScore, dealSize)
        : mode === 'daily-fritz' && dailyFritzPackage
          ? createFixedBotMatchWithStarter(
              dailyFritzPackage.first_hand,
              dailyFritzPackage.draw_winner === 'bot' ? 'bot' : 'you',
              winningScore,
              dealSize,
            )
          : createBotMatch(winningScore, dealSize))
    );
  });
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedController, setSelectedController] = useState<BotPlayerId | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [toast, setToast] = useState('');
  const [scoreToast, setScoreToast] = useState<{
    message: string;
    tone: 'you' | 'bot';
    visible: boolean;
  } | null>(null);
  const [lastBotChoice, setLastBotChoice] = useState<BotChoice | null>(null);
  const [handReveal, setHandReveal] = useState<BotHandReveal | null>(null);
  const [handRevealProgress, setHandRevealProgress] = useState(1);
  const [handAdvanceError, setHandAdvanceError] = useState<string | null>(null);
  const [showManualHandAdvance, setShowManualHandAdvance] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showFullCoachTip, setShowFullCoachTip] = useState(false);

  useEffect(() => {
    logLayoutDebug(showLeaveConfirm ? 'leave-open' : 'leave-close', {
      rootRef,
      boardStageRef,
      handAreaRef,
    });
  }, [showLeaveConfirm]);
  const [movesUsed, setMovesUsed] = useState(
    resumablePersistedDailyFritzMatch?.movesUsed ?? 0,
  );
  const [dailyLeaderboard, setDailyLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [dailyLeaderboardLoading, setDailyLeaderboardLoading] = useState(false);
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveEntry[]>(
    resumablePersistedDailyFritzMatch?.moveLog ?? [],
  );
  const [ghostMoveLog, setGhostMoveLog] = useState<GhostMoveLogEntry[]>([]);
  const [handTileSize, setHandTileSize] = useState(56);
  const [lessonHandRowCount, setLessonHandRowCount] = useState(1);
  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);
  const [drawSequenceActive, setDrawSequenceActive] = useState(false);
  const drawSequenceActiveRef = useRef(false);
  const [flyingTiles, setFlyingTiles] = useState<
    { x: number; y: number; toX: number; toY: number; id: number }[]
  >([]);
  const flyingTileIdRef = useRef(0);
  const moveCounterRef = useRef(1);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [postGameReviewDismissed, setPostGameReviewDismissed] = useState(false);
  const [pivotalReviewOpen, setPivotalReviewOpen] = useState(false);
  const [pivotalReviewSummary, setPivotalReviewSummary] = useState<PivotalReviewSession | null>(null);
  const [ghostAgreementType, setGhostAgreementType] = useState<'agrees' | 'heuristic' | null>(null);
  const [ghostBoardPulse, setGhostBoardPulse] = useState(false);
  const [ghostPlayedTile, setGhostPlayedTile] = useState<Tile | null>(null);
  const [ghostResult, setGhostResult] = useState<GhostCompletionResult | null>(null);
  const [ghostResultLoading, setGhostResultLoading] = useState(false);
  const [ghostResultError, setGhostResultError] = useState<string | null>(null);
  const [matchStartGlickoRating, setMatchStartGlickoRating] = useState<number | null>(
    currentGlickoRating != null
      ? Number(currentGlickoRating)
      : null,
  );
  const [activeLocalMatchId, setActiveLocalMatchId] = useState<string>(
    () =>
      (mode === 'daily-fritz' && dailyFritzPackage
        ? `daily-fritz:${dailyFritzPackage.run_date}:${dailyFritzPackage.attempt_id}`
        : createLocalMatchId()),
  );
  const guidedMatchCaptureRef = useRef<GuidedMatchCaptureState | null>(null);
  const [guidedMatchCaptureStatus, setGuidedMatchCaptureStatus] = useState(() =>
    getGuidedMatchCaptureStatus(null),
  );
  const [guidedMatchCandidateSaveStatus, setGuidedMatchCandidateSaveStatus] = useState<string | null>(null);
  const [verifiedMatchId, setVerifiedMatchId] = useState<string | null>(
    dailyFritzPackage?.verified_match_id ?? null,
  );
  const [showRecommendation, setShowRecommendation] = useState(true);
  const [dailyFritzLeaderboard, setDailyFritzLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [dailyFritzRank, setDailyFritzRank] = useState<number | null>(null);
  const dailyResultSyncKeyRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const pendingHandRevealRef = useRef<{ handNumber: number; reveal: BotHandReveal } | null>(null);
  const handRevealRef = useRef<BotHandReveal | null>(null);
  handRevealRef.current = handReveal;
  const handAutoAdvanceTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const handAdvanceRetryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const advanceHandRef = useRef<() => void>(() => {});
  const handLifecyclePhaseRef = useRef<HandLifecyclePhase>('playing');
  const handRevealShownAtRef = useRef<number | null>(null);
  const dailyFritzMinAdvanceAtRef = useRef<number | null>(null);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameWinConfettiKeyRef = useRef('');
  const gameOverSoundKeyRef = useRef('');
  const ghostCompleteKeyRef = useRef('');
  const dailyFritzCompleteKeyRef = useRef('');
  const dailyFritzGameCompleteKeyRef = useRef('');
  const matchCompleteKeyRef = useRef('');
  const dailyFritzSubmitSucceededRef = useRef(false);
  const dailyFritzAutoSubmitBlockedRef = useRef(false);
  // One-way guard: set to true when advanceHand starts, reset on success or fatal error.
  // Prevents overlapping hand-transition calls (e.g. from watchdog + 5s timer firing together).
  const handTransitionInFlightRef = useRef(false);
  /** Retryable next-hand fetch failures before showing the red error copy. */
  const dailyFritzNextHandFailureCountRef = useRef(0);
  // Last-label ref for the Daily Fritz debug overlay — updated on every major transition.
  const lastDailyFlowLabelRef = useRef('init');
  const dailyFritzStorageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dailyFritzStoragePendingRef = useRef<{ key: string; payload: object } | null>(null);
  const dailyFritzNextHandRef = useRef<{
    promise: Promise<DailyFritzNextHandResponse>;
    result: DailyFritzNextHandResponse | null;
    error: unknown;
    startedAt: number;
  } | null>(null);
  const botChainPauseRef = useRef(false);
  const lifecycleVersionRef = useRef(0);
  const localRunIdRef = useRef(0);
  const activeLocalRunRef = useRef<LocalRunToken | null>(null);
  const matchRef = useRef(match);
  useEffect(() => {
    fairnessLog('match-init', {
      mode,
      handNumber: match.handNumber,
      youHand: match.players.you.hand.map((tile) => `${tile.low}-${tile.high}`),
      botHand: match.players.bot.hand.map((tile) => `${tile.low}-${tile.high}`),
      boneyardCount: match.boneyard.length,
      boneyardOrder: match.boneyard.map((tile) => `${tile.low}-${tile.high}`),
    });
  }, []);
  const prevTurnRef = useRef<BotPlayerId>(match.currentPlayer);
  const guidedFreeplayProcessedBotTurnRef = useRef<string | null>(null);
  const localPendingRegisteredRef = useRef(false);
  const localPendingResolvedRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);
  const fritzSessionReplyRef = useRef<Required<AuthoredStep>['fritzReplyEvents']>([]);
  const isTransitioningRef = useRef(false);
  const [dailyFritzHandIndex, setDailyFritzHandIndex] = useState(() => {
    const persisted = resumablePersistedDailyFritzMatch?.currentHandIndex;
    if (typeof persisted === 'number' && Number.isFinite(persisted)) {
      return persisted;
    }
    return dailyFritzPackage?.current_hand_index ?? 0;
  });
  const [dailyFritzSubmitRetryNonce, setDailyFritzSubmitRetryNonce] = useState(0);

  // ── Guided Lesson state (player-facing, reads frozenLesson) ──────────────
  /** Tracks how many player turns have been completed in the lesson */
  const [lessonStepIndex, setLessonStepIndex] = useState(() => {
    if (guidedTranscript) {
      return guidedTranscript.turns[0]?.stepIndex ?? 0;
    }
    if (frozenLesson) {
      return getGuidedV1OrderedAuthoredSteps(frozenLesson)[0]?.stepIndex ?? 0;
    }
    return 0;
  });
  const [guidedReplyIndex, setGuidedReplyIndex] = useState(-1);
  const [isOffAuthoredLine, setIsOffAuthoredLine] = useState(false);
  const [guidedV1Replay, setGuidedV1Replay] = useState<{ stepIndex: number; replyIndex: number } | null>(null);

  botMatchDebugLog('[BOTMATCH VERSION]', 'v1-click-debug-001');
  botMatchDebugLog('[mode-debug]', { mode, isGuidedMode, isLearnAcademyMode, lessonStepIndex });

  // ── Guided Authoring state (admin-only, no server calls) ─────────────────
  const [authoringSteps, setAuthoringSteps] = useState<AuthoredStep[]>(() => {
    if (!isAuthoringMode) return [];
    return loadAuthoringSession()?.steps ?? [];
  });
  const [authoringNoteText, setAuthoringNoteText] = useState('');
  /**
   * Snapshot captured at the START of each player turn.
   * stepIdx is locked here so Save-Note presses (which lengthen authoringSteps)
   * cannot shift the stepIndex used when the tile is eventually played.
   */
  const authoringPreMoveRef = useRef<{
    boardState: string;
    playerHand: string[];
    handNumber: number;
    matchStateJson: string;
    /** Step index frozen at turn-start — do NOT recompute from authoringSteps.length */
    stepIdx: number;
  } | null>(null);

  // ── V2 Authoring state (flat event timeline recorder) ───────────────────
  const [authoringV2Events, setAuthoringV2Events] = useState<LessonV2Event[]>(() => {
    if (!isAuthoringV2Mode) return [];
    return loadV2AuthoringSession()?.events ?? [];
  });
  const [authoringV2HandStarts, setAuthoringV2HandStarts] = useState<LessonV2HandStart[]>(() => {
    if (!isAuthoringV2Mode) return [];
    return loadV2AuthoringSession()?.handStarts ?? [];
  });
  /**
   * Next event index to assign.  We keep this in a ref so capture callbacks
   * don't need it as a stale dependency (state reads are always current).
   * Initialised from saved session length so we don't reuse indices on reload.
   */
  const authoringV2NextEventIndexRef = useRef<number>(
    isAuthoringV2Mode ? (loadV2AuthoringSession()?.events.length ?? 0) : 0,
  );
  /**
   * Stable creation timestamp for the V2 authoring session.
   * Preserved from the saved session on resume so repeated saves don't
   * overwrite the original createdAt with the current time.
   */
  const authoringV2CreatedAtRef = useRef<string>(
    isAuthoringV2Mode
      ? (loadV2AuthoringSession()?.createdAt ?? new Date().toISOString())
      : '',
  );
  /**
   * Mirror of authoringV2Events kept in a ref so the bot-effect capture
   * callback can always read the current length without a stale closure.
   */
  const authoringV2EventsRef = useRef<LessonV2Event[]>([]);

  // ── V2 Guided Lesson state (player-facing, reads frozenV2Lesson) ─────────
  const [guidedV2EventIndex, setGuidedV2EventIndex] = useState(() => {
    if (!isGuidedV2Mode) return 0;
    const lesson = loadGuidedV2PlaybackLesson();
    if (!lesson || !canStartGuidedV2Lesson(lesson)) return 0;
    return initGuidedV2Playback(lesson, 1).firstEventIndex;
  });
  const [isGuidedV2OffLine, setIsGuidedV2OffLine] = useState(false);
  const guidedMatchFinalDebrief = useMemo(() => {
    if (!isGuidedV2Mode || match.winnerId !== 'you') return null;
    return getPublicGuidedMatchFinalDebrief();
  }, [isGuidedV2Mode, match.winnerId]);
  const isGuidedMatchVictoryResult = Boolean(guidedMatchFinalDebrief);
  /**
   * Guards the Fritz V2 timer against double-apply.
   * Each event index may be applied at most once regardless of effect re-fires.
   */
  const fritzV2LastAppliedIndexRef = useRef<number>(-1);

  const isGhostMode = mode === 'ghost';
  const isDailyFritzMode = mode === 'daily-fritz';
  // Daily Fritz deferred for post-game review — see postGameReviewPolicy.ts
  const isDailyPuzzleRun = Boolean(dailyPuzzleDate);
  const isPlayVsFritzGameOver =
    mode === 'bot' &&
    !isGhostMode &&
    !isDailyFritzMode &&
    !isDailyPuzzleRun &&
    !isGuidedMode &&
    !isAuthoringMode &&
    !isAuthoringV2Mode &&
    !isGuidedV2Mode;
  const isJourneyTrial = Boolean(journeyTrial);
  const isStandaloneFritzMatch = Boolean(
    userId && !isJourneyTrial && !isGhostMode && !isDailyPuzzleRun && !isDailyFritzMode
    && !isGuidedMode && !isAuthoringMode && !isAuthoringV2Mode && !isGuidedV2Mode
  );
  const showPostGameOverlays = match.gameOver;

  useEffect(() => {
    if (!match.gameOver) {
      setPostGameReviewDismissed(false);
      setPivotalReviewOpen(false);
      setPivotalReviewSummary(null);
    }
  }, [match.gameOver]);

  const postGameAnalysis = useMemo(() => {
    if (
      !showPostGameOverlays ||
      !isBotPostGameReviewEligible({
        mode,
        isGhostMode,
        isDailyFritzMode,
        isDailyPuzzleRun,
        isGuidedMode,
        isAuthoringMode,
        isAuthoringV2Mode,
        isGuidedV2Mode,
        isJourneyTrial,
      })
    ) {
      return null;
    }
    if (!moveLog.some((entry) => entry.player === 'you')) return null;
    return analyzeMoveLog(moveLog, true);
  }, [
    showPostGameOverlays,
    mode,
    isGhostMode,
    isDailyFritzMode,
    isDailyPuzzleRun,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isJourneyTrial,
    moveLog,
  ]);

  const pivotalSelection = useMemo(() => {
    if (!postGameAnalysis) return null;
    return selectPivotalTurnsFromAnalysis(postGameAnalysis, moveLog, { winningScore });
  }, [postGameAnalysis, moveLog, winningScore]);

  const showPostGameReviewPrompt =
    showPostGameOverlays && postGameAnalysis != null && !postGameReviewDismissed;

  const showPlayVsFritzResultOverlay =
    showPostGameOverlays &&
    isPlayVsFritzGameOver &&
    !showPostGameReviewPrompt &&
    !pivotalReviewOpen &&
    !pivotalReviewSummary;

  const showDebug = hasDebugLocalStorageFlag('BOT_DEBUG');
  const enableDailyFritzProfiling =
    import.meta.env.DEV &&
    isDailyFritzMode &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem('DAILY_FRITZ_PROFILE') === '1';

  if (enableDailyFritzProfiling && typeof window !== 'undefined') {
    const win = window as typeof window & {
      __dailyFritzProfile?: {
        botMatchScreenRenderCount?: number;
      };
    };
    const profile = (win.__dailyFritzProfile ??= {});
    profile.botMatchScreenRenderCount = (profile.botMatchScreenRenderCount ?? 0) + 1;
  }
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;

  /**
   * V1 guided on-line playback is active when:
   *   • we are in guided mode with a frozen lesson, AND
   *   • the player has not gone off-authored-line
   *
   * In this mode:
   *   • The bot never runs live AI.
   *   • The player move is validated against authored chosenMove before mutation.
   *   • Fritz replies replay strictly from saved fritzReplyEvents.
   */
  const isOriginalGuidedFreeplayMode = false;
  const isOriginalGuidedScriptedFritzMode = false;
  const isGuidedTranscriptMode = isGuidedMode && !isAuthoringMode && !isGuidedV2Mode && guidedTranscript !== null;
  const isGuidedFrozenLessonMode = isGuidedMode && !isAuthoringMode && !isGuidedV2Mode && frozenLesson !== null;
  const isGuidedV1MinimalMode = false;
  const isGuidedV1OnlineMode = false;
  const lessonLayoutMode =
    isGuidedTranscriptMode || isGuidedFrozenLessonMode || wantsOriginalGuidedRecordMode || guidedV2PlaybackReady;

  useEffect(() => {
    if (!guidedV2PlaybackReady || !frozenV2Lesson) return;
    const playback = initGuidedV2Playback(frozenV2Lesson, 1);
    if (!playback.state) return;

    fritzV2LastAppliedIndexRef.current = -1;
    setGuidedV2EventIndex(playback.firstEventIndex);
    setIsGuidedV2OffLine(false);
    setSelectedTile(null);
    setSelectedController(null);
    setHandReveal(null);
    setMatch({
      ...playback.state,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
      opponentMissingEvidence: [],
    });
  }, [guidedV2PlaybackReady, frozenV2Lesson]);

  // ── Learning coach (guided mode only) ────────────────────────────────────
  const coach = useLearningCoach({
    isGuidedMode,
    match,
    playerLevel: 'beginner',
    gameMode: 'guided',
  });
  const opponentLabel = isGhostMode ? 'Ghost' : opponentName.trim() || 'Fritz';
  const ghostSubLabel = isGhostMode
    ? (opponentName && opponentName.toLowerCase() !== 'your ghost' ? opponentName : (username || 'Your Ghost'))
    : null;

  const handlePreGameDrawComplete = useCallback(
    (payload: PreGameDrawCompletePayload) => {
      setPreGameDrawActive(false);
      if (mode === 'daily-fritz' && dailyFritzPackage) {
        // Daily Fritz deal is fixed from server; draw only determines who opens hand 1.
        setMatch(
          createFixedBotMatchWithStarter(
            dailyFritzPackage.first_hand,
            dailyFritzPackage.draw_winner,
            winningScore,
            dealSize,
          ),
        );
        return;
      }
      setMatch(createBotMatchWithStarter(payload.remainingDeck, payload.winner, winningScore, dealSize));
    },
    [dealSize, winningScore, mode, dailyFritzPackage],
  );

  const dailyFritzScriptedDraw = dailyFritzScriptedDrawReady ? dailyFritzPackage : null;
  const scriptedPlayerTile = dailyFritzScriptedDraw
    ? normalizePreGameDrawTile(dailyFritzScriptedDraw.draw_player_tile)
    : null;
  const scriptedFritzTile = dailyFritzScriptedDraw
    ? normalizePreGameDrawTile(dailyFritzScriptedDraw.draw_fritz_tile)
    : null;
  const scriptedPlayerTileId = scriptedPlayerTile ? toPreGameDrawTileId(scriptedPlayerTile) : null;
  const scriptedFritzTileId = scriptedFritzTile ? toPreGameDrawTileId(scriptedFritzTile) : null;

  const preGameDraw = usePreGameDraw({
    enabled: preGameDrawActive,
    opponentLabel,
    scriptedPlayerTileId,
    scriptedFritzTileId,
    scriptedWinner: dailyFritzScriptedDraw ? dailyFritzScriptedDraw.draw_winner : null,
    onComplete: handlePreGameDrawComplete,
  });

  const formatGhostName = (rawName: string) => {
    const cleaned = rawName
      .replace(/'s Ghost/gi, '')
      .replace(/ Ghost/gi, '')
      .replace(/^@/, '')
      .trim();
    const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return `@${capitalized}`;
  };

  const postLocalBotMatch = useCallback(
    async (
      path: '/api/bot-matches/local/start' | '/api/bot-matches/local/abandon',
      body: Record<string, unknown>,
      options?: { keepalive?: boolean },
    ) => {
      const response = await fetch(`${resolveServerBaseUrl()}${path}`, {
        method: 'POST',
        credentials: 'include',
        keepalive: options?.keepalive ?? false,
        headers: {
          'Content-Type': 'application/json',
          ...(accessTokenRef.current ? { Authorization: `Bearer ${accessTokenRef.current}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `${path} failed with ${response.status}`);
      }
      if (response.status === 204) return null;
      const text = await response.text().catch(() => '');
      if (!text) return null;
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    [],
  );

  const abandonStandaloneFritzMatch = useCallback(
    async (useBeacon = false) => {
      if (!isStandaloneFritzMatch || !userId || localPendingResolvedRef.current) return;
      const live = matchRef.current;
      const payload = {
        userId,
        localMatchId: activeLocalMatchId,
        accessToken: accessTokenRef.current,
        youScore: live.players.you.score,
        botScore: live.players.bot.score,
      };
      localPendingResolvedRef.current = true;
      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(`${resolveServerBaseUrl()}/api/bot-matches/local/abandon`, blob);
        return;
      }
      await postLocalBotMatch('/api/bot-matches/local/abandon', payload, { keepalive: true });
    },
    [activeLocalMatchId, isStandaloneFritzMatch, postLocalBotMatch, userId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);

  useEffect(() => {
    if (!wantsOriginalGuidedRecordMode) return;
    const published = loadOriginalGuidedTranscript();
    const draft = loadOriginalGuidedTranscriptDraft();
    if (published || draft || !frozenLesson) return;
    const seededDraft = buildOriginalTranscriptDraftFromFrozenLesson(frozenLesson);
    if (!seededDraft) return;
    saveOriginalGuidedTranscriptDraft(seededDraft);
    console.log('[guided-record] seeded transcript draft from frozen lesson', {
      turnCount: seededDraft.transcript.turns.length,
    });
  }, [frozenLesson, wantsOriginalGuidedRecordMode]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isLearnAcademyMode) return;

    type GuidedFrozenAuditApi = {
      exportFrozenLessonAudit: () => FrozenLessonAudit | null;
      printFrozenLessonAudit: () => FrozenLessonAudit | null;
      exportFrozenLessonBoardDiffs: () => FrozenLessonBoardDiff[];
      printFrozenLessonBoardDiffs: () => FrozenLessonBoardDiff[];
      exportFrozenLessonTranscriptSkeleton: () => GuidedTranscriptDraft | null;
    };

    const win = window as typeof window & {
      __guidedFrozenAudit?: GuidedFrozenAuditApi;
    };

    const api: GuidedFrozenAuditApi = {
      exportFrozenLessonAudit: () => exportFrozenLessonAudit(frozenLesson),
      printFrozenLessonAudit: () => {
        const audit = exportFrozenLessonAudit(frozenLesson);
        console.log('[guided-frozen-audit]', audit);
        return audit;
      },
      exportFrozenLessonBoardDiffs: () => exportFrozenLessonBoardDiffs(frozenLesson),
      printFrozenLessonBoardDiffs: () => {
        const diffs = exportFrozenLessonBoardDiffs(frozenLesson);
        console.log('[guided-frozen-board-diffs]', diffs);
        return diffs;
      },
      exportFrozenLessonTranscriptSkeleton: () => {
        const draft = buildOriginalTranscriptDraftFromFrozenLesson(frozenLesson);
        console.log('[guided-frozen-transcript-skeleton]', draft);
        return draft;
      },
    };

    win.__guidedFrozenAudit = api;
    console.log('[guided-frozen-audit] ready on window.__guidedFrozenAudit');

    return () => {
      delete win.__guidedFrozenAudit;
    };
  }, [isLearnAcademyMode, frozenLesson]);

  useEffect(() => {
    if (typeof window === 'undefined' || (!isAuthoringMode && !wantsOriginalGuidedRecordMode)) return;

    type GuidedTranscriptAuthoringApi = {
      startFromCurrentMatch: (lessonId?: string) => GuidedTranscriptDraft;
      beginTurn: (input: { expectedPlayerMove: GuidedTranscriptMove; coachingText: string }) => GuidedTranscriptDraft | null;
      capturePlayerStateAfter: () => GuidedTranscriptDraft | null;
      recordFritzReply: (input: Omit<GuidedReplyEvent, 'runningPlayerScore' | 'runningFritzScore' | 'stateAfter'>) => GuidedTranscriptDraft | null;
      applyScriptedFritzMove: (input: { tile: string; position?: string }) => GuidedTranscriptDraft | null;
      applyScriptedFritzPass: () => GuidedTranscriptDraft | null;
      finishTurn: () => GuidedTranscriptDraft | null;
      exportDraft: () => GuidedTranscript | null;
      publishDraft: () => GuidedTranscript | null;
      clearDraft: () => void;
    };

    const win = window as typeof window & {
      __guidedTranscriptAuthoring?: GuidedTranscriptAuthoringApi;
    };

    const getDraft = (): GuidedTranscriptDraft | null => loadOriginalGuidedTranscriptDraft();
    const saveDraft = (draft: GuidedTranscriptDraft): GuidedTranscriptDraft => {
      saveOriginalGuidedTranscriptDraft(draft);
      return draft;
    };
    const recordReplyIntoDraft = (
      input: Omit<GuidedReplyEvent, 'runningPlayerScore' | 'runningFritzScore' | 'stateAfter'>,
      stateAfter: BotMatchState,
    ): GuidedTranscriptDraft | null => {
      const draft = getDraft();
      if (!draft || draft.activeStepIndex == null) return null;
      const reply: GuidedReplyEvent = {
        ...input,
        runningPlayerScore: stateAfter.players.you.score,
        runningFritzScore: stateAfter.players.bot.score,
        stateAfter: JSON.stringify(stateAfter),
      };
      draft.transcript.turns = draft.transcript.turns.map((turn) =>
        turn.stepIndex === draft.activeStepIndex
          ? { ...turn, fritzReplies: [...turn.fritzReplies, reply] }
          : turn,
      );
      return saveDraft(draft);
    };

    win.__guidedTranscriptAuthoring = {
      startFromCurrentMatch: (lessonId = 'original-coached') => {
        const draft: GuidedTranscriptDraft = {
          transcript: {
            lessonId,
            version: 'v1-explicit',
            initialState: JSON.stringify(matchRef.current),
            turns: [],
          },
          activeStepIndex: null,
        };
        return saveDraft(draft);
      },
      beginTurn: ({ expectedPlayerMove, coachingText }) => {
        const draft = getDraft();
        if (!draft) return null;
        const nextStepIndex = draft.transcript.turns.length;
        const turn: GuidedTurn = {
          stepIndex: nextStepIndex,
          handNumber: matchRef.current.handNumber,
          coachingText,
          stateBefore: JSON.stringify(matchRef.current),
          expectedPlayerMove,
          playerStateAfter: '',
          fritzReplies: [],
        };
        draft.transcript.turns = [...draft.transcript.turns, turn];
        draft.activeStepIndex = nextStepIndex;
        return saveDraft(draft);
      },
      capturePlayerStateAfter: () => {
        const draft = getDraft();
        if (!draft || draft.activeStepIndex == null) return null;
        draft.transcript.turns = draft.transcript.turns.map((turn) =>
          turn.stepIndex === draft.activeStepIndex
            ? { ...turn, playerStateAfter: JSON.stringify(matchRef.current) }
            : turn,
        );
        return saveDraft(draft);
      },
      recordFritzReply: (input) => {
        return recordReplyIntoDraft(input, matchRef.current);
      },
      applyScriptedFritzMove: ({ tile, position }) => {
        const parsedTile = parseTileKey(tile);
        if (!parsedTile) return null;
        const botState: BotMatchState = {
          ...matchRef.current,
          currentPlayer: 'bot',
        };
        const move =
          asPlayMoves(getLegalMoves(botState, 'bot')).find(
            (candidate) =>
              candidate.tile &&
              tileEquals(candidate.tile, parsedTile) &&
              (position ? candidate.position === position : true),
          ) ?? null;
        if (!move?.tile) return null;
        const result = applyPlayMove(botState, 'bot', move);
        setMatch(result.state);
        notifyBotActionResult(result);
        flashLastPlayed(move.tile);
        queueSound(() => playTileSound('deal', isMuted), 0);
        return recordReplyIntoDraft({
          type: 'play',
          tile,
          position: move.position ?? undefined,
          pointsScored: result.scored?.player === 'bot' ? result.scored.points : 0,
          handEnded: result.handEnded,
        }, result.state);
      },
      applyScriptedFritzPass: () => {
        const botState: BotMatchState = {
          ...matchRef.current,
          currentPlayer: 'bot',
        };
        const result = passTurn(botState, 'bot');
        setMatch(result.state);
        notifyBotActionResult(result);
        return recordReplyIntoDraft({
          type: 'pass',
          pointsScored: 0,
          handEnded: result.handEnded,
        }, result.state);
      },
      finishTurn: () => {
        const draft = getDraft();
        if (!draft) return null;
        draft.activeStepIndex = null;
        return saveDraft(draft);
      },
      exportDraft: () => getDraft()?.transcript ?? null,
      publishDraft: () => {
        const draft = getDraft();
        if (!draft) return null;
        saveOriginalGuidedTranscript(draft.transcript);
        return draft.transcript;
      },
      clearDraft: () => {
        clearOriginalGuidedTranscriptDraft();
      },
    };

    console.log('[guided-transcript-authoring] ready on window.__guidedTranscriptAuthoring');

    return () => {
      delete win.__guidedTranscriptAuthoring;
    };
  }, [isAuthoringMode, wantsOriginalGuidedRecordMode]);

  useEffect(() => {
    if (!isOriginalGuidedFreeplayMode) return;
    setIsOffAuthoredLine(false);
  }, [isOriginalGuidedFreeplayMode]);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  // ── Authoring: capture pre-move snapshot when player's turn starts ────────
  useEffect(() => {
    if (!isAuthoringMode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    // IMPORTANT: compute stepIdx HERE (at turn-start) and lock it into the ref.
    // Both recordAuthoringStep and saveAuthoringNoteOnly must use pre.stepIdx,
    // NOT authoringSteps.length at call-time — which shifts after every Save-Note press.
    const stepIdx = authoringSteps.length;
    authoringPreMoveRef.current = {
      boardState: serializeGhostBoardState(match.board),
      playerHand: match.players.you.hand.map(toTileKey),
      handNumber: match.handNumber,
      matchStateJson: JSON.stringify(match),
      stepIdx,
    };
    // Load any existing note for this step index (handles reload mid-session)
    const existing = authoringSteps.find((s) => s.stepIndex === stepIdx);
    setAuthoringNoteText(existing?.coachingText ?? '');
    // NOTE: Do NOT clear fritzSessionReplyRef here. The ref holds Fritz's reply
    // events from the bot turn that just finished, and those events need to be
    // flushed into the PREVIOUS authored step by the flush effect below.
  }, [isAuthoringMode, match.currentPlayer, match.handNumber, match.handOver, match.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthoringV2Mode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    const nextPlayerPlayEvent = nextPlayerEvent(authoringV2Events, authoringV2Events.length);
    setAuthoringNoteText(nextPlayerPlayEvent?.actor === 'player' && nextPlayerPlayEvent.action === 'play'
      ? nextPlayerPlayEvent.coachingText ?? ''
      : '');
  }, [
    isAuthoringV2Mode,
    authoringV2Events,
    match.currentPlayer,
    match.handOver,
    match.gameOver,
  ]);

  // ── Authoring: flush captured Fritz reply events into the previous step ──
  // When player's turn resumes after Fritz played, the fritzSessionReplyRef
  // holds the complete sequence of Fritz's reply events. Those events belong
  // to the most recently recorded authored step (the step whose move Fritz
  // was responding to). We attach them here and then clear the ref so the
  // next Fritz chain starts fresh.
  useEffect(() => {
    if (!isAuthoringMode) return;
    if (match.currentPlayer !== 'you') return;
    if (fritzSessionReplyRef.current.length === 0) return;
    const events = [...fritzSessionReplyRef.current];
    fritzSessionReplyRef.current = [];
    setAuthoringSteps((prev) => {
      if (prev.length === 0) return prev;
      // Find the most recent real (non-draft) step and attach the events there.
      let targetIdx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i]!.chosenMove !== null) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) return prev;
      const target = prev[targetIdx]!;
      const updated: AuthoredStep = { ...target, fritzReplyEvents: events };
      const next = [...prev];
      next[targetIdx] = updated;
      console.log('[guided-capture] flush', {
        flushedToStepIndex: target.stepIndex,
        count: events.length,
        stepHasEventsAfterFlush:
          Array.isArray(updated.fritzReplyEvents) && updated.fritzReplyEvents.length > 0,
      });
      return next;
    });
  }, [isAuthoringMode, match.currentPlayer, match.handNumber, match.handOver, match.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Authoring V1: persist session to localStorage on every steps change ─────
  useEffect(() => {
    if (!isAuthoringMode) return;
    const session: AuthoringSession = {
      lessonId: AUTHORING_LESSON_ID,
      fixedGameId: AUTHORING_GAME_ID,
      steps: authoringSteps,
      currentStepIndex: authoringSteps.length,
      matchSnapshot: JSON.stringify(matchRef.current),
    };
    saveAuthoringSession(session);
  }, [isAuthoringMode, authoringSteps]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Authoring V2: keep events ref in sync ────────────────────────────────
  useEffect(() => {
    authoringV2EventsRef.current = authoringV2Events;
  }, [authoringV2Events]);

  // ── Authoring V2: persist session to localStorage on every events change ──
  useEffect(() => {
    if (!isAuthoringV2Mode) return;
    const session: LessonV2AuthoringSession = {
      lessonId: AUTHORING_LESSON_ID,
      gameId: AUTHORING_GAME_ID,
      // Preserve the original createdAt; only update updatedAt on each save
      createdAt: authoringV2CreatedAtRef.current,
      updatedAt: new Date().toISOString(),
      handStarts: authoringV2HandStarts,
      events: authoringV2Events,
      matchSnapshot: JSON.stringify(matchRef.current),
      lastEventIndex: authoringV2Events.length - 1,
    };
    saveV2AuthoringSession(session);
  }, [isAuthoringV2Mode, authoringV2Events, authoringV2HandStarts, match]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Authoring V2: capture LessonV2HandStart when a new hand begins ───────
  // Fires when match.handNumber changes and the hand is live (not over).
  // Uses match directly since matchRef is updated in a separate effect.
  useEffect(() => {
    if (!isAuthoringV2Mode || match.handOver || match.gameOver) return;
    setAuthoringV2HandStarts((prev) => {
      if (prev.some((h) => h.handNumber === match.handNumber)) return prev;
      const handStart: LessonV2HandStart = {
        handNumber: match.handNumber,
        matchStateJson: JSON.stringify(match),
        firstEventIndex: authoringV2EventsRef.current.length,
      };
      console.log('[v2-capture] hand start', { handNumber: match.handNumber, firstEventIndex: handStart.firstEventIndex });
      return [...prev, handStart];
    });
  }, [isAuthoringV2Mode, match.handNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── [guided-debug] Log final rendered match hand after first mount ──────────
  // This fires once after React commits the initial state to the DOM.
  // Compare with [guided-debug] frozen step0 hand to detect mismatch.
  useEffect(() => {
    if (!isGuidedMode) return;
    console.log(
      '[guided-debug] final rendered match hand =',
      match.players.you.hand.map((t) => `${t.low}|${t.high}`),
    );
    console.log(
      '[guided-debug] init source =', guidedInitSourceRef.current,
      '| currentPlayer =', match.currentPlayer,
    );
    if (frozenLesson) {
      const frozenStep0 = frozenLesson.steps[0]?.playerHand ?? [];
      const renderedKeys = match.players.you.hand.map((t) => `${t.low}|${t.high}`).slice().sort().join(',');
      const frozenKeys = frozenStep0.slice().sort().join(',');
      if (renderedKeys !== frozenKeys) {
        console.error(
          '[guided-debug] ✗ HAND MISMATCH — rendered hand does NOT match frozen step0 hand.',
          'rendered:', match.players.you.hand.map((t) => `${t.low}|${t.high}`),
          'frozen step0:', frozenStep0,
          'source:', guidedInitSourceRef.current,
        );
      } else {
        console.log('[guided-debug] ✓ hands match — rendered hand matches frozen step0 hand');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!frozenLesson) {
      console.log('[guided-replay-blocked] reason = no-frozenLesson');
      return;
    }
    if (!isGuidedV1OnlineMode) {
      console.log('[guided-replay-blocked] reason = guided-v1-online-disabled', {
        isOffAuthoredLine,
        currentPlayer: match.currentPlayer,
        handOver: match.handOver,
        gameOver: match.gameOver,
        lessonStepIndex,
      });
      return;
    }
    if (match.handOver) {
      console.log('[guided-replay-blocked] reason = hand-over');
      return;
    }
    if (match.gameOver) {
      console.log('[guided-replay-blocked] reason = game-over');
      return;
    }
    if (match.currentPlayer !== 'bot') {
      console.log('[guided-replay-blocked] reason = current-player-not-bot', {
        currentPlayer: match.currentPlayer,
        lessonStepIndex,
      });
      return;
    }

    const prevStepIdx = lessonStepIndex - 1;
    const prevStep = getGuidedV1AuthoredStepByIndex(frozenLesson, prevStepIdx);
    const replyEvents = prevStep?.fritzReplyEvents ?? null;

    console.log('[guided-replay-start]', {
      lessonStepIndex,
      prevStepIdx,
      currentPlayer: match.currentPlayer,
      guidedReplyIndex,
      isTransitioning: isTransitioningRef.current,
      hasPrevStep: Boolean(prevStep),
      fritzReplyEventsCount: replyEvents?.length ?? 0,
      isOffAuthoredLine,
    });

    if (guidedReplyIndex !== -1) {
      console.log('[guided-replay-blocked] reason = replay-already-in-progress');
      return;
    }
    if (!isTransitioningRef.current) {
      console.log('[guided-replay-blocked] reason = transition-latch-false');
      return;
    }

    if (!prevStep) {
      console.log('[guided-replay-blocked] reason = waiting-for-lessonStepIndex-commit');
      return;
    }

    if (!replyEvents || replyEvents.length === 0) {
      console.log('[guided-replay-blocked] reason = missing-fritzReplyEvents');
      return;
    }

    isTransitioningRef.current = false;
    setGuidedReplyIndex(0);
  }, [isGuidedV1OnlineMode, frozenLesson, match.currentPlayer, match.handOver, match.gameOver, lessonStepIndex, guidedReplyIndex, isOffAuthoredLine]);

  // ── V2 Guided Playback: auto-apply Fritz events ───────────────────────────
  // Fires whenever the cursor lands on a fritz-actor event.  Applies the
  // authoritative state from the event and advances the cursor.  Stops as
  // soon as the cursor points at a player event (actor === 'player').
  //
  // This effect is safe from infinite loops:
  //   • It only fires when event.actor === 'fritz'
  //   • After advancing the cursor, the next render evaluates the new event
  //   • If that event is a player event, the early-return fires and the loop stops
  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver) return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'fritz') return;

    const timer = setTimeout(() => {
      // ── Double-apply guard ──────────────────────────────────────────────────
      // Effect dep changes (e.g. isMuted) can cause a re-fire before cursor
      // increments.  The ref ensures each event index is applied exactly once.
      if (fritzV2LastAppliedIndexRef.current === guidedV2EventIndex) return;
      fritzV2LastAppliedIndexRef.current = guidedV2EventIndex;

      // Apply authoritative board/hand/score state from the event
      const board = parseLessonV2BoardState(event.boardAfter);
      const playerHand = event.playerHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);
      const fritzHand = event.fritzHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);

      // Determine who plays next after this event
      const nextPlayer: BotPlayerId = event.handOver || event.gameOver
        ? 'you'
        : event.turnContinues
          ? 'bot'
          : 'you';

      console.log('[guided-v2-fritz-apply]', {
        guidedV2EventIndex,
        eventIndex: event.eventIndex,
        tile: event.tile ?? null,
        position: event.position ?? null,
        nextPlayer,
        expectedPlayerHandAfter: event.playerHandAfter,
        expectedFritzHandAfter: event.fritzHandAfter,
      });

      const nextState: BotMatchState = {
        ...matchRef.current,
        board,
        handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
        boneyard: syncGuidedBoneyardCount(matchRef.current.boneyard, event.boneyardCountAfter),
        players: {
          you: { ...matchRef.current.players.you, hand: playerHand, score: event.playerScoreAfter },
          bot: { ...matchRef.current.players.bot, hand: fritzHand, score: event.fritzScoreAfter },
        },
        currentPlayer: nextPlayer,
        handOver: event.handOver,
        gameOver: event.gameOver,
        handNumber: event.handNumber,
        winnerId: event.gameOver
          ? guidedWinnerIdFromScores(event.playerScoreAfter, event.fritzScoreAfter)
          : matchRef.current.winnerId,
      };
      setMatch(nextState);
      if (event.action === 'draw') {
        scheduleDrawStepAnimation('bot', nextState);
      }

      window.setTimeout(() => {
        const live = matchRef.current;
        console.log('[guided-v2-fritz-after]', {
          guidedV2EventIndex,
          eventIndex: event.eventIndex,
          tile: event.tile ?? null,
          liveCurrentPlayer: live.currentPlayer,
          livePlayerHand: live.players.you.hand.map(toTileKey),
          liveFritzHand: live.players.bot.hand.map(toTileKey),
        });
      }, 0);

      notifyGuidedV2EventToasts(event, opponentLabel, { showScoreToast, showBoardToast });

      // Play sounds for Fritz action
      if (event.pointsScored > 0) queueSound(() => playScoreSound(event.pointsScored, isMuted), 80);
      if (event.action === 'play') queueSound(() => playTileSound('standard', isMuted), 0);
      if (event.action === 'draw') queueSound(() => playDrawSound(isMuted), 0);
      if (event.handOver) {
        const won = event.handEnded?.winner === 'fritz';
        queueSound(() => won ? playHandWinSound(isMuted) : playHandLoseSound(isMuted), 400);
      }

      setGuidedV2EventIndex((i) => i + 1);

      // ── Trigger hand-reveal modal when Fritz ends the hand ──────────────────
      if (event.handOver && event.handEnded) {
        if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
        handRevealTimerRef.current = window.setTimeout(() => {
          setHandReveal({
            winner: event.handEnded!.winner === 'player' ? 'you'
              : event.handEnded!.winner === 'fritz' ? 'bot'
              : null,
            reason: event.handEnded!.reason,
            pointsAwarded: event.handEnded!.pointsAwarded,
            loserPips: event.handEnded!.loserPips,
            calcText: event.handEnded!.calcText,
            yourRemainingTiles: playerHand,
            botRemainingTiles: fritzHand,
          });
          handRevealTimerRef.current = null;
        }, 600);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, match.handOver, match.gameOver, isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── V2 Guided: repair one missing pre-play draw when authored event proves it ──
  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver || match.currentPlayer !== 'you') return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'player' || event.action !== 'play' || !event.tile) return;

    const liveHandKeys = match.players.you.hand.map(toTileKey);
    if (liveHandKeys.includes(event.tile)) return;
    if (!sameTileKeyMultiset(liveHandKeys, event.playerHandAfter)) return;

    const missingTile = parseTileKey(event.tile);
    if (!missingTile) return;

    console.log('[guided-v2-player-repair-draw]', {
      guidedV2EventIndex,
      eventIndex: event.eventIndex,
      missingTile: event.tile,
      liveHandKeys,
      expectedHandAfter: event.playerHandAfter,
      repairedBoneyardCount: event.boneyardCountAfter + 1,
    });

    setMatch((prev) => ({
      ...prev,
      boneyard: syncGuidedBoneyardCount(prev.boneyard, event.boneyardCountAfter + 1),
      players: {
        ...prev.players,
        you: {
          ...prev.players.you,
          hand: [...prev.players.you.hand, missingTile],
        },
      },
    }));
  }, [
    isGuidedV2Mode,
    frozenV2Lesson,
    guidedV2EventIndex,
    isGuidedV2OffLine,
    match.handOver,
    match.gameOver,
    match.currentPlayer,
    match.players.you.hand,
  ]);

  // ── V2 Guided: auto-apply forced player draw/pass events ─────────────────
  // When the authored sequence requires the player to draw or pass (no legal
  // play exists) this effect auto-applies the authoritative state so the game
  // advances without requiring any extra UI input from the player.
  // The auto-draw effect in the draw-sequence section is suppressed in V2
  // on-line mode to prevent it from drawing from the wrong (random) boneyard.
  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver) return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'player') return;
    if (event.action !== 'draw' && event.action !== 'pass') return;

    // Short delay so the player sees their hand before the auto-advance
    const timer = setTimeout(() => {
      const board = parseLessonV2BoardState(event.boardAfter);
      const playerHand = event.playerHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);
      const fritzHand = event.fritzHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);

      const nextPlayer: BotPlayerId = event.handOver || event.gameOver
        ? 'you'
        : event.turnContinues
          ? 'you'
          : 'bot';

      const nextState: BotMatchState = {
        ...matchRef.current,
        board,
        handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
        boneyard: syncGuidedBoneyardCount(matchRef.current.boneyard, event.boneyardCountAfter),
        players: {
          you: { ...matchRef.current.players.you, hand: playerHand, score: event.playerScoreAfter },
          bot: { ...matchRef.current.players.bot, hand: fritzHand, score: event.fritzScoreAfter },
        },
        currentPlayer: nextPlayer,
        handOver: event.handOver,
        gameOver: event.gameOver,
        handNumber: event.handNumber,
        winnerId: event.gameOver
          ? guidedWinnerIdFromScores(event.playerScoreAfter, event.fritzScoreAfter)
          : matchRef.current.winnerId,
      };
      setMatch(nextState);

      notifyGuidedV2EventToasts(event, opponentLabel, { showScoreToast, showBoardToast });
      if (event.action === 'draw') {
        scheduleDrawStepAnimation('you', nextState);
        queueSound(() => playDrawSound(isMuted), 0);
      }

      setGuidedV2EventIndex((i) => i + 1);

      // Trigger hand-reveal when player action ends the hand
      if (event.handOver && event.handEnded) {
        if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
        handRevealTimerRef.current = window.setTimeout(() => {
          setHandReveal({
            winner: event.handEnded!.winner === 'player' ? 'you'
              : event.handEnded!.winner === 'fritz' ? 'bot'
              : null,
            reason: event.handEnded!.reason,
            pointsAwarded: event.handEnded!.pointsAwarded,
            loserPips: event.handEnded!.loserPips,
            calcText: event.handEnded!.calcText,
            yourRemainingTiles: playerHand,
            botRemainingTiles: fritzHand,
          });
          handRevealTimerRef.current = null;
        }, 600);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, match.handOver, match.gameOver, isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const lastMoveNumber = moveLog.reduce(
      (max, entry) => Math.max(max, entry.moveNumber ?? 0),
      0,
    );
    moveCounterRef.current = Math.max(1, lastMoveNumber + 1);
  }, [moveLog]);

  useEffect(() => {
    const prev = prevTurnRef.current;
    const next = match.currentPlayer;
    if (prev === 'bot' && next === 'you' && !match.handOver && !match.gameOver) {
      queueSound(() => playYourTurnSound(isMuted), 400);
    }
    prevTurnRef.current = next;
  }, [match.currentPlayer, match.handOver, match.gameOver, isMuted]);

  useEffect(() => {
    return () => {
      lifecycleVersionRef.current += 1;
      activeLocalRunRef.current = null;
      drawSequenceActiveRef.current = false;
      setDrawSequenceActive(false);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      if (handAutoAdvanceTimerRef.current) clearTimeout(handAutoAdvanceTimerRef.current);
      if (handAdvanceRetryTimerRef.current) clearTimeout(handAdvanceRetryTimerRef.current);
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
  }, []);

  // ── Daily Fritz lifecycle logging ──────────────────────────────────────────
  useEffect(() => {
    if (!isDailyFritzMode || !dailyFritzPackage) return;

    const deckIds = new Set(initPreGameDraw().tiles.map((slot) => slot.id));
    const rawPlayer = dailyFritzPackage.draw_player_tile ?? null;
    const rawFritz = dailyFritzPackage.draw_fritz_tile ?? null;
    const normalizedPlayer = normalizePreGameDrawTile(rawPlayer);
    const normalizedFritz = normalizePreGameDrawTile(rawFritz);
    const playerTileId = normalizedPlayer ? toPreGameDrawTileId(normalizedPlayer) : null;
    const fritzTileId = normalizedFritz ? toPreGameDrawTileId(normalizedFritz) : null;
    const rawPlayerId =
      rawPlayer && typeof rawPlayer === 'object' && 'low' in rawPlayer && 'high' in rawPlayer
        ? `${(rawPlayer as Tile).low}-${(rawPlayer as Tile).high}`
        : null;
    const rawFritzId =
      rawFritz && typeof rawFritz === 'object' && 'low' in rawFritz && 'high' in rawFritz
        ? `${(rawFritz as Tile).low}-${(rawFritz as Tile).high}`
        : null;

    logDailyFritzScriptedDrawMount({
      attemptId: dailyFritzPackage.attempt_id ?? null,
      gameNumber: dailyFritzPackage.current_game_number ?? null,
      handIndex: dailyFritzPackage.current_hand_index ?? null,
      drawWinner: dailyFritzPackage.draw_winner ?? null,
      rawDrawPlayerTile: rawPlayer,
      rawDrawFritzTile: rawFritz,
      rawPlayerTileId: rawPlayerId,
      rawFritzTileId: rawFritzId,
      normalizedDrawPlayerTile: normalizedPlayer,
      normalizedDrawFritzTile: normalizedFritz,
      playerTileId,
      fritzTileId,
      playerTileIdInDeck: playerTileId ? deckIds.has(playerTileId) : false,
      fritzTileIdInDeck: fritzTileId ? deckIds.has(fritzTileId) : false,
      rawPlayerIdMismatch: rawPlayerId != null && playerTileId != null && rawPlayerId !== playerTileId,
      rawFritzIdMismatch: rawFritzId != null && fritzTileId != null && rawFritzId !== fritzTileId,
      mode,
      dealSize,
      isDailyFritzMode: mode === 'daily-fritz',
      isDailyFritzModePassedToGate: preGameDrawEligibilityInput.isDailyFritzMode,
      hasPersistedDailyFritzMatch: preGameDrawEligibilityInput.hasPersistedDailyFritzMatch,
      hasRawPersistedSessionMatch: Boolean(initialPersistedDailyFritzMatch),
      rawPersistedIsPlayableResume: Boolean(
        initialPersistedDailyFritzMatch?.match &&
          isPersistedDailyFritzPlayableResume(initialPersistedDailyFritzMatch.match),
      ),
      isGuidedMode,
      isAuthoringMode,
      preGameDrawEligibleBase,
      scriptedDrawGatePass: mode !== 'daily-fritz' || dailyFritzScriptedDrawReady,
      scriptedDrawReady: dailyFritzScriptedDrawReady,
      preGameDrawEligible,
      preGameDrawActive,
      scriptedMode:
        scriptedPlayerTileId != null &&
        scriptedFritzTileId != null &&
        (dailyFritzPackage.draw_winner === 'you' || dailyFritzPackage.draw_winner === 'bot'),
    });

    dailyFritzDebugLog('[daily-flow] package boot', {
      attemptId: dailyFritzPackage.attempt_id ?? null,
      gameNumber: dailyFritzPackage.current_game_number ?? null,
      handIndex: dailyFritzPackage.current_hand_index ?? null,
      hasSetResult: Boolean(dailyFritzPackage.set_result),
      drawWinner: dailyFritzPackage.draw_winner ?? null,
      drawPlayerTile: dailyFritzPackage.draw_player_tile ?? null,
      drawFritzTile: dailyFritzPackage.draw_fritz_tile ?? null,
      scriptedDrawReady: dailyFritzScriptedDrawReady,
    });
  }, [
    isDailyFritzMode,
    dailyFritzPackage,
    dailyFritzPackage?.attempt_id,
    dailyFritzPackage?.current_game_number,
    dailyFritzPackage?.current_hand_index,
    dailyFritzPackage?.set_result,
    dailyFritzPackage?.draw_winner,
    dailyFritzPackage?.draw_player_tile,
    dailyFritzPackage?.draw_fritz_tile,
    dailyFritzScriptedDrawReady,
    preGameDrawEligible,
    preGameDrawActive,
    preGameDrawEligibleBase,
    scriptedPlayerTileId,
    scriptedFritzTileId,
  ]);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    lastDailyFlowLabelRef.current = 'match-init';
    dailyFritzDebugLog('[daily-flow] match init', {
      handNumber: match.handNumber,
      currentPlayer: match.currentPlayer,
      attemptId: dailyFritzPackage?.attempt_id ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    lastDailyFlowLabelRef.current = 'hand-init';
    dailyFritzDebugLog('[daily-flow] hand init', {
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      currentPlayer: match.currentPlayer,
      prefetchReady: dailyFritzNextHandRef.current?.result != null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.handNumber]);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    if (match.handOver || match.gameOver) return;
    if (match.currentPlayer === 'you') {
      lastDailyFlowLabelRef.current = 'player-turn';
      dailyFritzDebugLog('[daily-flow] player turn start', {
        handNumber: match.handNumber,
        yourScore: match.players.you.score,
        botScore: match.players.bot.score,
      });
    } else {
      lastDailyFlowLabelRef.current = 'bot-turn';
      dailyFritzDebugLog('[daily-flow] bot turn start', {
        handNumber: match.handNumber,
        yourScore: match.players.you.score,
        botScore: match.players.bot.score,
      });
    }
  }, [match.currentPlayer, match.handOver, match.gameOver, match.handNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDailyFritzMode || !match.gameOver) return;
    lastDailyFlowLabelRef.current = 'match-complete';
    dailyFritzDebugLog('[daily-flow] match complete', {
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      winnerId: match.winnerId,
    });
  }, [match.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (rootRef.current) {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      // no-op
    }
  };

  const pushToast = useCallback((_msg: string, _ms = 1400) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast('');
  }, []);

  const showBoardToast = useCallback((message: string, tone: 'you' | 'bot') => {
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      message,
      tone,
      visible: true,
    });
    scoreToastHideTimerRef.current = setTimeout(() => {
      setScoreToast((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 1700);
    scoreToastClearTimerRef.current = setTimeout(() => setScoreToast(null), 2000);
  }, []);

  const showScoreToast = useCallback((player: 'you' | 'bot', points: number) => {
    showBoardToast(`${player === 'you' ? 'You' : opponentLabel} scored +${points}`, player);
  }, [opponentLabel, showBoardToast]);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }, []);

  const setDrawSequenceActiveBoth = useCallback((val: boolean) => {
    drawSequenceActiveRef.current = val;
    setDrawSequenceActive(val);
  }, []);

  const invalidateLocalRuns = useCallback(() => {
    lifecycleVersionRef.current += 1;
    activeLocalRunRef.current = null;
    setDrawSequenceActiveBoth(false);
  }, [setDrawSequenceActiveBoth]);

  const beginLocalRun = useCallback((kind: LocalRunToken['kind']): LocalRunToken => {
    const token: LocalRunToken = {
      id: ++localRunIdRef.current,
      lifecycleVersion: lifecycleVersionRef.current,
      kind,
    };
    activeLocalRunRef.current = token;
    return token;
  }, []);

  const isLocalRunCurrent = useCallback((token: LocalRunToken): boolean => {
    const active = activeLocalRunRef.current;
    return Boolean(
      active &&
      active.id === token.id &&
      active.lifecycleVersion === token.lifecycleVersion &&
      lifecycleVersionRef.current === token.lifecycleVersion,
    );
  }, []);

  const finishLocalRun = useCallback((token: LocalRunToken) => {
    if (activeLocalRunRef.current?.id === token.id) {
      activeLocalRunRef.current = null;
    }
  }, []);

  const renderScoreToastMessage = useCallback((message: string) => {
    const pointsMatch = message.match(/\+\d+/);
    if (!pointsMatch || typeof pointsMatch.index !== 'number') return message;
    const start = pointsMatch.index;
    const end = start + pointsMatch[0].length;
    return (
      <>
        {message.slice(0, start)}
        <span
          style={{
            fontSize: '1.48rem',
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '0.01em',
            display: 'inline-block',
            margin: '0 2px',
          }}
        >
          {pointsMatch[0]}
        </span>
        {message.slice(end)}
      </>
    );
  }, []);

  const appendMove = useCallback((entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber = moveCounterRef.current++;
    setMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const appendGhostMove = useCallback((entry: GhostMoveLogEntry) => {
    setGhostMoveLog((prev) => [...prev, entry]);
  }, []);

  const appendGuidedDraftFritzReply = useCallback((
    input: Omit<GuidedReplyEvent, 'runningPlayerScore' | 'runningFritzScore' | 'stateAfter'>,
    stateAfter: BotMatchState,
  ) => {
    if (!wantsOriginalGuidedRecordMode) return;
    const draft = loadOriginalGuidedTranscriptDraft();
    if (!draft || draft.activeStepIndex == null) return;
    const reply: GuidedReplyEvent = {
      ...input,
      runningPlayerScore: stateAfter.players.you.score,
      runningFritzScore: stateAfter.players.bot.score,
      stateAfter: JSON.stringify(stateAfter),
    };
    draft.transcript.turns = draft.transcript.turns.map((turn) =>
      turn.stepIndex === draft.activeStepIndex
        ? { ...turn, fritzReplies: [...turn.fritzReplies, reply] }
        : turn,
    );
    saveOriginalGuidedTranscriptDraft(draft);
  }, [wantsOriginalGuidedRecordMode]);

  const getFritzBestMove = useCallback((state: BotMatchState): EngineBestMove | null => {
    // chooseBotMove always evaluates for 'bot' player.
    // When it's your turn, mirror the state so your hand
    // is in the bot slot for evaluation.
    const evalState: BotMatchState = state.currentPlayer === 'you'
      ? {
          ...state,
          currentPlayer: 'bot',
          opponentPassedOnEnds: [],
          opponentDrawCount: 0,
          opponentKnownMissing: [],
          players: {
            you: state.players.bot,
            bot: state.players.you,
          },
        }
      : state;
    const choice = chooseBotMove(toBotVisibleState(evalState), fritzConfig.difficulty);
    if (!choice || !choice.move.tile) return null;
    return {
      tile: toTileTuple(choice.move.tile as Tile),
      position: choice.move.position,
      score: choice.score,
      breakdown: choice.breakdown,
    };
  }, [fritzConfig.difficulty]);

  const toEngineBestFromChoice = useCallback((choice: BotChoice | null): EngineBestMove | null => {
    if (!choice || !choice.move.tile) return null;
    return {
      tile: toTileTuple(choice.move.tile as Tile),
      position: choice.move.position,
      score: choice.score,
      breakdown: choice.breakdown,
    };
  }, []);

  const openAnalyzer = () => {
    const analysis = analyzeMoveLog(moveLog, true);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('bot', analysis);
    setAnalyzerOpen(true);
  };

  const skipPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(true);
  }, []);

  const openFullGameReviewFromPrompt = useCallback(() => {
    setPostGameReviewDismissed(true);
    const analysis = analyzeMoveLog(moveLog, true);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('bot', analysis);
    setAnalyzerOpen(true);
  }, [moveLog]);

  const openPivotalTurnReviewFromPrompt = useCallback(() => {
    setPostGameReviewDismissed(true);
    setPivotalReviewOpen(true);
  }, []);

  const completePivotalTurnReview = useCallback(
    (reflections: PivotalTurnReflection[]) => {
      if (!pivotalSelection) return;
      setPivotalReviewSummary(
        buildPivotalReviewSession({
          mode: 'bot',
          selection: pivotalSelection,
          reflections,
          youScore: match.players.you.score,
          opponentScore: match.players.bot.score,
        }),
      );
      setPivotalReviewOpen(false);
    },
    [match.players.bot.score, match.players.you.score, pivotalSelection],
  );

  const savePivotalReviewSummary = useCallback(() => {
    if (pivotalReviewSummary) savePivotalReviewSession(pivotalReviewSummary);
    setPivotalReviewSummary(null);
  }, [pivotalReviewSummary]);

  const openFullGameReviewFromSummary = useCallback(() => {
    if (pivotalReviewSummary) savePivotalReviewSession(pivotalReviewSummary);
    setPivotalReviewSummary(null);
    const analysis = analyzeMoveLog(moveLog, true);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('bot', analysis);
    setAnalyzerOpen(true);
  }, [moveLog, pivotalReviewSummary]);

  const exitMatch = useCallback(() => {
    invalidateLocalRuns();
    onBack();
  }, [invalidateLocalRuns, onBack]);

  const exitJourneyTrial = useCallback(
    (markCompleteOnWin: boolean) => {
      if (!journeyTrial || !onJourneyTrialComplete) {
        exitMatch();
        return;
      }
      invalidateLocalRuns();
      const won = match.winnerId === 'you';
      onJourneyTrialComplete({
        won: markCompleteOnWin && won,
        nodeId: journeyTrial.nodeId,
      });
    },
    [exitMatch, invalidateLocalRuns, journeyTrial, match.winnerId, onJourneyTrialComplete],
  );

  const startFreshMatch = () => {
    if (isGuidedV2Mode) {
      return;
    }
    if (isDailyFritzMode) {
      onDailyFritzComplete?.();
      exitMatch();
      return;
    }
    invalidateLocalRuns();
    localPendingRegisteredRef.current = false;
    localPendingResolvedRef.current = false;
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);
    setHandReveal(null);
    setGhostPlayedTile(null);
    setGhostAgreementType(null);
    setGhostBoardPulse(false);
    setGhostResult(null);
    setGhostResultLoading(false);
    setGhostResultError(null);
    setGuidedMatchCandidateSaveStatus(null);
    setMovesUsed(0);
    setDailyLeaderboard([]);
    setDailyLeaderboardError(null);
    setDailyLeaderboardLoading(false);
    setMoveLog([]);
    setGhostMoveLog([]);
    moveCounterRef.current = 1;
    setCurrentAnalysis(null);
    setAnalyzerOpen(false);
    setPostGameReviewDismissed(false);
    setPivotalReviewOpen(false);
    setPivotalReviewSummary(null);
    dailyResultSyncKeyRef.current = '';
    gameWinConfettiKeyRef.current = '';
    ghostCompleteKeyRef.current = '';
    setMatchStartGlickoRating(
      currentGlickoRating != null
        ? Number(currentGlickoRating)
        : ghostResult?.glickoRating != null
          ? Number(ghostResult.glickoRating)
          : matchStartGlickoRating,
    );
    setVerifiedMatchId(null);
    setActiveLocalMatchId(createLocalMatchId());
    if (preGameDrawEligible) {
      setPreGameDrawActive(true);
      preGameDraw.reset();
      setMatch(createPreGameDrawShellMatch(winningScore, dealSize));
    } else {
      setPreGameDrawActive(false);
      setMatch(createBotMatch(winningScore, dealSize));
    }
  };

  const goHome = useCallback(() => {
    invalidateLocalRuns();
    onNavigate?.('home');
  }, [invalidateLocalRuns, onNavigate]);

  const returnToFritzSetup = useCallback(() => {
    invalidateLocalRuns();
    if (onNavigate) {
      onNavigate('botSetup');
      return;
    }
    onBack();
  }, [invalidateLocalRuns, onNavigate, onBack]);

  const returnToLearn = useCallback(() => {
    invalidateLocalRuns();
    onNavigate?.('learn');
  }, [invalidateLocalRuns, onNavigate]);

  useEffect(() => {
    if (match.gameOver) return;
    if (currentGlickoRating == null) return;
    if (matchStartGlickoRating != null) return;
    setMatchStartGlickoRating(Number(currentGlickoRating));
  }, [currentGlickoRating, match.gameOver, matchStartGlickoRating]);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const win = window as typeof window & {
      __dailyFritzProfileActive?: boolean;
      __dailyFritzProfile?: Record<string, unknown>;
      __dailyFritzInteractionTrace?: Array<Record<string, unknown>>;
    };
    if (isDailyFritzMode) {
      win.__dailyFritzProfileActive = true;
      win.__dailyFritzProfile ??= {};
      win.__dailyFritzInteractionTrace ??= [];
    } else {
      win.__dailyFritzProfileActive = false;
    }
    return () => {
      if (win.__dailyFritzProfileActive) {
        win.__dailyFritzProfileActive = false;
      }
    };
  }, [isDailyFritzMode]);

  useEffect(() => {
    if (!isDailyFritzMode || !dailyFritzStorageKey || typeof window === 'undefined') return;
    if (match.gameOver) {
      if (dailyFritzStorageTimerRef.current) {
        clearTimeout(dailyFritzStorageTimerRef.current);
        dailyFritzStorageTimerRef.current = null;
      }
      const finalSnapshot = {
        attemptId: dailyFritzPackage?.attempt_id ?? null,
        currentHandIndex: dailyFritzHandIndex,
        match,
        movesUsed,
        moveLog,
      };
      dailyFritzStoragePendingRef.current = { key: dailyFritzStorageKey, payload: finalSnapshot };
      window.sessionStorage.setItem(dailyFritzStorageKey, JSON.stringify(finalSnapshot));
      return;
    }
    if (dailyFritzStorageTimerRef.current) clearTimeout(dailyFritzStorageTimerRef.current);
    // Capture snapshot now (references to immutable state objects) but defer
    // JSON.stringify — the expensive part — by 1 s so rapid tile plays don't
    // serialize on every move.
    const snapshot = {
      attemptId: dailyFritzPackage?.attempt_id ?? null,
      currentHandIndex: dailyFritzHandIndex,
      match,
      movesUsed,
      moveLog,
    };
    // Always keep the pending ref current so the pagehide flush can write the
    // latest state even if the debounce timer hasn't fired yet.
    dailyFritzStoragePendingRef.current = { key: dailyFritzStorageKey, payload: snapshot };
    dailyFritzStorageTimerRef.current = setTimeout(() => {
      window.sessionStorage.setItem(dailyFritzStorageKey, JSON.stringify(snapshot));
      dailyFritzStoragePendingRef.current = null;
      dailyFritzStorageTimerRef.current = null;
    }, 1000);
    return () => {
      if (dailyFritzStorageTimerRef.current) {
        clearTimeout(dailyFritzStorageTimerRef.current);
        dailyFritzStorageTimerRef.current = null;
      }
    };
  }, [dailyFritzHandIndex, dailyFritzPackage?.attempt_id, dailyFritzStorageKey, isDailyFritzMode, match, moveLog, movesUsed]);

  // Flush any pending debounced Daily Fritz state write on page unload so the
  // player resumes from the latest move rather than up to 1 s behind.
  useEffect(() => {
    if (!isDailyFritzMode) return;
    const flush = () => {
      const pending = dailyFritzStoragePendingRef.current;
      if (!pending) return;
      try {
        window.sessionStorage.setItem(pending.key, JSON.stringify(pending.payload));
      } catch {
        // sessionStorage may be unavailable during unload — fail silently
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [isDailyFritzMode]);

  useEffect(() => {
    if (!isStandaloneFritzMatch || !userId) return;
    if (preGameDrawActive) return;
    let cancelled = false;
    void (async () => {
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          accessTokenRef.current = data.session?.access_token ?? null;
        } catch {
          accessTokenRef.current = null;
        }
      }
      if (cancelled || localPendingRegisteredRef.current) return;
      if (isGuidedMode || isAuthoringMode) return;
      try {
        const response = await postLocalBotMatch('/api/bot-matches/local/start', {
          userId,
          fritzTier,
          localMatchId: activeLocalMatchId,
        });
        localPendingRegisteredRef.current = true;
        const matchId = typeof response?.matchId === 'string' ? response.matchId : null;
        if (matchId) {
          setVerifiedMatchId(matchId);
        }
      } catch (err) {
        console.warn('[Fritz Pending] start failed', err);
        if (matchRef.current.gameOver) {
          setGhostResultLoading(false);
          setGhostResultError(err instanceof Error ? err.message : 'Rating session failed to start.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeLocalMatchId, fritzTier, isStandaloneFritzMatch, match.gameOver, postLocalBotMatch, preGameDrawActive, userId]);

  useEffect(() => {
    if (!userId || !isGhostMode || isDailyPuzzleRun) return;
    if (match.gameOver || verifiedMatchId) return;
    let cancelled = false;
    void startGhostMatchSession({
      userId,
      localMatchId: activeLocalMatchId,
      opponentUserId,
    })
      .then((response) => {
        if (cancelled) return;
        setVerifiedMatchId(response.matchId);
      })
      .catch((err) => {
        console.warn('[Ghost Match] start failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeLocalMatchId,
    isDailyPuzzleRun,
    isGhostMode,
    match.gameOver,
    opponentUserId,
    userId,
    verifiedMatchId,
  ]);

  useEffect(() => {
    if (!isStandaloneFritzMatch || match.gameOver) return;
    const handlePageHide = () => {
      void abandonStandaloneFritzMatch(true);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [abandonStandaloneFritzMatch, isStandaloneFritzMatch, match.gameOver]);

  useEffect(() => {
    if (!match.gameOver || match.winnerId !== 'you') return;
    const key = `${match.handNumber}:${match.players.you.score}:${match.players.bot.score}`;
    if (gameWinConfettiKeyRef.current === key) return;
    gameWinConfettiKeyRef.current = key;
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.55 },
      colors: ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff'],
    });
  }, [match.gameOver, match.winnerId, match.handNumber, match.players.you.score, match.players.bot.score]);

  useEffect(() => {
    if (!match.gameOver || !match.winnerId) {
      gameOverSoundKeyRef.current = '';
      return;
    }
    const key = `${match.handNumber}:${match.winnerId}:${match.players.you.score}:${match.players.bot.score}`;
    if (gameOverSoundKeyRef.current === key) return;
    gameOverSoundKeyRef.current = key;
    if (match.winnerId === 'you') {
      queueSound(() => playMatchWinSound(isMuted), 320);
    } else {
      queueSound(() => playMatchLoseSound(isMuted), 320);
    }
  }, [match.gameOver, match.winnerId, match.handNumber, match.players.you.score, match.players.bot.score, isMuted]);

  useEffect(() => {
    if (!isDailyFritzMode || !onDailyFritzGameComplete) return;
    if (!match.gameOver) {
      dailyFritzGameCompleteKeyRef.current = '';
      return;
    }
    const key = [
      dailyFritzPackage?.attempt_id ?? 'daily',
      dailyFritzPackage?.current_game_number ?? 1,
      match.handNumber,
      match.winnerId,
      match.players.you.score,
      match.players.bot.score,
      movesUsed,
    ].join(':');
    if (dailyFritzGameCompleteKeyRef.current === key) return;
    dailyFritzGameCompleteKeyRef.current = key;
    onDailyFritzGameComplete({
      winner: match.winnerId,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      movesUsed,
      handsPlayed: match.handNumber,
      currentHandIndex: dailyFritzHandIndex,
      moveLog: JSON.parse(JSON.stringify(moveLog)),
    });
  }, [
    dailyFritzHandIndex,
    dailyFritzPackage?.attempt_id,
    dailyFritzPackage?.current_game_number,
    isDailyFritzMode,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    moveLog,
    movesUsed,
    onDailyFritzGameComplete,
  ]);

  const submitDailyFritzCompletion = useCallback(() => {
    if (!isDailyFritzMode || onDailyFritzGameComplete || !dailyFritzPackage || !userId || !match.gameOver) return;
    if (dailyFritzSubmitSucceededRef.current || dailyFritzAutoSubmitBlockedRef.current) return;

    dailyFritzDebugLog('[daily-complete] game over reached');

    const completionKey = [
      dailyFritzPackage.attempt_id,
      match.handNumber,
      match.players.you.score,
      match.players.bot.score,
      movesUsed,
    ].join(':');

    if (dailyFritzCompleteKeyRef.current === completionKey) {
      dailyFritzDebugLog('[daily-complete] modal state = dedup-skipped key=' + completionKey);
      return;
    }
    dailyFritzCompleteKeyRef.current = completionKey;

    dailyFritzDebugLog('[daily-complete] submit start key=' + completionKey);
    dailyFritzDebugLog('[daily-flow] submit start', {
      key: completionKey,
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
    setGhostResultLoading(true);
    setGhostResultError(null);

    const capturedMoveLog = JSON.parse(JSON.stringify(moveLog));

    void (async () => {
      if (isGuidedMode || isAuthoringMode) {
        setGhostResultLoading(false);
        return;
      }
      try {
        const completionHash = await buildDailyFritzCompletionHash({
          runDate: dailyFritzPackage.run_date,
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          currentHandIndex: dailyFritzHandIndex,
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog: capturedMoveLog,
        });

        const response = await completeDailyFritz({
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          runDate: dailyFritzPackage.run_date,
          completionHash,
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog: capturedMoveLog,
        });
        dailyFritzSubmitSucceededRef.current = true;
        dailyFritzAutoSubmitBlockedRef.current = false;
        dailyFritzDebugLog('[daily-complete] submit success');
        dailyFritzDebugLog('[daily-flow] submit success', {
          key: completionKey,
          rank: response.rank ?? null,
        });
        setDailyFritzLeaderboard(response.leaderboard_preview);
        setDailyFritzRank(response.rank ?? null);
        setGhostResultLoading(false);
        dailyFritzDebugLog('[daily-complete] modal state = complete');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Daily Fritz submission failed.';
        dailyFritzAutoSubmitBlockedRef.current = true;
        dailyFritzCompleteKeyRef.current = '';
        dailyFritzDebugLog('[daily-complete] submit error', errMsg);
        dailyFritzDebugLog('[daily-flow] submit error', { key: completionKey, error: errMsg });
        setGhostResultLoading(false);
        setGhostResultError(errMsg);
        dailyFritzDebugLog('[daily-complete] modal state = error');
      }
    })();
  }, [
    dailyFritzPackage,
    dailyFritzHandIndex,
    isDailyFritzMode,
    isAuthoringMode,
    isGuidedMode,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    movesUsed,
    moveLog,
    onDailyFritzGameComplete,
    userId,
  ]);

  const retryDailyFritzCompletion = useCallback(() => {
    if (!ghostResultError || ghostResultLoading || dailyFritzSubmitSucceededRef.current) return;
    dailyFritzAutoSubmitBlockedRef.current = false;
    setGhostResultError(null);
    setDailyFritzSubmitRetryNonce((prev) => prev + 1);
  }, [ghostResultError, ghostResultLoading]);

  useEffect(() => {
    if (!isDailyFritzMode || onDailyFritzGameComplete || !dailyFritzPackage || !userId) return;

    if (!match.gameOver) {
      dailyFritzDebugLog('[daily-complete] modal state = not-game-over');
      if (!dailyFritzSubmitSucceededRef.current) {
        dailyFritzCompleteKeyRef.current = '';
        dailyFritzAutoSubmitBlockedRef.current = false;
        setGhostResultLoading(false);
        setGhostResultError(null);
      }
      return;
    }

    if (dailyFritzSubmitSucceededRef.current) {
      dailyFritzDebugLog('[daily-complete] modal state = already-succeeded (permanent guard)');
      return;
    }

    if (dailyFritzAutoSubmitBlockedRef.current) {
      dailyFritzDebugLog('[daily-complete] modal state = waiting-for-manual-retry');
      return;
    }

    submitDailyFritzCompletion();
  }, [
    dailyFritzPackage,
    dailyFritzSubmitRetryNonce,
    isDailyFritzMode,
    match.gameOver,
    onDailyFritzGameComplete,
    submitDailyFritzCompletion,
    userId,
  ]);

  useEffect(() => {
    if (!ghostPlayedTile) return;
    const timer = window.setTimeout(() => setGhostPlayedTile(null), 900);
    return () => window.clearTimeout(timer);
  }, [ghostPlayedTile]);

  useEffect(() => {
    if (!userId) return;
    if (isDailyFritzMode) return;
    if (!match.gameOver) {
      ghostCompleteKeyRef.current = '';
      setGhostResult(null);
      setGhostResultLoading(false);
      setGhostResultError(null);
      return;
    }
    if (!verifiedMatchId) {
      setGhostResultLoading(false);
      if (isStandaloneFritzMatch) {
        setGhostResultError('Rating session was not verified. Match result saved locally.');
      } else if (isGhostMode) {
        setGhostResultError('Could not start rating session.');
      }
      return;
    }
    const key = `${verifiedMatchId}:${userId}:${match.handNumber}:${match.players.you.score}:${match.players.bot.score}`;
    if (ghostCompleteKeyRef.current === key) return;
    ghostCompleteKeyRef.current = key;
    setGhostResultLoading(true);
    setGhostResultError(null);

    const effectiveOpponentUserId = isGhostMode ? opponentUserId : (opponentUserId || fritzConfig.id);

    botMatchDebugLog('[Fritz Rating] calling completeGhostGame', {
      userId,
      effectiveOpponentUserId,
      finalScore: match.players.you.score,
      opponentScore: match.players.bot.score,
    });
    const genericGhostCompatibleMoveLog = moveEntriesToGhostMoveLog(moveLog);
    const fritzPlayerMoveLog = !isGhostMode ? genericGhostCompatibleMoveLog : undefined;
    const effectiveGhostMoveLog =
      ghostMoveLog.length > 0 ? ghostMoveLog : genericGhostCompatibleMoveLog;

    if (isGuidedMode || isAuthoringMode) {
      setGhostResultLoading(false);
      return;
    }

    void completeGhostGame({
      matchId: verifiedMatchId,
      userId,
      opponentUserId: effectiveOpponentUserId,
      localMatchId: activeLocalMatchId,
      finalScore: match.players.you.score,
      opponentScore: match.players.bot.score,
      moveLog: isGhostMode ? effectiveGhostMoveLog : fritzPlayerMoveLog ?? effectiveGhostMoveLog,
      playerMoveLog: fritzPlayerMoveLog,
      accessToken: accessTokenRef.current,
    })
      .then((result) => {
        botMatchDebugLog('[Fritz Rating] success:', result);
        setGhostResult(result);
        setGhostResultLoading(false);
        if (!isGhostMode) {
          localPendingResolvedRef.current = true;
        }
        if (result.glickoRating != null && onProfilePatch) {
          onProfilePatch({ glicko_rating: Number(result.glickoRating) });
        }
        if (onProfileRefresh) {
          void Promise.resolve(onProfileRefresh()).catch((err) => {
            console.warn('[Fritz Rating] profile refresh failed:', err);
          });
          window.setTimeout(() => {
            void Promise.resolve(onProfileRefresh()).catch(() => {});
          }, 1200);
        }
        if (!onGhostProfileChange) return;

        onGhostProfileChange(
          ghostProfile
            ? {
                ...ghostProfile,
                ghostRating: result.newRating,
                gamesPlayed: (ghostProfile.gamesPlayed ?? 0) + 1,
                recentScores: [...ghostProfile.recentScores, match.players.you.score].slice(-5),
                avgScore:
                  Math.round(
                    ([...ghostProfile.recentScores, match.players.you.score].slice(-5).reduce(
                      (sum, score) => sum + score,
                      0,
                    ) /
                      Math.max(1, [...ghostProfile.recentScores, match.players.you.score].slice(-5).length)) *
                      10,
                  ) / 10,
                paddingGames: Math.max(0, 5 - ((ghostProfile.gamesPlayed ?? 0) + 1)),
                compositeLog: result.compositeLog,
                styleProfile: result.styleProfile,
              }
            : null,
        );
      })
      .catch((err) => {
        console.error('[Fritz Rating] failed:', err);
        ghostCompleteKeyRef.current = '';
        setGhostResultLoading(false);
        setGhostResultError(err instanceof Error ? err.message : 'Rating update failed.');
        if (onProfileRefresh) {
          void Promise.resolve(onProfileRefresh()).catch((refreshErr) => {
            console.warn('[Fritz Rating] profile refresh after error failed:', refreshErr);
          });
        }
      });

  }, [
    ghostMoveLog,
    ghostProfile,
    isGhostMode,
    isStandaloneFritzMatch,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    opponentUserId,
    onGhostProfileChange,
    onProfilePatch,
    onProfileRefresh,
    userId,
    fritzConfig.id,
    activeLocalMatchId,
    isDailyFritzMode,
    verifiedMatchId,
  ]);

  const userLegalMoves = useMemo(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return [];

    try {
      const moves = getLegalMoves(match, 'you');
      if (isGuidedV1OnlineMode) {
        console.log('[guided-legal] boardSource === legalitySource = true', {
          stepIndex: lessonStepIndex,
          boardState: serializeGhostBoardState(match.board),
        });
      }
      if (isDailyFritzMode) {
        traceDailyFritzEvent('[state] legalMoves computed', {
          count: moves.length,
          handOver: match.handOver,
          gameOver: match.gameOver,
          currentPlayer: match.currentPlayer,
        });
      }
      return moves;
    } catch (e) {
      console.error('[guided-snapshot] getLegalMoves threw:', e);
      return [];
    }
  }, [isDailyFritzMode, isGuidedV1OnlineMode, lessonStepIndex, match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);
  const playableTileKeys = useMemo(() => buildPlayableTileKeys(userPlayMoves), [userPlayMoves]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    console.log('[hand-legality]', {
      userLegalMoves,
      userPlayMoves,
      playableTileKeys: [...playableTileKeys],
      hand: match.players.you.hand.map((t) => `${t.low}-${t.high}`),
    });
  }, [
    match.currentPlayer,
    match.handOver,
    match.gameOver,
    match.players.you.hand,
    userLegalMoves,
    userPlayMoves,
    playableTileKeys,
  ]);
  const guidedRecordFritzPalette = useMemo(() => buildDoubleSixTiles(), []);
  const botLegalMoves = useMemo(() => {
    if (!wantsOriginalGuidedRecordMode) return [];
    if (match.currentPlayer !== 'bot' || match.handOver || match.gameOver) return [];
    try {
      return getLegalMoves({ ...match, currentPlayer: 'bot' }, 'bot');
    } catch {
      return [];
    }
  }, [match, wantsOriginalGuidedRecordMode]);
  const botPlayMoves = useMemo(() => asPlayMoves(botLegalMoves), [botLegalMoves]);
  const getGuidedRecordBotMovesForTile = useCallback((tile: Tile): Move[] => {
    if (!wantsOriginalGuidedRecordMode || match.handOver || match.gameOver) return [];
    try {
      const simulatedBotState: BotMatchState = {
        ...match,
        currentPlayer: 'bot',
        players: {
          ...match.players,
          bot: {
            ...match.players.bot,
            hand: match.players.bot.hand.some((handTile) => tileEquals(handTile, tile))
              ? match.players.bot.hand
              : [...match.players.bot.hand, tile],
          },
        },
      };
      return asPlayMoves(getLegalMoves(simulatedBotState, 'bot')).filter(
        (candidate) => candidate.tile && tileEquals(candidate.tile, tile),
      );
    } catch {
      return [];
    }
  }, [match, wantsOriginalGuidedRecordMode]);
  /** Event at the playback cursor — may be player or fritz. */
  const currentV2CursorEvent = useMemo(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return null;
    return frozenV2Lesson.events[guidedV2EventIndex] ?? null;
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine]);

  /**
   * The player event the UI is waiting on right now (cursor must be on a player event).
   * Do not use nextPlayerEvent() here — that looks ahead and surfaces the next
   * coached tile while Fritz is still resolving.
   */
  const currentExpectedV2PlayerEvent = useMemo(() => {
    if (!currentV2CursorEvent || currentV2CursorEvent.actor !== 'player') return null;
    return currentV2CursorEvent;
  }, [currentV2CursorEvent]);

  const activePlacementMoves = useMemo(
    () =>
      isGuidedV2Mode && !isGuidedV2OffLine && currentExpectedV2PlayerEvent?.action === 'play'
        ? userPlayMoves.filter((move) => {
            if (!move.tile || !currentExpectedV2PlayerEvent.tile) return false;
            if (toTileKey(move.tile) !== currentExpectedV2PlayerEvent.tile) return false;
            if (currentExpectedV2PlayerEvent.position) {
              return move.position === currentExpectedV2PlayerEvent.position;
            }
            return true;
          })
        : wantsOriginalGuidedRecordMode && selectedController === 'bot' && selectedTile
        ? getGuidedRecordBotMovesForTile(selectedTile)
        : wantsOriginalGuidedRecordMode && selectedController === 'bot'
          ? botPlayMoves
          : userPlayMoves,
    [
      botPlayMoves,
      currentExpectedV2PlayerEvent,
      getGuidedRecordBotMovesForTile,
      isGuidedV2Mode,
      isGuidedV2OffLine,
      selectedController,
      selectedTile,
      userPlayMoves,
      wantsOriginalGuidedRecordMode,
    ],
  );

  useEffect(() => {
    if (!isDailyFritzMode) return;
    traceDailyFritzEvent('[state] selectedTile set', {
      tile: selectedTile ? toTileKey(selectedTile) : null,
    });
  }, [isDailyFritzMode, selectedTile]);

  useEffect(() => {
    if (selectedTile == null) {
      setSelectedController(null);
    }
  }, [selectedTile]);

  // Guided mode: evaluate all play moves using previewPlayMove (unified scoring source),
  // then recommend the best placement with opening-move awareness.
  const guidedCoachTip = useMemo((): GuidedCoachTip | null => {
    if (!isGuidedMode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return null;
    // In snapshot mode the LessonCoachPanel drives best-move via authored chosenMove.
    // Suppress all live AI tip computation — it would recommend the engine's choice,
    // not the authored lesson move.
    if (isGuidedV1OnlineMode) return null;
    if (userPlayMoves.length === 0) return null;

    // Evaluate ALL play moves via previewPlayMove — single source of truth for scoring
    const allEvaluated = userPlayMoves
      .filter((m) => m.tile)
      .map((move) => {
        const preview = previewPlayMove(match, 'you', move);
        return {
          move,
          tile: move.tile as Tile,
          pts: preview?.immediateScore ?? 0,
          openSum: preview?.openSum ?? 0,
        };
      });

    if (allEvaluated.length === 0) return null;

    const isOpeningMove = (match.board?.mainLine.length ?? 0) === 0;

    if (isOpeningMove) {
      // On opening, scoring moves take priority over pure doubles
      const scoring = allEvaluated.filter((e) => e.pts > 0);
      scoring.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
      if (scoring.length > 0) {
        const best = scoring[0]!;
        return {
          tile: best.tile,
          bestMove: best.move,
          pts: best.pts,
          openSum: best.openSum,
          isOnlyPlay: allEvaluated.length === 1,
          isControlChoice: false,
          placementCount: scoring.length,
          isOpeningMove: true,
          isOpeningDouble: false,
        };
      }
      // No scoring — only doubles available
      const doubles = allEvaluated.filter((e) => isDouble(e.tile));
      doubles.sort((a, b) => b.tile.high - a.tile.high);
      if (doubles.length > 0) {
        const best = doubles[0]!;
        return {
          tile: best.tile,
          bestMove: best.move,
          pts: 0,
          openSum: best.openSum,
          isOnlyPlay: allEvaluated.length === 1,
          isControlChoice: false,
          placementCount: doubles.length,
          isOpeningMove: true,
          isOpeningDouble: true,
        };
      }
      return null;
    }

    // Only-move: no AI needed
    if (allEvaluated.length === 1) {
      const e = allEvaluated[0]!;
      return {
        tile: e.tile,
        bestMove: e.move,
        pts: e.pts,
        openSum: e.openSum,
        isOnlyPlay: true,
        isControlChoice: false,
        placementCount: 1,
        isOpeningMove: false,
        isOpeningDouble: false,
      };
    }

    // Multi-play: get AI tile recommendation, then pick best placement for it
    const mirroredState: BotMatchState = {
      ...match,
      currentPlayer: 'bot',
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
      players: {
        you: match.players.bot,
        bot: match.players.you,
      },
    };
    const botChoice = chooseBotMove(toBotVisibleState(mirroredState), 'master');
    if (!botChoice?.move.tile) return null;

    const recommendedTile = botChoice.move.tile as Tile;
    let tileEvals = allEvaluated.filter((e) => tileEquals(e.tile, recommendedTile));
    if (tileEvals.length === 0) return null;

    tileEvals.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
    const best = tileEvals[0]!;

    // Assertion: if AI recommends a non-scoring tile but a scoring tile exists, override
    if (best.pts === 0) {
      const scoringEvals = allEvaluated.filter((e) => e.pts > 0);
      if (scoringEvals.length > 0) {
        scoringEvals.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
        const override = scoringEvals[0]!;
        const overridePlacements = allEvaluated.filter((e) => tileEquals(e.tile, override.tile));
        overridePlacements.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
        const bestOverride = overridePlacements[0]!;
        return {
          tile: bestOverride.tile,
          bestMove: bestOverride.move,
          pts: bestOverride.pts,
          openSum: bestOverride.openSum,
          isOnlyPlay: false,
          isControlChoice: false,
          placementCount: overridePlacements.length,
          isOpeningMove: false,
          isOpeningDouble: false,
        };
      }
    }

    const isControlChoice =
      tileEvals.length > 1 &&
      best.pts === 0 &&
      tileEvals.some((e) => e.openSum !== best.openSum);

    return {
      tile: recommendedTile,
      bestMove: best.move,
      pts: best.pts,
      openSum: best.openSum,
      isOnlyPlay: false,
      isControlChoice,
      placementCount: tileEvals.length,
      isOpeningMove: false,
      isOpeningDouble: false,
    };
  }, [isGuidedMode, match, userPlayMoves]);

  // Per-tile max points for green/gold highlighting — uses same previewPlayMove as coach tip
  const guidedScoringTiles = useMemo((): Map<string, number> => {
    if (!isGuidedMode || match.currentPlayer !== 'you') return new Map();
    const map = new Map<string, number>();
    for (const move of userPlayMoves) {
      if (!move.tile) continue;
      const preview = previewPlayMove(match, 'you', move);
      const pts = preview?.immediateScore ?? 0;
      if (pts > 0) {
        const key = `${move.tile.low}-${move.tile.high}`;
        map.set(key, Math.max(map.get(key) ?? 0, pts));
      }
    }
    return map;
  }, [isGuidedMode, match, userPlayMoves]);

  /**
   * The authored step that matches the current board position.
   *
   * PRIMARY lookup: boardState match (preferred over stepIndex matching) so that
   * stale draft steps in the frozen lesson — which share a boardState with the
   * real authored step but have chosenMove===null — are skipped automatically.
   * FALLBACK: stepIndex match, then any step.
   *
   * This makes LessonCoachPanel correct even if the frozen lesson was authored
   * before the stepIdx-locking fix and contains null-chosenMove drafts.
   */
  const currentTranscriptTurn = useMemo((): GuidedTurn | null => {
    if (!isGuidedTranscriptMode || !guidedTranscript || match.handOver || match.gameOver) return null;
    return guidedTranscript.turns.find((turn) => turn.stepIndex === lessonStepIndex) ?? null;
  }, [guidedTranscript, isGuidedTranscriptMode, lessonStepIndex, match.gameOver, match.handOver]);

  const currentLessonStep = useMemo(() => {
    if (!isGuidedMode || !frozenLesson || match.handOver || match.gameOver) {
      return null;
    }
    return getGuidedV1AuthoredStepByIndex(frozenLesson, lessonStepIndex);
  }, [isGuidedMode, frozenLesson, match.handOver, match.gameOver, lessonStepIndex]);

  /** Coaching text for the V2 cursor player event only (never the next queued player event). */
  const currentV2CoachingText = useMemo(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return '';
    return currentExpectedV2PlayerEvent?.coachingText ?? '';
  }, [isGuidedV2Mode, frozenV2Lesson, isGuidedV2OffLine, currentExpectedV2PlayerEvent]);

  const authoringV2PlayerMoveIndex = useMemo(
    () => authoringV2Events.filter((event) => event.actor === 'player' && event.action === 'play').length,
    [authoringV2Events],
  );

  // [guided-note-align] DIAGNOSTICS
  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    const currentEvent = frozenV2Lesson.events[guidedV2EventIndex];
    if (!currentEvent) return;

    // Only log when a player decision is up next (or currently waiting)
    const nextPlayerEv = nextPlayerEvent(frozenV2Lesson.events, guidedV2EventIndex);
    if (!nextPlayerEv) return;

    // We only want to log once per eventIndex wait state
    if (currentEvent.eventIndex !== nextPlayerEv.eventIndex) return;

    const uiStepNumber = frozenV2Lesson.events
      .slice(0, guidedV2EventIndex)
      .filter((e) => e.actor === 'player' && e.action === 'play').length;
      
    const board = parseLessonV2BoardState(currentEvent.boardAfter);

    console.log('[guided-note-align]', JSON.stringify({
      uiStepNumber,
      eventsArrayIndex: guidedV2EventIndex,
      eventIndex: currentEvent.eventIndex,
      actor: currentEvent.actor,
      action: currentEvent.action,
      tile: currentEvent.tile,
      placementSide: currentEvent.position,
      coachingTextStart: (currentEvent.coachingText || '').substring(0, 80),
      bestMoveTile: currentExpectedV2PlayerEvent?.tile,
      playerHandTiles: currentEvent.playerHandAfter,
    }));
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, currentExpectedV2PlayerEvent]);

  const ghostSuggestedPlayerMove = useMemo(
    () =>
      isGhostMode
        ? resolveGhostMove({
            state: match,
            player: 'you',
            legalMoves: userPlayMoves,
            profile: ghostProfile,
          })
        : null,
    [ghostProfile, isGhostMode, match, userPlayMoves],
  );

  const beginGuidedV1Replay = useCallback((step: AuthoredStep, playedTile: Tile | null) => {
    const replyEvents = step.fritzReplyEvents ?? [];
    if (replyEvents.length === 0) {
      pushToast('This lesson step is missing Fritz reply events.');
      setIsOffAuthoredLine(true);
      return;
    }
    setSelectedTile(null);
    flashLastPlayed(playedTile);
    setGuidedV1Replay({ stepIndex: step.stepIndex, replyIndex: 0 });
    setMatch((prev) => ({
      ...prev,
      currentPlayer: 'bot',
    }));
  }, [flashLastPlayed, pushToast]);

  const acceptGuidedTranscriptTurn = useCallback((turn: GuidedTurn, playedTile: Tile | null) => {
    const playerState = parseGuidedTranscriptState(turn.playerStateAfter);
    if (!playerState) {
      pushToast('This transcript turn is missing a valid player state.');
      setIsOffAuthoredLine(true);
      return;
    }
    setSelectedTile(null);
    flashLastPlayed(playedTile);
    setMatch(playerState);
    if (turn.fritzReplies.length > 0) {
      setGuidedV1Replay({ stepIndex: turn.stepIndex, replyIndex: 0 });
      return;
    }
    setLessonStepIndex((prev) => prev + 1);
  }, [flashLastPlayed, pushToast]);

  const notifyBotActionResult = useCallback((result: BotActionResult) => {
    if (result.handEnded) {
      logHandLifecycle({
        phase: 'resolving-hand',
        previousPhase: handLifecyclePhaseRef.current,
        mode,
        handNumber: result.state.handNumber,
        detail: {
          winner: result.handEnded.winner,
          reason: result.handEnded.reason,
          gameOver: result.state.gameOver,
        },
      });
      handLifecyclePhaseRef.current = 'resolving-hand';
      if (isDailyFritzMode) {
        lastDailyFlowLabelRef.current = 'hand-complete';
        dailyFritzMinAdvanceAtRef.current =
          Date.now()
          + (resolveHandRevealScheduleMode(true) === 'immediate' ? 0 : DAILY_FRITZ_REVEAL_DELAY_MS)
          + DAILY_FRITZ_AUTO_ADVANCE_MS;
        dailyFritzDebugLog('[daily-flow] hand complete detected', {
          handNumber: result.state.handNumber,
          winner: result.handEnded.winner,
          reason: result.handEnded.reason,
          pointsAwarded: result.handEnded.pointsAwarded,
          yourScore: result.state.players.you.score,
          botScore: result.state.players.bot.score,
          isGameOver: result.state.gameOver,
        });
        dailyFritzDebugLog('[daily-flow] hand scoring applied', {
          pointsAwarded: result.handEnded.pointsAwarded,
          winner: result.handEnded.winner,
          yourScore: result.state.players.you.score,
          botScore: result.state.players.bot.score,
        });
      }
      // Kick off the next-hand fetch immediately so it's ready by the time the
      // 5-second reveal window closes.  Store both the promise and its settled
      // result so advanceHand can transition instantly if already resolved.
      if (isDailyFritzMode && dailyFritzPackage && !result.state.gameOver) {
        const gameNumber = dailyFritzPackage.current_game_number ?? 1;
        dailyFritzDebugLog('[daily-fritz-hand] requesting next hand', {
          source: 'prefetch',
          gameNumber,
          completedHandIndex: dailyFritzHandIndex,
          yourScore: result.state.players.you.score,
          fritzScore: result.state.players.bot.score,
        });
        const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const cache: {
          promise: Promise<DailyFritzNextHandResponse>;
          result: DailyFritzNextHandResponse | null;
          error: unknown;
          startedAt: number;
        } = {
          promise: nextDailyFritzHand({
            attemptId: dailyFritzPackage.attempt_id,
            verifiedMatchId: dailyFritzPackage.verified_match_id,
            runDate: dailyFritzPackage.run_date,
            gameNumber,
            completedHandIndex: dailyFritzHandIndex,
            completedHandScores: {
              you: result.state.players.you.score,
              fritz: result.state.players.bot.score,
            },
            timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
          }),
          result: null,
          error: null,
          startedAt: requestStartedAt,
        };
        cache.promise
          .then((r) => {
            const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            dailyFritzDebugLog('[daily-fritz-hand] next hand response', {
              source: 'prefetch',
              gameNumber: r.game_number ?? gameNumber,
              currentHandIndex: r.current_hand_index,
              replayed: Boolean(r.replayed),
              ignored: Boolean(r.ignored),
              durationMs: Number((requestEndedAt - requestStartedAt).toFixed(1)),
            });
            cache.result = r;
          })
          .catch((e) => {
            const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (shouldLogDailyFritzDebug()) {
              console.warn('[daily-fritz-hand] next hand error', {
                source: 'prefetch',
                gameNumber,
                error: e instanceof Error ? e.message : String(e),
                durationMs: Number((requestEndedAt - requestStartedAt).toFixed(1)),
              });
            }
            cache.error = e;
          });
        dailyFritzNextHandRef.current = cache;
      }
      flashLastPlayed(null);
      const handEndedData = result.handEnded;
      const yourRemainingTiles = result.state.players.you.hand;
      const botRemainingTiles = result.state.players.bot.hand;
      const revealPayload: BotHandReveal = {
        winner: handEndedData.winner,
        reason: handEndedData.reason,
        pointsAwarded: handEndedData.pointsAwarded,
        loserPips: handEndedData.loserPips,
        calcText: handEndedData.calcText,
        yourRemainingTiles,
        botRemainingTiles,
      };
      pendingHandRevealRef.current = {
        handNumber: result.state.handNumber,
        reveal: revealPayload,
      };
      const showReveal = () => {
        const live = matchRef.current;
        if (!shouldShowHandRevealForHand(live.handNumber, result.state.handNumber)) {
          handRevealTimerRef.current = null;
          logDailyFritzHandBreadcrumb('reveal-skipped', {
            liveHandNumber: live.handNumber,
            endedHandNumber: result.state.handNumber,
            mode: isDailyFritzMode ? 'daily-fritz' : mode,
          });
          return;
        }
        if (isDailyFritzMode) {
          lastDailyFlowLabelRef.current = 'reveal-start';
          dailyFritzDebugLog('[daily-flow] reveal start', {
            handNumber: result.state.handNumber,
            handTransitionInFlight: handTransitionInFlightRef.current,
            prefetchReady: dailyFritzNextHandRef.current?.result != null,
            schedule: resolveHandRevealScheduleMode(true),
          });
        }
        setHandReveal(revealPayload);
        handRevealTimerRef.current = null;
      };
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      if (resolveHandRevealScheduleMode(isDailyFritzMode) === 'immediate') {
        showReveal();
      } else {
        handRevealTimerRef.current = window.setTimeout(showReveal, DAILY_FRITZ_REVEAL_DELAY_MS);
      }
      if (result.handEnded.reason === 'blocked') {
        queueSound(() => playBlockedSound(isMuted), 0);
      }
      if (!result.state.gameOver) {
        if (result.handEnded.winner === 'you') {
          queueSound(() => playHandWinSound(isMuted), 320);
        } else {
          queueSound(() => playHandLoseSound(isMuted), 320);
        }
      }
    }
    if (result.scored) {
      const points = result.scored.points;
      showScoreToast(result.scored.player, points);
      queueSound(() => playScoreSound(points, isMuted), 80);
    }
    if (result.drew && result.drew.player === 'you') {
      showBoardToast('You drew a tile', 'bot');
    }
    const msg = toastFromResult(result, opponentLabel);
    if (msg) pushToast(msg);
  }, [
    dailyFritzPackage,
    dailyFritzHandIndex,
    isDailyFritzMode,
    isMuted,
    opponentLabel,
    pushToast,
    showBoardToast,
    showScoreToast,
  ]);

  const logFritzFairnessDecision = useCallback((state: BotMatchState, choice: BotChoice | null) => {
    if (!choice?.move) return;
    fairnessLog('fritz-move', {
      handNumber: state.handNumber,
      turnIndex: state.turnIndex,
      legalMoves: getLegalMoves(state, 'bot')
        .filter((m) => m.type === 'play')
        .map((m) => ({
          tile: m.tile ? `${m.tile.low}-${m.tile.high}` : null,
          position: m.position ?? null,
        })),
      chosen: choice.move.tile
        ? { tile: `${choice.move.tile.low}-${choice.move.tile.high}`, position: choice.move.position ?? null }
        : choice.move.type,
      boneyardCount: state.boneyard.length,
    });
  }, []);

  const applyAndNotify = useCallback((result: BotActionResult) => {
    const adjustedState = result.state;

    setMatch((prev) => {
      const trackedDraw = result.drew?.player === 'you' ? 1 : 0;
      const trackedPass = result.passed?.player === 'you' ? 1 : 0;
      if (trackedDraw === 0 && trackedPass === 0) {
        return adjustedState;
      }

      const openEnds = adjustedState.board
        ? getMatchableOpenEnds(adjustedState.board).map((end) => end.matchValue)
        : [];

      return {
        ...adjustedState,
        opponentPassedOnEnds: [
          ...(prev.opponentPassedOnEnds ?? []),
          ...Array.from({ length: trackedDraw + trackedPass }, () => openEnds).flat(),
        ],
        opponentDrawCount: (prev.opponentDrawCount ?? 0) + trackedDraw,
        opponentKnownMissing: prev.opponentKnownMissing ?? adjustedState.opponentKnownMissing ?? [],
      };
    });
    if (result.drew) {
      fairnessLog('draw', {
        player: result.drew.player,
        tile: `${result.drew.tile.low}-${result.drew.tile.high}`,
        handNumber: adjustedState.handNumber,
        boneyardRemaining: adjustedState.boneyard.length,
      });
    }
    notifyBotActionResult({ ...result, state: adjustedState });
  }, [isDailyFritzMode, notifyBotActionResult]);

  const triggerDrawStepAnimation = useCallback((drawer: BotPlayerId, nextState: BotMatchState) => {
    if (drawer === 'you') {
      const pulseIndex = nextState.players.you.hand.length - 1;
      if (pulseIndex >= 0) {
        setDrawPulseIndex(pulseIndex);
        setTimeout(() => setDrawPulseIndex((prev) => (prev === pulseIndex ? null : prev)), 420);
      }
    }

    const boneyardEl = boneyardRef.current ?? guidedBoneyardAnchorRef.current;
    const targetEl =
      drawer === 'you'
        ? handAreaRef.current
        : opponentPillRef.current ?? guidedFritzAnchorRef.current;
    if (!boneyardEl || !targetEl) {
      logDailyFritzHandBreadcrumb('draw-fallback', {
        drawer,
        hasBoneyardRef: Boolean(boneyardEl),
        hasTargetRef: Boolean(targetEl),
        handSize: drawer === 'you' ? nextState.players.you.hand.length : nextState.players.bot.hand.length,
        usedPulse: drawer === 'you',
      });
      if (drawer === 'bot') {
        showBoardToast(`${opponentLabel} drew a tile`, 'bot');
      }
      return;
    }
    const from = boneyardEl.getBoundingClientRect();
    const to = targetEl.getBoundingClientRect();
    const id = ++flyingTileIdRef.current;
    setFlyingTiles((prev) => [
      ...prev,
      {
        x: from.left + from.width / 2,
        y: from.top + from.height / 2,
        toX: to.left + to.width / 2,
        toY: to.top + to.height / 2,
        id,
      },
    ]);
    setTimeout(() => setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id)), 1800);
    logLayoutDebug(drawer === 'you' ? 'player-draw' : 'fritz-draw', {
      rootRef,
      boardStageRef,
      handAreaRef,
      flyingTileParent: typeof document !== 'undefined'
        ? document.body.querySelector('.flying-tile-overlay')
        : null,
    });
  }, [opponentLabel, showBoardToast]);

  const scheduleDrawStepAnimation = useCallback(
    (drawer: BotPlayerId, nextState: BotMatchState) => {
      window.requestAnimationFrame(() => {
        triggerDrawStepAnimation(drawer, nextState);
      });
    },
    [triggerDrawStepAnimation],
  );

  const runDrawSequenceLocal = useCallback(
    async (
      initialState: BotMatchState,
      player: BotPlayerId,
      token?: LocalRunToken,
      onStep?: (step: {
        actionKind: 'draw' | 'pass';
        beforeState: BotMatchState;
        result: BotActionResult;
      }) => void,
    ): Promise<BotActionResult> => {
      let current = initialState;
      let drewAny = false;

      while (asPlayMoves(getLegalMoves(current, player)).length === 0) {
        if (token && !isLocalRunCurrent(token)) break;
        const beforeDraw = current;
        const step = drawOne(beforeDraw, player);
        if (!step.drew) break;
        onStep?.({ actionKind: 'draw', beforeState: beforeDraw, result: step });
        drewAny = true;
        current = step.state;
        if (token && !isLocalRunCurrent(token)) break;
        setMatch(current);
        queueSound(() => playDrawSound(isMuted), 0);
        triggerDrawStepAnimation(player, current);
        await new Promise<void>((resolve) => setTimeout(resolve, DRAW_STEP_MS));
        if (token && !isLocalRunCurrent(token)) break;
      }

      if (asPlayMoves(getLegalMoves(current, player)).length === 0) {
        const beforePass = current;
        const passResult = passTurn(beforePass, player);
        onStep?.({ actionKind: 'pass', beforeState: beforePass, result: passResult });
        return {
          ...passResult,
          drew: drewAny ? { player, tile: current.players[player].hand[current.players[player].hand.length - 1] } : undefined,
        };
      }

      return {
        state: current,
        drew: drewAny ? { player, tile: current.players[player].hand[current.players[player].hand.length - 1] } : undefined,
      };
    },
    [triggerDrawStepAnimation, isMuted, isLocalRunCurrent],
  );

  /**
   * Authoring: record the current player turn as an authored step.
   * Called whenever the player completes an action (play, draw-to-pass, pass).
   * @param chosenMove  Tile key ("2|4" or "2|4:left"), "draw", or "pass"
   */
  const recordAuthoringStep = useCallback(
    (chosenMove: string | null) => {
      if (!isAuthoringMode) return;
      const pre = authoringPreMoveRef.current;
      // Use the stepIdx locked at turn-start, not authoringSteps.length which shifts
      // each time Save-Note is pressed during this turn.
      const stepIdx = pre?.stepIdx ?? authoringSteps.length;
      // The new step is created with EMPTY fritzReplyEvents. Fritz's reply to
      // THIS move is captured during the following bot turn into
      // fritzSessionReplyRef and flushed into this step by the flush effect
      // when the player's next turn begins.
      const newStep: AuthoredStep = {
        stepIndex: stepIdx,
        handNumber: pre?.handNumber ?? match.handNumber,
        boardState: pre?.boardState ?? serializeGhostBoardState(match.board),
        playerHand: pre?.playerHand ?? match.players.you.hand.map(toTileKey),
        chosenMove,
        coachingText: authoringNoteText,
        fritzReplyEvents: [],
        matchStateJson: pre?.matchStateJson ?? null,
      };
      console.log('[guided-capture] authored step created', {
        stepIndex: stepIdx,
        chosenMove,
        handNumber: newStep.handNumber,
      });
      // Pending events from the previous Fritz chain (if any) should flush to
      // the PREVIOUS step, not this new one. Drain the ref here and attach to
      // the most recent real step before inserting the new one.
      const pendingEvents =
        fritzSessionReplyRef.current.length > 0 ? [...fritzSessionReplyRef.current] : null;
      fritzSessionReplyRef.current = [];
      setAuthoringSteps((prev) => {
        let base = prev;
        if (pendingEvents) {
          let targetIdx = -1;
          for (let i = base.length - 1; i >= 0; i -= 1) {
            if (base[i]!.chosenMove !== null) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx !== -1) {
            const target = base[targetIdx]!;
            const updated: AuthoredStep = { ...target, fritzReplyEvents: pendingEvents };
            base = [...base];
            base[targetIdx] = updated;
            console.log('[guided-capture] pre-flush fritz reply events', {
              stepIndex: target.stepIndex,
              eventCount: pendingEvents.length,
            });
          }
        }
        // Replace if same stepIndex already exists (e.g. note-only save followed by play)
        const existingIdx = base.findIndex((s) => s.stepIndex === stepIdx);
        if (existingIdx >= 0) {
          const next = [...base];
          next[existingIdx] = {
            ...next[existingIdx],
            ...newStep,
            fritzReplyEvents: next[existingIdx]?.fritzReplyEvents ?? newStep.fritzReplyEvents,
          };
          return next;
        }
        return [...base, newStep];
      });
    },
    [isAuthoringMode, authoringSteps.length, authoringNoteText, match.handNumber, match.board, match.players.you.hand], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Authoring: save the current textarea note without recording a chosen move.
   * Creates a draft step or updates an existing one.
   */
  const saveAuthoringNoteOnly = useCallback(() => {
    if (!isAuthoringMode) return;
    const pre = authoringPreMoveRef.current;
    // Use the stepIdx locked at turn-start, not authoringSteps.length.
    const stepIdx = pre?.stepIdx ?? authoringSteps.length;
    const draftStep: AuthoredStep = {
      stepIndex: stepIdx,
      handNumber: pre?.handNumber ?? match.handNumber,
      boardState: pre?.boardState ?? serializeGhostBoardState(match.board),
      playerHand: pre?.playerHand ?? match.players.you.hand.map(toTileKey),
      chosenMove: null,
      coachingText: authoringNoteText,
    };
    setAuthoringSteps((prev) => {
      const existingIdx = prev.findIndex((s) => s.stepIndex === stepIdx);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = draftStep;
        return next;
      }
      return [...prev, draftStep];
    });
  }, [isAuthoringMode, authoringSteps.length, authoringNoteText, match.handNumber, match.board, match.players.you.hand]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enableGuidedMatchCandidateCapture) {
      guidedMatchCaptureRef.current = null;
      setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(null));
      setGuidedMatchCandidateSaveStatus(null);
      return;
    }
    const capture = createGuidedMatchCapture(match);
    guidedMatchCaptureRef.current = capture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(capture));
    setGuidedMatchCandidateSaveStatus(null);
  }, [activeLocalMatchId, enableGuidedMatchCandidateCapture]); // eslint-disable-line react-hooks/exhaustive-deps

  const captureGuidedMatchCandidateAction = useCallback((
    actor: 'player' | 'fritz',
    actionKind: 'tile-play' | 'draw' | 'pass',
    beforeState: BotMatchState,
    result: BotActionResult,
    move?: Move | null,
  ) => {
    if (!enableGuidedMatchCandidateCapture || !guidedMatchCaptureRef.current) return;
    const nextCapture = recordGuidedMatchCandidateAction(
      guidedMatchCaptureRef.current,
      actor,
      actionKind,
      beforeState,
      result,
      move,
    );
    guidedMatchCaptureRef.current = nextCapture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(nextCapture));
    if (result.state.gameOver) {
      const validation = validateGuidedMatchCandidate(nextCapture.candidate, 'draft');
      if (!validation.ok && import.meta.env.DEV) {
        console.warn('[guided-match-capture] draft validation issues', validation.issues);
      }
    }
  }, [enableGuidedMatchCandidateCapture]);

  const captureGuidedMatchCandidateNextHand = useCallback((
    previousState: BotMatchState,
    nextState: BotMatchState,
  ) => {
    if (!enableGuidedMatchCandidateCapture || !guidedMatchCaptureRef.current) return;
    const nextCapture = recordGuidedMatchCandidateNextHand(
      guidedMatchCaptureRef.current,
      previousState,
      nextState,
    );
    guidedMatchCaptureRef.current = nextCapture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(nextCapture));
  }, [enableGuidedMatchCandidateCapture]);

  const isEmergencySaveableGuidedMatchCandidate = useCallback((
    candidate: GuidedMatchCaptureState['candidate'],
  ) => Boolean(
    candidate.candidateId &&
      candidate.initialMatchSnapshot &&
      candidate.finalMatchSnapshot &&
      candidate.events.length > 0 &&
      candidate.targetScore === 60 &&
      candidate.opponent === 'standard-fritz' &&
      candidate.dealSize === 7 &&
      (candidate.result === 'won' || candidate.result === 'lost'),
  ), []);

  const saveGuidedMatchCandidate = useCallback(() => {
    const candidate = guidedMatchCaptureRef.current?.candidate ?? null;
    if (!candidate) {
      setGuidedMatchCandidateSaveStatus('No candidate captured.');
      return;
    }
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    if (!validation.ok && !isEmergencySaveableGuidedMatchCandidate(candidate)) {
      setGuidedMatchCandidateSaveStatus(`Candidate has ${validation.issues.length} draft issue(s).`);
      if (import.meta.env.DEV) {
        console.warn('[guided-match-capture] save blocked by draft validation', validation.issues);
      }
      return;
    }
    const candidateToSave = {
      ...candidate,
      updatedAt: new Date().toISOString(),
      validationStatus: validation.ok ? 'draft-valid' as const : 'draft-with-issues' as const,
      validationIssues: validation.issues,
    };
    const saved = upsertGuidedMatchCandidate(candidateToSave);
    setGuidedMatchCandidateSaveStatus(
      saved
        ? validation.ok
          ? 'Guided Match candidate saved.'
          : `Saved with ${validation.issues.length} draft issues`
        : 'Candidate save failed.',
    );
    if (!validation.ok && import.meta.env.DEV) {
      console.warn('[guided-match-capture] saved raw candidate with draft validation issues', validation.issues);
    }
  }, [isEmergencySaveableGuidedMatchCandidate]);

  const copyGuidedMatchCandidate = useCallback(async () => {
    const candidate = guidedMatchCaptureRef.current?.candidate ?? null;
    if (!candidate) {
      setGuidedMatchCandidateSaveStatus('No candidate captured.');
      return;
    }
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    if (!validation.ok && import.meta.env.DEV) {
      console.warn('[guided-match-capture] draft copy validation issues', validation.issues);
    }
    const copied = await copyGuidedMatchCandidateJson(candidate);
    setGuidedMatchCandidateSaveStatus(copied ? 'Draft candidate JSON copied.' : 'Candidate copy failed.');
  }, []);

  const onPositionClick = useCallback((position: PlacementPosition) => {
    const actingPlayer: BotPlayerId =
      wantsOriginalGuidedRecordMode && selectedController === 'bot' ? 'bot' : 'you';
    const actingMoves =
      actingPlayer === 'bot' && selectedTile
        ? getGuidedRecordBotMovesForTile(selectedTile)
        : actingPlayer === 'bot'
          ? botPlayMoves
          : userPlayMoves;
    console.log('[guided-path-root]', {
      position,
      selectedTile: selectedTile ? toTileKey(selectedTile) : null,
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
    });
    console.log('[guided-click-enter]', {
      selectedTile: selectedTile ? toTileKey(selectedTile) : null,
      position,
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
      isGuidedV1OnlineMode,
      isOffAuthoredLine,
    });
    if (isDailyFritzMode) {
      traceDailyFritzEvent('[input] placement click', {
        position,
        selectedTile: selectedTile ? toTileKey(selectedTile) : null,
        currentPlayer: match.currentPlayer,
        handOver: match.handOver,
        gameOver: match.gameOver,
      });
    }
    if (match.currentPlayer !== actingPlayer) {
      console.log('[guided-click-blocked] reason = current-player-not-you');
      return;
    }
    if (!selectedTile) {
      console.log('[guided-click-blocked] reason = no-selected-tile');
      return;
    }
    if (match.handOver) {
      console.log('[guided-click-blocked] reason = hand-over');
      return;
    }
    if (match.gameOver) {
      console.log('[guided-click-blocked] reason = game-over');
      return;
    }
    const move = findMoveForSelection(actingMoves, selectedTile, position);
    const expectedMoveForLog = currentLessonStep?.chosenMove ?? null;
    const clickedMoveForLog = move?.tile
      ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
      : null;
    console.log('[guided-click-move]', {
      foundMove: Boolean(move),
      clickedMove: clickedMoveForLog,
      expectedMove: expectedMoveForLog,
    });
    if (!move) {
      console.log('[guided-click-blocked] reason = no-matching-move');
      return;
    }
    if (wantsOriginalGuidedRecordMode && actingPlayer === 'bot') {
      const simulatedBotState: BotMatchState = {
        ...match,
        currentPlayer: 'bot',
        players: {
          ...match.players,
          bot: {
            ...match.players.bot,
            hand: move.tile && match.players.bot.hand.some((handTile) => tileEquals(handTile, move.tile as Tile))
              ? match.players.bot.hand
              : move.tile
                ? [...match.players.bot.hand, move.tile as Tile]
                : match.players.bot.hand,
          },
        },
      };
      const result = applyPlayMove(simulatedBotState, 'bot', move);
      setMatch(result.state);
      notifyBotActionResult(result);
      if (move.tile) {
        flashLastPlayed(move.tile);
        queueSound(() => playTileSound('deal', isMuted), 0);
      }
      appendGuidedDraftFritzReply({
        type: 'play',
        tile: move.tile ? toTileKey(move.tile) : undefined,
        position: move.position ?? undefined,
        pointsScored: result.scored?.player === 'bot' ? result.scored.points : 0,
        handEnded: result.handEnded,
      }, result.state);
      setSelectedTile(null);
      setSelectedController(null);
      return;
    }
    if (isGuidedTranscriptMode && guidedTranscript) {
      const turn = currentTranscriptTurn;
      const clickedMove = move.tile
        ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
        : null;
      const expected = turn?.expectedPlayerMove ?? null;
      const expectedMove = expected
        ? expected.type === 'play'
          ? `${expected.tile ?? ''}${expected.position ? `:${expected.position}` : ''}`
          : expected.type
        : null;
      if (!turn || !expected || expected.type !== 'play') {
        pushToast('This transcript turn does not accept a tile placement.');
        setIsOffAuthoredLine(true);
        return;
      }
      if (clickedMove !== expectedMove) {
        setIsOffAuthoredLine(true);
        pushToast('Off lesson line. Guided playback stopped.');
        return;
      }
      acceptGuidedTranscriptTurn(turn, move.tile ?? null);
      return;
    }
    if (isGuidedV1MinimalMode && frozenLesson) {
      const step = currentLessonStep;
      const expectedMove = step?.chosenMove ?? null;
      const clickedMove = move.tile
        ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
        : null;
      if (!step || !expectedMove || expectedMove === 'draw' || expectedMove === 'pass') {
        pushToast('This lesson step does not have an authored tile play.');
        setIsOffAuthoredLine(true);
        return;
      }
      if (clickedMove !== expectedMove) {
        setIsOffAuthoredLine(true);
        pushToast('Off lesson line. Guided playback stopped.');
        return;
      }
      beginGuidedV1Replay(step, move.tile ?? null);
      return;
    }
    if (frozenLesson && !isGuidedV1OnlineMode) {
      console.log('[guided-click-blocked] reason = guided-v1-online-disabled', {
        isOffAuthoredLine,
        lessonStepIndex,
        currentPlayer: match.currentPlayer,
      });
    }
    if (isGuidedV1OnlineMode && frozenLesson) {
      const expectedMove = currentLessonStep?.chosenMove ?? null;
      const clickedMove = move.tile
        ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
        : null;
      const accepted = Boolean(
        expectedMove &&
          expectedMove !== 'draw' &&
          expectedMove !== 'pass' &&
          clickedMove === expectedMove,
      );
      console.log('[guided-player]', {
        expectedMove,
        clickedMove,
        accepted,
        lessonStepIndexBefore: lessonStepIndex,
        lessonStepIndexAfterSet: accepted ? lessonStepIndex + 1 : lessonStepIndex,
        isTransitioning: isTransitioningRef.current,
      });
      if (!accepted) {
        console.log('[guided-click-blocked] reason = move-mismatch');
        console.log(`[guided-fallback] entered live fallback for hand = ${match.handNumber}`);
        setIsOffAuthoredLine(true);
        pushToast("You went off the authored line, so this hand will continue live from here.");
        return;
      }
      isTransitioningRef.current = true;
      console.log('[guided-click-advance]', {
        lessonStepIndexBefore: lessonStepIndex,
        lessonStepIndexAfter: lessonStepIndex + 1,
      });
      setLessonStepIndex((prev) => prev + 1);
      console.log('[guided-player]', {
        expectedMove,
        clickedMove,
        accepted: true,
        lessonStepIndexBefore: lessonStepIndex,
        lessonStepIndexAfterSet: lessonStepIndex + 1,
        isTransitioning: isTransitioningRef.current,
      });
    }
    const boardEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const ghostHandBefore = match.players.you.hand.map(toTileKey);
    const validMoves = userPlayMoves
      .filter((m) => m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const boardStateKey = serializeGhostBoardState(match.board);
    const result = applyPlayMove(match, 'you', move);
    let guidedFreeplayAdvanceToStepIndex: number | null = null;
    let shouldForceGuidedFreeplayBotTurn = false;
    if (isOriginalGuidedScriptedFritzMode && frozenLesson && currentLessonStep) {
      const currentStepHasScriptedFritzReply = (currentLessonStep.fritzReplyEvents?.length ?? 0) > 0;
      if (currentStepHasScriptedFritzReply) {
        shouldForceGuidedFreeplayBotTurn = true;
      } else {
        const nextAuthoredStepIndex = getNextGuidedV1StepIndex(frozenLesson, currentLessonStep.stepIndex);
        const nextAuthoredStep =
          nextAuthoredStepIndex != null
            ? getGuidedV1AuthoredStepByIndex(frozenLesson, nextAuthoredStepIndex)
            : null;
        if (
          nextAuthoredStepIndex != null &&
          nextAuthoredStep &&
          nextAuthoredStep.handNumber === result.state.handNumber
        ) {
          guidedFreeplayAdvanceToStepIndex = nextAuthoredStepIndex;
        } else if (!result.state.handOver && !result.state.gameOver) {
          shouldForceGuidedFreeplayBotTurn = true;
        }
      }
      console.log('[guided-freeplay-handoff]', {
        lessonStepIndex,
        currentStepIndex: currentLessonStep.stepIndex,
        currentStepHand: currentLessonStep.handNumber,
        currentStepHasScriptedFritzReply,
        guidedFreeplayAdvanceToStepIndex,
        shouldForceGuidedFreeplayBotTurn,
        resultCurrentPlayer: result.state.currentPlayer,
        resultHandNumber: result.state.handNumber,
        resultHandOver: result.state.handOver,
        resultGameOver: result.state.gameOver,
      });
    }
    const adjustedResult: BotActionResult = shouldForceGuidedFreeplayBotTurn
      ? {
          ...result,
          state: {
            ...result.state,
            currentPlayer: 'bot',
          },
        }
      : result;
    captureGuidedMatchCandidateAction('player', 'tile-play', match, adjustedResult, move);
    if (isDailyFritzMode) {
      traceDailyFritzEvent('[state] move applied', {
        tile: move.tile ? toTileKey(move.tile) : null,
        position: move.position ?? null,
      });
    }
    const afterPips = sumTilePips(adjustedResult.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);

    if (isAuthoringMode && move.tile) {
      const posStr = typeof position === 'string' && position ? `:${position}` : '';
      recordAuthoringStep(`${toTileKey(move.tile)}${posStr}`);
    }

    // ── V2 authoring: capture player play event ───────────────────────────
    if (isAuthoringV2Mode) {
      const eventIndex = authoringV2NextEventIndexRef.current++;
      const v2event = createV2Event({
        result,
        handNumber: match.handNumber,
        actor: 'player',
        action: 'play',
        tile: move.tile ?? undefined,
        position: typeof position === 'string' ? position : undefined,
        eventIndex,
        coachingText: authoringNoteText,
      });
      setAuthoringV2Events((prev) => [...prev, v2event]);
      console.log('[v2-capture] player play', { eventIndex, tile: v2event.tile, position: v2event.position });
    }

    if (guidedFreeplayAdvanceToStepIndex != null) {
      console.log('[guided-freeplay-advance]', {
        fromStepIndex: lessonStepIndex,
        toStepIndex: guidedFreeplayAdvanceToStepIndex,
      });
      setLessonStepIndex(guidedFreeplayAdvanceToStepIndex);
    }
    if (wantsOriginalGuidedRecordMode && guidedTranscript && currentTranscriptTurn) {
      const clickedMove = move.tile
        ? `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`
        : null;
      const expected = currentTranscriptTurn.expectedPlayerMove;
      const expectedMove =
        expected.type === 'play'
          ? `${expected.tile ?? ''}${expected.position ? `:${expected.position}` : ''}`
          : expected.type;
      if (clickedMove === expectedMove) {
        const nextTurn = guidedTranscript.turns.find((turn) => turn.stepIndex > currentTranscriptTurn.stepIndex) ?? null;
        if (nextTurn) {
          setLessonStepIndex(nextTurn.stepIndex);
        }
      }
    }

    // ── V2 guided playback: verify move against expected event ───────────
    if (isGuidedV2Mode && frozenV2Lesson && !isGuidedV2OffLine) {
      const expected = frozenV2Lesson.events[guidedV2EventIndex];
      const playedKey = move.tile ? toTileKey(move.tile) : null;
      const expectedKey = expected?.tile ?? null;
      const expectedPos = expected?.position ?? null;
      const tileMatch = playedKey && expectedKey && playedKey === expectedKey;
      const posMatch = !expectedPos || move.position === expectedPos;
      if (tileMatch && posMatch && expected) {
        // Apply authoritative state from the event instead of raw engine output
        const board = parseLessonV2BoardState(expected.boardAfter);
        const playerHand = expected.playerHandAfter
          .map((k) => parseTileKey(k))
          .filter((t): t is Tile => t !== null);
        const fritzHand = expected.fritzHandAfter
          .map((k) => parseTileKey(k))
          .filter((t): t is Tile => t !== null);
        const nextPlayer: BotPlayerId = expected.handOver || expected.gameOver
          ? 'you'
          : expected.turnContinues
            ? 'you'    // player gets another turn (e.g. drew and can play)
            : 'bot';
        setMatch((prev) => ({
          ...prev,
          board,
          handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
          boneyard: syncGuidedBoneyardCount(prev.boneyard, expected.boneyardCountAfter),
          players: {
            you: { ...prev.players.you, hand: playerHand, score: expected.playerScoreAfter },
            bot: { ...prev.players.bot, hand: fritzHand, score: expected.fritzScoreAfter },
          },
          currentPlayer: nextPlayer,
          handOver: expected.handOver,
          gameOver: expected.gameOver,
          winnerId: expected.gameOver
            ? guidedWinnerIdFromScores(expected.playerScoreAfter, expected.fritzScoreAfter)
            : prev.winnerId,
        }));
        notifyGuidedV2EventToasts(expected, opponentLabel, { showScoreToast, showBoardToast });
        if (expected.pointsScored > 0) queueSound(() => playScoreSound(expected.pointsScored, isMuted), 80);
        queueSound(() => playTileSound('standard', isMuted), 0);
        setGuidedV2EventIndex((i) => i + 1);
        flashLastPlayed(move.tile ?? null);
        setSelectedTile(null);

        // ── Hand-reveal when player play ends the hand ────────────────────────
        if (expected.handOver && expected.handEnded) {
          if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
          handRevealTimerRef.current = window.setTimeout(() => {
            setHandReveal({
              winner: expected.handEnded!.winner === 'player' ? 'you'
                : expected.handEnded!.winner === 'fritz' ? 'bot'
                : null,
              reason: expected.handEnded!.reason,
              pointsAwarded: expected.handEnded!.pointsAwarded,
              loserPips: expected.handEnded!.loserPips,
              calcText: expected.handEnded!.calcText,
              yourRemainingTiles: playerHand,
              botRemainingTiles: fritzHand,
            });
            handRevealTimerRef.current = null;
          }, 1400);
        }

        return;   // skip applyAndNotify — state was already set above
      } else {
        console.log('[guided-v2-mismatch]', {
          guidedV2EventIndex,
          expectedTile: expected?.tile ?? null,
          expectedPosition: expectedPos,
          clickedTile: playedKey,
          clickedPosition: typeof position === 'string' ? position : null,
          posMatch,
        });
        setIsGuidedV2OffLine(true);
        pushToast('You went off the lesson. Continuing live from here.');
      }
    }

    console.log('[guided-move] applying result to match state');
    console.log('[guided-move] result.state player hand =', adjustedResult.state.players.you.hand.map(toTileKey));
    console.log('[guided-move] result.state board mainLine length =', adjustedResult.state.board?.mainLine.length);

    applyAndNotify(adjustedResult);
    console.log('[guided-click-applied]', {
      currentPlayerAfter: adjustedResult.state.currentPlayer,
      lessonStepIndexCurrent: lessonStepIndex,
    });
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
    setSelectedController(null);
    if (isGhostMode && selectedTile && ghostSuggestedPlayerMove) {
      const actualMove =
        move.tile && move.position ? { tile: move.tile, position: move.position } : null;
      const agrees = isSameResolvedMove(actualMove, ghostSuggestedPlayerMove);
      if (agrees) {
        setGhostAgreementType(ghostSuggestedPlayerMove.source === 'composite' ? 'agrees' : 'heuristic');
        window.setTimeout(() => setGhostAgreementType(null), 1300);
      } else {
        setGhostBoardPulse(true);
        window.setTimeout(() => setGhostBoardPulse(false), 520);
      }
      appendGhostMove({
        turn: moveCounterRef.current,
        hand_number: match.handNumber,
        actor: 'you',
        board_state: boardStateKey,
        tile_played: selectedTile ? toTileKey(selectedTile) : null,
        branch: typeof position === 'string' ? position : null,
        hand_before: ghostHandBefore,
        score_delta: adjustedResult.scored?.points ?? 0,
        forced_draw: Boolean(adjustedResult.drew?.player === 'you'),
      });
    }
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(selectedTile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      pointsScored: adjustedResult.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match),
    });
  }, [
    match,
    selectedTile,
    userPlayMoves,
    botPlayMoves,
    getGuidedRecordBotMovesForTile,
    coach,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    frozenV2Lesson,
    isGuidedV2OffLine,
    guidedV2EventIndex,
    isGuidedV1OnlineMode,
    isMuted,
    isGuidedMode,
    frozenLesson,
    isOffAuthoredLine,
    currentLessonStep,
    lessonStepIndex,
    isGhostMode,
    ghostSuggestedPlayerMove,
    recordAuthoringStep,
    createV2Event,
    getFritzBestMove,
    appendGhostMove,
    appendMove,
    appendGuidedDraftFritzReply,
    applyAndNotify,
    flashLastPlayed,
    pushToast,
    isDailyFritzMode,
    wantsOriginalGuidedRecordMode,
    selectedController,
    captureGuidedMatchCandidateAction,
  ]);

  const playBestMove = () => {
    if (!guidedCoachTip?.bestMove.tile) return;
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    const move = guidedCoachTip.bestMove;
    const boardEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const validMoves = userPlayMoves.filter((m) => m.tile).map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const result = applyPlayMove(match, 'you', move);
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);
    if (isAuthoringMode && move.tile) {
      const posStr = typeof move.position === 'string' && move.position ? `:${move.position}` : '';
      recordAuthoringStep(`${toTileKey(move.tile)}${posStr}`);
    }
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(move.tile as Tile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      pointsScored: result.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match),
    });
  };

  /**
   * Guided Lesson: auto-play the authored best move for the current step.
   * Only callable when isGuidedMode && frozenLesson is active.
   */
  const playLessonBestMove = () => {
    if (!isGuidedTranscriptMode && !isGuidedV1MinimalMode && !isGuidedV1OnlineMode && !isGuidedV2Mode) return;
    if (!canPlayCoachedMove || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;

    if (isGuidedV2Mode && frozenV2Lesson && !isGuidedV2OffLine) {
      const expected = currentExpectedV2PlayerEvent;
      if (!expected || expected.actor !== 'player' || expected.action !== 'play' || !expected.tile) return;
      const parsedTile = parseTileKey(expected.tile);
      if (!parsedTile) return;
      let move: Move | null = null;
      if (expected.position) {
        move = userPlayMoves.find(
          (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === expected.position,
        ) ?? null;
      }
      if (!move) {
        move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
      }
      if (!move?.tile) return;

      const board = parseLessonV2BoardState(expected.boardAfter);
      const playerHand = expected.playerHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);
      const fritzHand = expected.fritzHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);
      const nextPlayer: BotPlayerId = expected.handOver || expected.gameOver
        ? 'you'
        : expected.turnContinues
          ? 'you'
          : 'bot';

      setMatch((prev) => ({
        ...prev,
        board,
        handOpen: Boolean(board && board.mainLine && board.mainLine.length > 0),
        boneyard: syncGuidedBoneyardCount(prev.boneyard, expected.boneyardCountAfter),
        players: {
          you: { ...prev.players.you, hand: playerHand, score: expected.playerScoreAfter },
          bot: { ...prev.players.bot, hand: fritzHand, score: expected.fritzScoreAfter },
        },
        currentPlayer: nextPlayer,
        handOver: expected.handOver,
        gameOver: expected.gameOver,
        winnerId: expected.gameOver
          ? guidedWinnerIdFromScores(expected.playerScoreAfter, expected.fritzScoreAfter)
          : prev.winnerId,
      }));
      notifyGuidedV2EventToasts(expected, opponentLabel, { showScoreToast, showBoardToast });
      if (expected.pointsScored > 0) queueSound(() => playScoreSound(expected.pointsScored, isMuted), 80);
      queueSound(() => playTileSound('standard', isMuted), 0);
      setGuidedV2EventIndex((i) => i + 1);
      flashLastPlayed(move.tile ?? null);
      setSelectedTile(null);

      if (expected.handOver && expected.handEnded) {
        if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
        handRevealTimerRef.current = window.setTimeout(() => {
          setHandReveal({
            winner: expected.handEnded!.winner === 'player' ? 'you'
              : expected.handEnded!.winner === 'fritz' ? 'bot'
              : null,
            reason: expected.handEnded!.reason,
            pointsAwarded: expected.handEnded!.pointsAwarded,
            loserPips: expected.handEnded!.loserPips,
            calcText: expected.handEnded!.calcText,
            yourRemainingTiles: playerHand,
            botRemainingTiles: fritzHand,
          });
          handRevealTimerRef.current = null;
        }, 1400);
      }
      return;
    }

    if (isGuidedTranscriptMode) {
      const turn = currentTranscriptTurn;
      if (!turn || turn.expectedPlayerMove.type !== 'play') return;
      const tileKeyRaw = turn.expectedPlayerMove.tile ?? '';
      const positionRaw = turn.expectedPlayerMove.position ?? null;
      const parsedTile = parseTileKey(tileKeyRaw);
      if (!parsedTile) return;
      let move: Move | null = null;
      if (positionRaw) {
        move = userPlayMoves.find(
          (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === positionRaw,
        ) ?? null;
      }
      if (!move) {
        move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
      }
      if (!move?.tile) return;
      acceptGuidedTranscriptTurn(turn, move.tile ?? null);
      return;
    }

    if (!frozenLesson) return;

    // Use the board-state-matched step (skips stale drafts automatically)
    const step = currentLessonStep;
    if (!step?.chosenMove || step.chosenMove === 'draw' || step.chosenMove === 'pass') return;

    // Parse "2|4" or "2|4:left" — split on ':' to extract tile key and position
    const colonIdx = step.chosenMove.indexOf(':');
    const tileKeyRaw = colonIdx >= 0 ? step.chosenMove.slice(0, colonIdx) : step.chosenMove;
    const positionRaw = colonIdx >= 0 ? step.chosenMove.slice(colonIdx + 1) : null;

    const parsedTile = parseTileKey(tileKeyRaw);
    if (!parsedTile) return;

    // Find a matching move in userPlayMoves — prefer position match, fall back to first tile match
    let move: Move | null = null;
    if (positionRaw) {
      move = userPlayMoves.find(
        (m) => m.tile && tileEquals(m.tile, parsedTile) && m.position === positionRaw,
      ) ?? null;
    }
    if (!move) {
      move = userPlayMoves.find((m) => m.tile && tileEquals(m.tile, parsedTile)) ?? null;
    }
    if (!move?.tile) return;
    const clickedMove = `${toTileKey(move.tile)}${move.position ? `:${move.position}` : ''}`;
    console.log('[guided-player] expectedMove =', step.chosenMove, 'clickedMove =', clickedMove, 'accepted =', true);

    if (isGuidedV1MinimalMode) {
      beginGuidedV1Replay(step, move.tile ?? null);
      return;
    }

    const boardEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [boardEndsRaw[0] ?? -1, boardEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const validMoves = userPlayMoves.filter((m) => m.tile).map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const result = applyPlayMove(match, 'you', move);
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);
    setLessonStepIndex((prev) => prev + 1);
    isTransitioningRef.current = true;
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(move.tile as Tile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      pointsScored: result.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match),
    });
  };

  useEffect(() => {
    if (!isGuidedTranscriptMode || isOffAuthoredLine || !guidedTranscript || !guidedV1Replay) return;

    const turn = guidedTranscript.turns.find((item) => item.stepIndex === guidedV1Replay.stepIndex) ?? null;
    const replyEvents = turn?.fritzReplies ?? [];
    if (replyEvents.length === 0) {
      pushToast('This transcript turn is missing Fritz reply events.');
      setGuidedV1Replay(null);
      setIsOffAuthoredLine(true);
      return;
    }
    if (guidedV1Replay.replyIndex >= replyEvents.length) {
      setGuidedV1Replay(null);
      setLessonStepIndex((prev) => prev + 1);
      return;
    }

    const event = replyEvents[guidedV1Replay.replyIndex]!;
    const delay = event.type === 'play' ? (event.pointsScored > 0 ? 1600 : 1200) : 800;

    const timer = window.setTimeout(() => {
      const nextState = parseGuidedTranscriptState(event.stateAfter);
      if (!nextState) {
        pushToast('This transcript reply is missing a valid state.');
        setGuidedV1Replay(null);
        setIsOffAuthoredLine(true);
        return;
      }

      const actionResult: BotActionResult = {
        state: nextState,
        scored: event.pointsScored > 0 ? { player: 'bot', points: event.pointsScored } : undefined,
        drew: event.type === 'draw' && event.tile ? { player: 'bot', tile: parseTileKey(event.tile)! } : undefined,
        passed: event.type === 'pass' ? { player: 'bot' } : undefined,
        handEnded: event.handEnded ? {
          winner: event.handEnded.winner as BotPlayerId | null,
          reason: event.handEnded.reason as BotHandEndReason,
          pointsAwarded: event.handEnded.pointsAwarded,
          loserPips: event.handEnded.loserPips,
          calcText: event.handEnded.calcText,
        } : undefined,
      };

      setMatch(nextState);
      notifyBotActionResult(actionResult);

      if (event.type === 'play' && event.tile) {
        const playedTile = parseTileKey(event.tile);
        if (playedTile) {
          flashLastPlayed(playedTile);
          queueSound(() => playTileSound('deal', isMuted), 0);
        }
      } else if (event.type === 'draw') {
        triggerDrawStepAnimation('bot', nextState);
        queueSound(() => playDrawSound(isMuted), 0);
      }

      setGuidedV1Replay((prev) =>
        prev && prev.stepIndex === guidedV1Replay.stepIndex
          ? { ...prev, replyIndex: prev.replyIndex + 1 }
          : prev,
      );
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    guidedTranscript,
    guidedV1Replay,
    isGuidedTranscriptMode,
    isMuted,
    isOffAuthoredLine,
    notifyBotActionResult,
    pushToast,
    flashLastPlayed,
    triggerDrawStepAnimation,
  ]);

  useEffect(() => {
    if (!isOriginalGuidedScriptedFritzMode || !frozenLesson || isOffAuthoredLine) return;
    if (match.currentPlayer !== 'bot' || match.handOver || match.gameOver) return;
    if (guidedV1Replay !== null) return;

    const botTurnSignature = JSON.stringify({
      stepIndex: lessonStepIndex,
      handNumber: match.handNumber,
      board: serializeGhostBoardState(match.board),
      youHand: match.players.you.hand.map(toTileKey),
      botHand: match.players.bot.hand.map(toTileKey),
      youScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
    if (guidedFreeplayProcessedBotTurnRef.current === botTurnSignature) return;
    guidedFreeplayProcessedBotTurnRef.current = botTurnSignature;

    const step = getGuidedV1AuthoredStepByIndex(frozenLesson, lessonStepIndex);
    const replyEvents = step?.fritzReplyEvents ?? [];
    console.log('[guided-freeplay-bot-start]', {
      lessonStepIndex,
      hasStep: Boolean(step),
      stepHandNumber: step?.handNumber ?? null,
      replyEventsCount: replyEvents.length,
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
    });
    if (replyEvents.length === 0) {
      const restored = restoreGuidedV1NextFullMatchState(frozenLesson, lessonStepIndex);
      console.log('[guided-freeplay-bot-fallback]', {
        reason: 'no-reply-events',
        lessonStepIndex,
        restoredStepIndex: restored.nextStepIndex,
        hasRestoredState: Boolean(restored.nextState),
      });
      if (restored.nextState) {
        setMatch(restored.nextState);
      } else {
        setMatch((prev) => ({
          ...prev,
          currentPlayer: 'you',
        }));
      }
      if (restored.nextStepIndex != null) {
        setLessonStepIndex(restored.nextStepIndex);
      }
      return;
    }
    if (!step) return;
    setGuidedV1Replay({ stepIndex: step.stepIndex, replyIndex: 0 });
  }, [
    frozenLesson,
    guidedV1Replay,
    isOffAuthoredLine,
    isOriginalGuidedScriptedFritzMode,
    lessonStepIndex,
    match.currentPlayer,
    match.gameOver,
    match.handOver,
    match.handNumber,
    match.board,
    match.players.bot.hand,
    match.players.bot.score,
    match.players.you.hand,
    match.players.you.score,
  ]);

  useEffect(() => {
    if (!isOriginalGuidedScriptedFritzMode) {
      guidedFreeplayProcessedBotTurnRef.current = null;
      return;
    }
    if (match.currentPlayer === 'you' || match.handOver || match.gameOver) {
      guidedFreeplayProcessedBotTurnRef.current = null;
    }
  }, [
    isOriginalGuidedScriptedFritzMode,
    match.currentPlayer,
    match.gameOver,
    match.handOver,
  ]);

  useEffect(() => {
    if (!isOriginalGuidedScriptedFritzMode || !frozenLesson || !guidedV1Replay) return;

    const step = getGuidedV1AuthoredStepByIndex(frozenLesson, guidedV1Replay.stepIndex);
    const replyEvents = step?.fritzReplyEvents ?? [];
    console.log('[guided-freeplay-replay]', {
      replayStepIndex: guidedV1Replay.stepIndex,
      replyIndex: guidedV1Replay.replyIndex,
      replyEventsCount: replyEvents.length,
      hasStep: Boolean(step),
    });
    if (replyEvents.length === 0 || guidedV1Replay.replyIndex >= replyEvents.length) {
      setGuidedV1Replay(null);
      const restored = restoreGuidedV1NextFullMatchState(frozenLesson, guidedV1Replay.stepIndex);
      console.log('[guided-freeplay-bot-fallback]', {
        reason: replyEvents.length === 0 ? 'replay-no-reply-events' : 'replay-index-finished',
        lessonStepIndex: guidedV1Replay.stepIndex,
        restoredStepIndex: restored.nextStepIndex,
        hasRestoredState: Boolean(restored.nextState),
      });
      if (restored.nextState) {
        setMatch(restored.nextState);
      } else {
        setMatch((prev) => ({
          ...prev,
          currentPlayer: 'you',
        }));
      }
      if (restored.nextStepIndex != null) {
        setLessonStepIndex(restored.nextStepIndex);
      }
      return;
    }

    const finalEventWithState =
      [...replyEvents]
        .reverse()
        .find((event) => event.boardAfter && event.botHandAfter && event.playerHandAfter) ??
      null;
    const finalEvent = finalEventWithState ?? replyEvents[replyEvents.length - 1]!;
    const delay = 250;

    const timer = window.setTimeout(() => {
      if (!finalEvent.boardAfter || !finalEvent.botHandAfter || !finalEvent.playerHandAfter) {
        setGuidedV1Replay(null);
        const restored = restoreGuidedV1NextFullMatchState(frozenLesson, guidedV1Replay.stepIndex);
        console.log('[guided-freeplay-bot-fallback]', {
          reason: 'final-event-missing-state',
          lessonStepIndex: guidedV1Replay.stepIndex,
          restoredStepIndex: restored.nextStepIndex,
          hasRestoredState: Boolean(restored.nextState),
          finalEventType: finalEvent.type,
          finalEventTile: finalEvent.tile ?? null,
        });
        if (restored.nextState) {
          setMatch(restored.nextState);
        } else {
          setMatch((prev) => ({
            ...prev,
            currentPlayer: 'you',
          }));
        }
        if (restored.nextStepIndex != null) {
          setLessonStepIndex(restored.nextStepIndex);
        }
        return;
      }

      const board = parseGuidedBoardState(finalEvent.boardAfter);
      const botTiles = finalEvent.botHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);
      const playerTiles = finalEvent.playerHandAfter
        .map((k) => parseTileKey(k))
        .filter((t): t is Tile => t !== null);

      const nextState: BotMatchState = {
        ...matchRef.current,
        board,
        players: {
          ...matchRef.current.players,
          bot: { ...matchRef.current.players.bot, hand: botTiles, score: finalEvent.runningScore },
          you: { ...matchRef.current.players.you, hand: playerTiles },
        },
        handOver: finalEvent.handOver,
        gameOver: finalEvent.gameOver,
        currentPlayer: finalEvent.turnContinues ? 'bot' : 'you',
      };
      console.log('[guided-freeplay-bot-apply]', {
        lessonStepIndex: guidedV1Replay.stepIndex,
        finalEventType: finalEvent.type,
        finalEventTile: finalEvent.tile ?? null,
        finalEventPosition: finalEvent.position ?? null,
        finalEventTurnContinues: finalEvent.turnContinues,
        nextCurrentPlayer: nextState.currentPlayer,
        handOver: nextState.handOver,
        gameOver: nextState.gameOver,
      });

      const actionResult: BotActionResult = {
        state: nextState,
        scored: finalEvent.pointsScored > 0 ? { player: 'bot', points: finalEvent.pointsScored } : undefined,
        drew: finalEvent.type === 'draw' && finalEvent.tile ? { player: 'bot', tile: parseTileKey(finalEvent.tile)! } : undefined,
        passed: finalEvent.type === 'pass' ? { player: 'bot' } : undefined,
        handEnded: finalEvent.handEnded ? {
          winner: finalEvent.handEnded.winner as BotPlayerId | null,
          reason: finalEvent.handEnded.reason as BotHandEndReason,
          pointsAwarded: finalEvent.handEnded.pointsAwarded,
          loserPips: finalEvent.handEnded.loserPips,
          calcText: finalEvent.handEnded.calcText,
        } : undefined,
      };

      setMatch(nextState);
      notifyBotActionResult(actionResult);

      if (finalEvent.type === 'play' && finalEvent.tile) {
        const playedTile = parseTileKey(finalEvent.tile);
        if (playedTile) {
          flashLastPlayed(playedTile);
          queueSound(() => playTileSound('deal', isMuted), 0);
        }
      } else if (finalEvent.type === 'draw') {
        triggerDrawStepAnimation('bot', nextState);
        queueSound(() => playDrawSound(isMuted), 0);
      }

      setGuidedV1Replay(null);
      const nextStepIndex = getNextGuidedV1StepIndex(frozenLesson, guidedV1Replay.stepIndex);
      if (nextStepIndex != null) {
        setLessonStepIndex(nextStepIndex);
      }
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    frozenLesson,
    guidedV1Replay,
    isMuted,
    isOriginalGuidedScriptedFritzMode,
    notifyBotActionResult,
    flashLastPlayed,
    triggerDrawStepAnimation,
  ]);

  useEffect(() => {
    botMatchDebugLog('[BOT-EFFECT] fired', {
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
      drawSequenceActive: drawSequenceActiveRef.current,
      cancelled: false,
    });
    if (!shouldAllowBotAction(matchRef.current) || drawSequenceActiveRef.current) return;
    if (preGameDrawActiveRef.current) return;
    if (isDailyFritzMode && isDailyFritzSetTerminal(dailyFritzPackage?.set_result)) return;
    if (isOriginalGuidedScriptedFritzMode) return;
    if (wantsOriginalGuidedRecordMode) return;
    if (isGuidedTranscriptMode) return;
    if (isGuidedV1MinimalMode) return;
    // In snapshot mode the bot never runs — the snapshot-advance effect above
    // immediately replaces bot-turn state with the next authored step.
    if (isGuidedV1OnlineMode) return;
    // In V2 guided on-line mode the Fritz auto-apply effect owns all bot turns.
    // Letting the live AI also run would produce dual state mutations.
    if (isGuidedV2Mode && !isGuidedV2OffLine) return;
    botMatchDebugLog('[BOT-EFFECT] passed guard, scheduling turn');
    let cancelled = false;
    let actionResolved = false;
    let playedTileForHighlight: Tile | null = null;
    const thinkDelayMs = 1500;
    const runToken = beginLocalRun('bot-turn');
    botChainPauseRef.current = false;

    const timer = setTimeout(() => {
      void (async () => {
        botMatchDebugLog('[BOT-TURN] timer fired', {
          cancelled,
          currentPlayer: matchRef.current.currentPlayer,
        });
        try {
          if (!isLocalRunCurrent(runToken)) return;
          const liveAtTurn = matchRef.current;
          if (!shouldAllowBotAction(liveAtTurn)) return;
          if (isDailyFritzMode && isDailyFritzSetTerminal(dailyFritzPackage?.set_result)) return;
          let working = liveAtTurn;
          let result: BotActionResult | null = null;
          let chosen: BotChoice | null = null;
          let ghostChosen: GhostResolvedMove | null = null;
          const beforeEndsRaw = getDisplayOpenEnds(match);
          const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
          const ghostBoardStateKey = serializeGhostBoardState(match.board);
          const ghostHandBefore = match.players.bot.hand.map(toTileKey);

          const botPlayable = asPlayMoves(getLegalMoves(working, 'bot'));
          if (botPlayable.length === 0) {
            setDrawSequenceActiveBoth(true);
            const drawPass = await runDrawSequenceLocal(working, 'bot', runToken, (step) => {
              captureGuidedMatchCandidateAction('fritz', step.actionKind, step.beforeState, step.result);
            });
            if (cancelled || !isLocalRunCurrent(runToken)) return;
            working = drawPass.state;

            if (drawPass.drew) {
              if (isGhostMode) {
                appendGhostMove({
                  turn: moveCounterRef.current,
                  hand_number: match.handNumber,
                  actor: 'ghost',
                  board_state: ghostBoardStateKey,
                  tile_played: null,
                  branch: 'draw',
                  hand_before: ghostHandBefore,
                  score_delta: 0,
                  forced_draw: false,
                });
              }
              appendMove({
                player: 'opponent',
                action: 'draw',
                boardEnds,
                handBefore: [],
                validMoves: [],
                pipDelta: 0,
                pointsScored: 0,
                boardState: snapshotBoardState(match.board),
                boardRenderState: cloneBoardState(match.board),
                handSnapshot: match.players.you.hand.map(toTileTuple),
                engineBestMove: toEngineBestFromChoice(chosen),
              });
            }
            if (drawPass.passed) {
              if (isGhostMode) {
                appendGhostMove({
                  turn: moveCounterRef.current,
                  hand_number: working.handNumber,
                  actor: 'ghost',
                  board_state: ghostBoardStateKey,
                  tile_played: null,
                  branch: 'pass',
                  hand_before: ghostHandBefore,
                  score_delta: 0,
                  forced_draw: false,
                });
              }
              appendMove({
                player: 'opponent',
                action: 'pass',
                boardEnds,
                handBefore: [],
                validMoves: [],
                pipDelta: 0,
                pointsScored: 0,
                boardState: snapshotBoardState(match.board),
                boardRenderState: cloneBoardState(match.board),
                handSnapshot: match.players.you.hand.map(toTileTuple),
                engineBestMove: toEngineBestFromChoice(chosen),
              });
            }
            const afterDraw = asPlayMoves(getLegalMoves(working, 'bot'));
            if (afterDraw.length === 0) {
              result = drawPass;
            } else {
              if (isGhostMode) {
                ghostChosen = resolveGhostMove({
                  state: working,
                  player: 'bot',
                  legalMoves: afterDraw,
                  profile: ghostProfile,
                });
              } else {
                chosen = chooseBotMove(toBotVisibleState(working), fritzConfig.difficulty);
                logFritzFairnessDecision(working, chosen);
              }
              playedTileForHighlight =
                ghostChosen?.tile ?? chosen?.move?.tile ?? afterDraw[0]?.tile ?? null;
              queueSound(() => playTileSound('deal', isMuted), 0);
              result = applyPlayMove(
                working,
                'bot',
                ghostChosen
                  ? { type: 'play', tile: ghostChosen.tile, position: ghostChosen.position }
                  : chosen?.move ?? afterDraw[0],
              );
              captureGuidedMatchCandidateAction(
                'fritz',
                'tile-play',
                working,
                result,
                ghostChosen
                  ? { type: 'play', tile: ghostChosen.tile, position: ghostChosen.position }
                  : chosen?.move ?? afterDraw[0],
              );
            }
          } else {
            if (isGhostMode) {
              ghostChosen = resolveGhostMove({
                state: working,
                player: 'bot',
                legalMoves: botPlayable,
                profile: ghostProfile,
              });
            } else {
              chosen = chooseBotMove(toBotVisibleState(working), fritzConfig.difficulty);
              logFritzFairnessDecision(working, chosen);
            }
            playedTileForHighlight = ghostChosen?.tile ?? chosen?.move?.tile ?? botPlayable[0]?.tile ?? null;
            queueSound(() => playTileSound('deal', isMuted), 0);
            result = applyPlayMove(
              working,
              'bot',
              ghostChosen
                ? { type: 'play', tile: ghostChosen.tile, position: ghostChosen.position }
                : chosen?.move ?? botPlayable[0],
            );
            captureGuidedMatchCandidateAction(
              'fritz',
              'tile-play',
              working,
              result,
              ghostChosen
                ? { type: 'play', tile: ghostChosen.tile, position: ghostChosen.position }
                : chosen?.move ?? botPlayable[0],
            );
          }

          if (cancelled || actionResolved || !isLocalRunCurrent(runToken)) return;
          if (chosen) setLastBotChoice(chosen);
          if (isGhostMode) {
            setLastBotChoice(null);
            setGhostPlayedTile(ghostChosen?.tile ?? null);
          }
          if (result) {
            actionResolved = true;
            botChainPauseRef.current =
              result.state.currentPlayer === 'bot' && !result.state.handOver && !result.state.gameOver;
            setSelectedTile(null);
            if (isGhostMode && ghostChosen) {
              appendGhostMove({
                turn: moveCounterRef.current,
                hand_number: working.handNumber,
                actor: 'ghost',
                board_state: ghostBoardStateKey,
                tile_played: toTileKey(ghostChosen.tile),
                branch: ghostChosen.position,
                hand_before: ghostHandBefore,
                score_delta: result.scored?.points ?? 0,
                forced_draw: Boolean(result.drew?.player === 'bot'),
              });
            }
            if (chosen?.move?.tile || ghostChosen?.tile) {
              appendMove({
                player: 'opponent',
                action: 'place',
                tile: toTileTuple((ghostChosen?.tile ?? chosen?.move?.tile) as Tile),
                boardEnds,
                handBefore: [],
                validMoves: [],
                pipDelta: 0,
                pointsScored: 0,
                boardState: snapshotBoardState(match.board),
                boardRenderState: cloneBoardState(match.board),
                handSnapshot: match.players.you.hand.map(toTileTuple),
                engineBestMove: ghostChosen
                  ? {
                      tile: toTileTuple(ghostChosen.tile),
                      position: ghostChosen.position,
                      score: 0,
                    }
                  : toEngineBestFromChoice(chosen),
              });
            }
            if (isDailyFritzMode) {
              dailyFritzDebugLog('[daily-flow] bot move applied', {
                handNumber: result.state.handNumber,
                handOver: result.state.handOver,
                gameOver: result.state.gameOver,
                nextPlayer: result.state.currentPlayer,
                scored: result.scored?.points ?? 0,
              });
            }

            if (isAuthoringMode && result) {
              const captureAction: 'play' | 'draw' | 'pass' = result.drew
                ? 'draw'
                : result.passed
                  ? 'pass'
                  : 'play';
              fritzSessionReplyRef.current.push({
                type: captureAction,
                tile: playedTileForHighlight ? toTileKey(playedTileForHighlight) : undefined,
                position: ghostChosen?.position ?? (chosen?.move?.type === 'play' ? chosen.move.position : undefined),
                scoreDelta: result.scored?.points ?? 0,
                pointsScored: result.scored?.points ?? 0,
                runningScore: result.state.players.bot.score,
                turnContinues: result.state.currentPlayer === 'bot',
                handOver: result.state.handOver,
                gameOver: result.state.gameOver,
                boardAfter: serializeGhostBoardState(result.state.board),
                botHandAfter: result.state.players.bot.hand.map(toTileKey),
                playerHandAfter: result.state.players.you.hand.map(toTileKey),
                handEnded: result.handEnded ? {
                  winner: result.handEnded.winner,
                  reason: result.handEnded.reason,
                  pointsAwarded: result.handEnded.pointsAwarded,
                  loserPips: result.handEnded.loserPips,
                  calcText: result.handEnded.calcText,
                } : undefined,
              });
              // Target step is the most recent real (chosenMove!==null) step —
              // Fritz's reply belongs to the player move that triggered it.
              let targetStepIdx = -1;
              for (let i = authoringSteps.length - 1; i >= 0; i -= 1) {
                if (authoringSteps[i]!.chosenMove !== null) {
                  targetStepIdx = authoringSteps[i]!.stepIndex;
                  break;
                }
              }
              console.log('[guided-capture] push', {
                stepIndexTarget: targetStepIdx,
                currentPlayer: result.state.currentPlayer,
                action: captureAction,
                tile: playedTileForHighlight ? toTileKey(playedTileForHighlight) : undefined,
                pendingCount: fritzSessionReplyRef.current.length,
              });
            }

            // ── V2 authoring: capture Fritz action event ─────────────────
            if (isAuthoringV2Mode && result) {
              const captureAction: 'play' | 'draw' | 'pass' = result.drew
                ? 'draw'
                : result.passed
                  ? 'pass'
                  : 'play';
              const eventIndex = authoringV2NextEventIndexRef.current++;
              const v2event = createV2Event({
                result,
                handNumber: matchRef.current.handNumber,
                actor: 'fritz',
                action: captureAction,
                tile: playedTileForHighlight ?? undefined,
                position: ghostChosen?.position ?? (chosen?.move?.type === 'play' ? chosen.move.position : undefined),
                eventIndex,
              });
              setAuthoringV2Events((prev) => [...prev, v2event]);
              console.log('[v2-capture] fritz', { eventIndex, action: captureAction, tile: v2event.tile });
            }

            if (!isLocalRunCurrent(runToken)) return;
            if (!shouldApplyBotActionResult(matchRef.current, result)) {
              if (import.meta.env.DEV) {
                console.log('[BOT-TURN] apply skipped — stale result', {
                  liveHandOver: matchRef.current.handOver,
                  liveGameOver: matchRef.current.gameOver,
                  resultHandOver: result.state.handOver,
                  resultGameOver: result.state.gameOver,
                  hasHandEnded: Boolean(result.handEnded),
                });
              }
              return;
            }
            applyAndNotify(result);
            flashLastPlayed(playedTileForHighlight);
          }
        } finally {
          if (isLocalRunCurrent(runToken)) {
            finishLocalRun(runToken);
          }
          // Always release the draw/pass mutex — if the run was superseded,
          // skipping this left the bot stuck behind drawSequenceActiveRef.
          setDrawSequenceActiveBoth(false);
        }
      })();
    }, thinkDelayMs);

    const maxThinkingTimer = setTimeout(() => {
      if (cancelled || actionResolved) return;
      if (!isLocalRunCurrent(runToken)) return;
      const live = matchRef.current;
      if (!live || live.currentPlayer !== 'bot' || live.handOver || live.gameOver) return;
      const fallbackPlay = asPlayMoves(getLegalMoves(live, 'bot'))[0];
      if (!fallbackPlay) return;
      cancelled = true;
      actionResolved = true;
      const beforeEndsRaw = getDisplayOpenEnds(live);
      const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
      const forcedResult = applyPlayMove(live, 'bot', fallbackPlay);
      captureGuidedMatchCandidateAction('fritz', 'tile-play', live, forcedResult, fallbackPlay);
      botChainPauseRef.current =
        forcedResult.state.currentPlayer === 'bot' && !forcedResult.state.handOver && !forcedResult.state.gameOver;
      if (fallbackPlay.tile) {
        appendMove({
          player: 'opponent',
          action: 'place',
          tile: toTileTuple(fallbackPlay.tile),
          boardEnds,
          handBefore: [],
          validMoves: [],
          pipDelta: 0,
          pointsScored: 0,
          boardState: snapshotBoardState(live.board),
          boardRenderState: cloneBoardState(live.board),
          handSnapshot: live.players.you.hand.map(toTileTuple),
          engineBestMove: fallbackPlay.tile
            ? {
                tile: toTileTuple(fallbackPlay.tile),
                position: fallbackPlay.position,
                score: 0,
              }
            : null,
        });
      }
      setLastBotChoice(null);
      setSelectedTile(null);
      if (!isLocalRunCurrent(runToken)) return;
      if (!shouldApplyBotActionResult(matchRef.current, forcedResult)) return;
      finishLocalRun(runToken);
      applyAndNotify(forcedResult);
      flashLastPlayed(fallbackPlay.tile ?? null);
    }, 3000);

    return () => {
      console.log('[BOT-EFFECT] cleanup called', { drawSequenceActive: drawSequenceActiveRef.current });
      if (!drawSequenceActiveRef.current) {
        cancelled = true;
      }
      clearTimeout(timer);
      clearTimeout(maxThinkingTimer);
    };
  }, [
    match,
    appendMove,
    appendGhostMove,
    ghostProfile,
    isGhostMode,
    isOriginalGuidedScriptedFritzMode,
    isGuidedTranscriptMode,
    runDrawSequenceLocal,
    setDrawSequenceActiveBoth,
    beginLocalRun,
    isLocalRunCurrent,
    finishLocalRun,
    isMuted,
    toEngineBestFromChoice,
    captureGuidedMatchCandidateAction,
    isDailyFritzMode,
    dailyFritzPackage?.set_result,
  ]);

  // ── Sequential Bot Reply Replay ───────────────────────────────────────────
  useEffect(() => {
    if (!isGuidedV1OnlineMode || !frozenLesson || guidedReplyIndex === -1) return;

    const prevStepIdx = lessonStepIndex - 1;
    const prevStep = getGuidedV1AuthoredStepByIndex(frozenLesson, prevStepIdx);
    const replyEvents = prevStep?.fritzReplyEvents;

    if (!replyEvents || guidedReplyIndex >= replyEvents.length) {
      console.log('[guided-playback] replay complete', { stepIndex: prevStepIdx });
      setGuidedReplyIndex(-1);
      return;
    }

    const event = replyEvents[guidedReplyIndex];
    // Natural thinking delay between Fritz moves
    const delay = event.type === 'play' ? (event.pointsScored > 0 ? 1600 : 1200) : 800;

    console.log('[guided-playback] replay event', {
      stepIndex: prevStepIdx,
      replyIndex: guidedReplyIndex,
      action: event.type,
      runningBotScore: event.runningScore,
    });
    console.log(`[guided-flow] replaying reply event index = ${guidedReplyIndex}`);
    console.log(`[guided-replay] event index = ${guidedReplyIndex}`);
    console.log(`[guided-replay] event type = ${event.type}`);

    const timer = setTimeout(() => {
      console.log(`[guided-replay] replay event started`, { type: event.type, index: guidedReplyIndex });

      // Apply the event to match state
      let matchResultState: BotMatchState | null = null;
      let actionResult: BotActionResult | null = null;

      setMatch((prev) => {
        let next = { ...prev };

        const hasStoredState = !!(event.boardAfter && event.botHandAfter && event.playerHandAfter);
        if (!hasStoredState) {
          console.warn('[guided-skip] reason = missing-fritzReplyState', {
            stepIndex: prevStepIdx,
            replyIndex: guidedReplyIndex,
          });
          matchResultState = prev;
          return prev;
        }

        const board = parseGuidedBoardState(event.boardAfter!);
        const botTiles = event.botHandAfter!
          .map((k) => parseTileKey(k))
          .filter((t): t is Tile => t !== null);
        const playerTiles = event.playerHandAfter!
          .map((k) => parseTileKey(k))
          .filter((t): t is Tile => t !== null);

        next = {
          ...prev,
          board,
          players: {
            ...prev.players,
            bot: { ...prev.players.bot, hand: botTiles, score: event.runningScore },
            you: { ...prev.players.you, hand: playerTiles },
          },
          handOver: event.handOver,
          gameOver: event.gameOver,
          currentPlayer: event.turnContinues ? 'bot' : 'you',
        };

        actionResult = {
          state: next,
          scored: event.pointsScored > 0 ? { player: 'bot', points: event.pointsScored } : undefined,
          drew: event.type === 'draw' && event.tile ? { player: 'bot', tile: parseTileKey(event.tile)! } : undefined,
          passed: event.type === 'pass' ? { player: 'bot' } : undefined,
          handEnded: event.handEnded ? {
            winner: event.handEnded.winner as BotPlayerId | null,
            reason: event.handEnded.reason as BotHandEndReason,
            pointsAwarded: event.handEnded.pointsAwarded,
            loserPips: event.handEnded.loserPips,
            calcText: event.handEnded.calcText,
          } : undefined,
        };

        matchResultState = next;
        return next;
      });

      // Side effects via shared pipeline
      if (actionResult) {
        notifyBotActionResult(actionResult);
        
        // Manual triggers for visual polish not covered by notifyBotActionResult
        if (event.type === 'play' && event.tile) {
          const playedTile = parseTileKey(event.tile);
          if (playedTile) {
            flashLastPlayed(playedTile);
            queueSound(() => playTileSound('deal', isMuted), 0);
          }
        } else if (event.type === 'draw' && matchResultState) {
          triggerDrawStepAnimation('bot', matchResultState);
          queueSound(() => playDrawSound(isMuted), 0);
        }
      }

      console.log(`[guided-replay] replay event applied`, { type: event.type, index: guidedReplyIndex });
      setGuidedReplyIndex((prevIndex) => prevIndex + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [isGuidedV1OnlineMode, frozenLesson, guidedReplyIndex, lessonStepIndex, isMuted, triggerDrawStepAnimation]);

  const traceHandLifecycle = useCallback(
    (phase: HandLifecyclePhase, detail?: Record<string, unknown>, hypothesisId?: string) => {
      logHandLifecycle({
        phase,
        previousPhase: handLifecyclePhaseRef.current,
        mode,
        handNumber: matchRef.current.handNumber,
        detail,
        hypothesisId,
      });
      handLifecyclePhaseRef.current = phase;
      // #region agent log
      emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
        location: 'BotMatchScreen.tsx:traceHandLifecycle',
        message: phase,
        hypothesisId,
        data: { mode, handNumber: matchRef.current.handNumber, ...detail },
      });
      // #endregion
    },
    [mode],
  );

  const scheduleHandAdvanceRetry = useCallback((delayMs: number, reason: string) => {
    if (handAdvanceRetryTimerRef.current) {
      window.clearTimeout(handAdvanceRetryTimerRef.current);
    }
    handAdvanceRetryTimerRef.current = window.setTimeout(() => {
      handAdvanceRetryTimerRef.current = null;
      dailyFritzDebugLog('[hand-over] retry-scheduled', { reason, delayMs });
      advanceHandRef.current();
    }, delayMs);
  }, []);

  const applyDailyFritzNextHandResponse = useCallback(
    (response: DailyFritzNextHandResponse, source: string) => {
      lastDailyFlowLabelRef.current = 'next-hand-start';
      dailyFritzDebugLog('[daily-fritz-hand] applying next hand', {
        source,
        gameNumber: response.game_number ?? dailyFritzPackage?.current_game_number ?? 1,
        currentHandIndex: response.current_hand_index,
        nextHandNumber: matchRef.current.handNumber + 1,
        replayed: Boolean(response.replayed),
        ignored: Boolean(response.ignored),
      });
      setDailyFritzHandIndex(response.current_hand_index);
      dailyFritzNextHandFailureCountRef.current = 0;
      setHandAdvanceError(null);
      setShowManualHandAdvance(false);
      setHandReveal(null);
      pendingHandRevealRef.current = null;
      dailyFritzMinAdvanceAtRef.current = null;
      traceHandLifecycle('dealing-next-hand', { source }, 'D');
      let applied = false;
      setMatch((prev) => {
        if (!canApplyNextHand(prev)) {
          warnHandLifecycleStuck('setMatch skipped — hand not over', {
            handOver: prev.handOver,
            gameOver: prev.gameOver,
            source,
          });
          // #region agent log
          emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
            location: 'BotMatchScreen.tsx:applyDailyFritzNextHandResponse',
            message: 'setMatch-noop',
            hypothesisId: 'D',
            data: { handOver: prev.handOver, gameOver: prev.gameOver, source },
          });
          // #endregion
          return prev;
        }
        applied = true;
        return {
          ...startNextFixedBotHand(prev, response.hand),
          opponentPassedOnEnds: [],
          opponentDrawCount: 0,
          opponentKnownMissing: [],
        };
      });
      dailyFritzNextHandRef.current = null;
      handTransitionInFlightRef.current = false;
      if (applied) {
        traceHandLifecycle('playing', { source, handIndex: response.current_hand_index });
      } else {
        traceHandLifecycle('error', { source, reason: 'setMatch-noop' }, 'D');
        setHandAdvanceError('Could not start the next hand. Tap Continue to retry.');
        logDailyFritzHandBreadcrumb('manual-advance-shown', { reason: 'setMatch-noop', source });
        setShowManualHandAdvance(true);
      }
    },
    [dailyFritzPackage?.current_game_number, traceHandLifecycle],
  );

  const advanceHand = useCallback(() => {
    const live = matchRef.current;
    if (!isDailyFritzMode && live.gameOver) {
      traceHandLifecycle('match-complete', { reason: 'advance-skipped-game-over' });
      return;
    }
    if (isDailyFritzMode && isDailyFritzSetTerminal(dailyFritzPackage?.set_result)) {
      traceHandLifecycle('set-complete', { reason: 'advance-skipped-set-terminal' });
      return;
    }
    if (handTransitionInFlightRef.current) {
      dailyFritzDebugLog('[daily-flow] advanceHand skipped — transition already in flight');
      // #region agent log
      emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
        location: 'BotMatchScreen.tsx:advanceHand',
        message: 'advanceHand-skipped-in-flight',
        hypothesisId: 'B',
        data: { handNumber: matchRef.current.handNumber },
      });
      // #endregion
      return;
    }

    traceHandLifecycle('advancing-hand', {
      prefetchReady: dailyFritzNextHandRef.current?.result != null,
      hasPrefetchPromise: dailyFritzNextHandRef.current?.promise != null,
    });

    if (isDailyFritzMode) {
      lastDailyFlowLabelRef.current = 'reveal-end';
      dailyFritzDebugLog('[daily-flow] reveal end', {
        handNumber: matchRef.current.handNumber,
        prefetchReady: dailyFritzNextHandRef.current?.result != null,
        handTransitionInFlight: handTransitionInFlightRef.current,
      });
    }

    invalidateLocalRuns();
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);

    if (isDailyFritzMode && dailyFritzPackage) {
      const minAdvanceAt = dailyFritzMinAdvanceAtRef.current;
      const nowMs = Date.now();
      if (isDailyFritzAdvanceLocked(minAdvanceAt, nowMs)) {
        const remainingMs = (minAdvanceAt ?? nowMs) - nowMs;
        scheduleHandAdvanceRetry(Math.max(80, Math.ceil(remainingMs)), 'reveal-window-guard');
        return;
      }
      handTransitionInFlightRef.current = true;
      if (handAutoAdvanceTimerRef.current) {
        window.clearTimeout(handAutoAdvanceTimerRef.current);
        handAutoAdvanceTimerRef.current = null;
        dailyFritzDebugLog('[hand-over] timer-cleared', { reason: 'advance-start' });
      }

      const handleEndOfRun = (reason: string) => {
        dailyFritzDebugLog('[daily-flow] end-of-run detected from server', {
          reason,
          handNumber: matchRef.current.handNumber,
        });
        lastDailyFlowLabelRef.current = 'match-complete';
        handTransitionInFlightRef.current = false;
        dailyFritzNextHandRef.current = null;
        dailyFritzMinAdvanceAtRef.current = null;
        setHandAdvanceError(null);
        setShowManualHandAdvance(false);
        setHandReveal(null);
        traceHandLifecycle('match-complete', { reason });
        setMatch((prev) => {
          const yourScore = prev.players.you.score;
          const botScore = prev.players.bot.score;
          const winnerId = yourScore >= botScore ? 'you' : 'bot';
          return { ...prev, handOver: false, gameOver: true, winnerId };
        });
      };

      const cacheSnapshot = dailyFritzNextHandRef.current;

      if (cacheSnapshot?.error instanceof DailyFritzEndOfRunError) {
        handleEndOfRun(cacheSnapshot.error.message);
        return;
      }

      if (cacheSnapshot?.result) {
        dailyFritzDebugLog('[hand-over] advancing-next-hand', { source: 'prefetch-hit' });
        applyDailyFritzNextHandResponse(cacheSnapshot.result, 'prefetch-hit');
        return;
      }

      const gameNumber = dailyFritzPackage.current_game_number ?? 1;
      const source = cacheSnapshot?.promise ? 'advance-await-prefetch' : 'advance-fetch';
      const requestStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const createRequest = () =>
        nextDailyFritzHand({
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          runDate: dailyFritzPackage.run_date,
          gameNumber,
          completedHandIndex: dailyFritzHandIndex,
          completedHandScores: {
            you: matchRef.current.players.you.score,
            fritz: matchRef.current.players.bot.score,
          },
          timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
        });

      if (!cacheSnapshot?.promise) {
        dailyFritzNextHandRef.current = {
          promise: createRequest(),
          result: null,
          error: null,
          startedAt: requestStartedAt,
        };
      }

      const activeCache = dailyFritzNextHandRef.current!;
      dailyFritzDebugLog('[daily-fritz-hand] requesting next hand', {
        source,
        gameNumber,
        completedHandIndex: dailyFritzHandIndex,
        yourScore: matchRef.current.players.you.score,
        fritzScore: matchRef.current.players.bot.score,
      });

      void resolveDailyFritzNextHandCache(activeCache, createRequest)
        .then((response) => {
          activeCache.result = response;
          const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          dailyFritzDebugLog('[daily-fritz-hand] next hand response', {
            source,
            gameNumber: response.game_number ?? gameNumber,
            currentHandIndex: response.current_hand_index,
            replayed: Boolean(response.replayed),
            ignored: Boolean(response.ignored),
            durationMs: Number((requestEndedAt - activeCache.startedAt).toFixed(1)),
          });
          applyDailyFritzNextHandResponse(response, source);
        })
        .catch((err) => {
          if (err instanceof DailyFritzEndOfRunError) {
            handleEndOfRun(err.message);
            return;
          }
          const errMsg = err instanceof Error ? err.message : 'Failed to load next Daily Fritz hand.';
          activeCache.error = err;
          handTransitionInFlightRef.current = false;
          dailyFritzNextHandFailureCountRef.current += 1;
          const failureAttempt = dailyFritzNextHandFailureCountRef.current;
          const isAbort = err instanceof Error && err.message.toLowerCase().includes('timed out');
          // #region agent log
          emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
            location: 'BotMatchScreen.tsx:advanceHand',
            message: 'advanceHand-network-error',
            hypothesisId: isAbort ? 'A' : 'B',
            data: {
              source,
              error: errMsg,
              failureAttempt,
              handNumber: matchRef.current.handNumber,
              timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
              nextHandUrl: `${resolveGameServerUrl()}/api/daily-fritz/next-hand`,
            },
          });
          // #endregion
          if (failureAttempt < 2) {
            logDailyFritzHandBreadcrumb('manual-advance-shown', {
              reason: 'next-hand-fetch-retry',
              source,
              failureAttempt,
              error: errMsg,
            });
            setShowManualHandAdvance(true);
            traceHandLifecycle('error', { source, error: errMsg, failureAttempt, willRetry: true }, 'C');
            scheduleHandAdvanceRetry(2500, 'next-hand-fetch-failed');
            return;
          }
          setHandAdvanceError(formatDailyFritzNextHandUserMessage(errMsg));
          logDailyFritzHandBreadcrumb('manual-advance-shown', {
            reason: 'next-hand-fetch-failed',
            source,
            failureAttempt,
            error: errMsg,
          });
          setShowManualHandAdvance(true);
          traceHandLifecycle('error', { source, error: errMsg, failureAttempt }, 'C');
          if (import.meta.env.DEV) {
            console.warn('[daily-fritz-hand] next hand error (raw)', {
              source,
              gameNumber,
              url: `${resolveGameServerUrl()}/api/daily-fritz/next-hand`,
              error: errMsg,
              handNumber: matchRef.current.handNumber,
            });
          }
          if (shouldLogDailyFritzDebug()) {
            console.warn('[daily-fritz-hand] next hand error', {
              source,
              gameNumber,
              error: errMsg,
              handNumber: matchRef.current.handNumber,
            });
          }
          scheduleHandAdvanceRetry(4000, 'next-hand-fetch-failed');
        });
      return;
    }

    // ── Non-Daily-Fritz modes (authoring, guided, bot match) ─────────────────
    setHandAdvanceError(null);
    setShowManualHandAdvance(false);
    setHandReveal(null);
    traceHandLifecycle('dealing-next-hand');

    if (isGuidedV1MinimalMode && frozenLesson) {
      const nextStep = getGuidedV1AuthoredStepByIndex(frozenLesson, lessonStepIndex);
      const restored = restoreGuidedV1StepMatchState(nextStep);
      if (restored) {
        setMatch(restored);
      }
      return;
    }

    // ── V2 Guided: restore next hand from authored snapshot ──────────────────
    // Always uses the frozen hand start even when off-line, so the next hand
    // begins cleanly on the authored line.  Resets the cursor and off-line flag.
    if (isGuidedV2Mode && frozenV2Lesson) {
      const nextHandNumber = matchRef.current.handNumber + 1;
      const playback = initGuidedV2Playback(frozenV2Lesson, nextHandNumber);
      if (playback.state) {
        setGuidedV2EventIndex(playback.firstEventIndex);
        setIsGuidedV2OffLine(false);
        fritzV2LastAppliedIndexRef.current = -1; // reset double-apply guard for new hand
        setMatch(() => ({
          ...playback.state!,
          opponentPassedOnEnds: [],
          opponentDrawCount: 0,
          opponentKnownMissing: [],
        }));
        return;
      }
      return;
    }

    if (isGuidedV2Mode) {
      return;
    }

    const previousState = matchRef.current;
    if (!canApplyNextHand(previousState)) return;
    handTransitionInFlightRef.current = true;
    const useSeededDeal = isAuthoringMode || (isGuidedMode && frozenLesson !== null);
    const nextState = useSeededDeal
      ? startNextFixedBotHand(previousState, generateAuthoringHandDeal(previousState.handNumber))
      : startNextBotHand(previousState);
    captureGuidedMatchCandidateNextHand(previousState, nextState);
    setMatch({
      ...nextState,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
    });
    handTransitionInFlightRef.current = false;
    traceHandLifecycle('playing');
  }, [
    applyDailyFritzNextHandResponse,
    dailyFritzHandIndex,
    dailyFritzPackage,
    isDailyFritzMode,
    isAuthoringMode,
    isGuidedV1MinimalMode,
    frozenLesson,
    lessonStepIndex,
    isGuidedV2Mode,
    frozenV2Lesson,
    isGuidedMode,
    invalidateLocalRuns,
    scheduleHandAdvanceRetry,
    traceHandLifecycle,
    captureGuidedMatchCandidateNextHand,
  ]);

  advanceHandRef.current = advanceHand;

  useEffect(() => {
    if (!handReveal || match.gameOver) {
      setHandRevealProgress(1);
      setShowManualHandAdvance(false);
      handRevealShownAtRef.current = null;
      if (match.gameOver) {
        dailyFritzMinAdvanceAtRef.current = null;
      }
      if (handAutoAdvanceTimerRef.current) {
        window.clearTimeout(handAutoAdvanceTimerRef.current);
        handAutoAdvanceTimerRef.current = null;
        dailyFritzDebugLog('[hand-over] timer-cleared', {
          reason: handReveal ? 'game-complete' : 'hidden',
        });
      }
      return;
    }
    handRevealShownAtRef.current = Date.now();
    if (isDailyFritzMode) {
      const revealGate = handRevealShownAtRef.current + DAILY_FRITZ_AUTO_ADVANCE_MS;
      dailyFritzMinAdvanceAtRef.current = Math.max(dailyFritzMinAdvanceAtRef.current ?? 0, revealGate);
    }
    traceHandLifecycle('showing-hand-result', {
      winner: handReveal.winner,
      pointsAwarded: handReveal.pointsAwarded,
    });
    dailyFritzDebugLog('[hand-over] shown', {
      mode,
      handWinner: handReveal.winner,
      pointsAwarded: handReveal.pointsAwarded,
      gameComplete: match.gameOver,
      setComplete: false,
    });
    setHandRevealProgress(1);
    setHandAdvanceError(null);
    dailyFritzNextHandFailureCountRef.current = 0;
    if (isGuidedMode || isGuidedV2Mode) return;
    if (isDailyFritzMode) {
      dailyFritzDebugLog('[daily-flow] reveal countdown started', {
        handNumber: match.handNumber,
        autoAdvanceMs: DAILY_FRITZ_AUTO_ADVANCE_MS,
        handTransitionInFlight: handTransitionInFlightRef.current,
        prefetchReady: dailyFritzNextHandRef.current?.result != null,
      });
    }
    dailyFritzDebugLog('[hand-over] timer-start', { delayMs: DAILY_FRITZ_AUTO_ADVANCE_MS });
    // #region agent log
    emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
      location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
      message: 'timer-start',
      hypothesisId: 'A',
      data: { delayMs: DAILY_FRITZ_AUTO_ADVANCE_MS, handNumber: match.handNumber },
    });
    // #endregion
    const rafId = requestAnimationFrame(() => setHandRevealProgress(0));
    handAutoAdvanceTimerRef.current = window.setTimeout(() => {
      handAutoAdvanceTimerRef.current = null;
      // #region agent log
      emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
        location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
        message: 'timer-fired',
        hypothesisId: 'A',
        data: { handNumber: matchRef.current.handNumber },
      });
      // #endregion
      advanceHandRef.current();
    }, DAILY_FRITZ_AUTO_ADVANCE_MS);
    return () => {
      cancelAnimationFrame(rafId);
      if (handAutoAdvanceTimerRef.current) {
        window.clearTimeout(handAutoAdvanceTimerRef.current);
        handAutoAdvanceTimerRef.current = null;
        dailyFritzDebugLog('[hand-over] timer-cleared', { reason: 'effect-cleanup' });
        // #region agent log
        emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
          location: 'BotMatchScreen.tsx:handRevealAutoAdvance',
          message: 'timer-cleared-effect-cleanup',
          hypothesisId: 'A',
          data: { handNumber: matchRef.current.handNumber },
        });
        // #endregion
      }
    };
  }, [handReveal, match.gameOver, isGuidedMode, isGuidedV2Mode, isDailyFritzMode, traceHandLifecycle]);

  useEffect(() => {
    if (!handReveal || match.gameOver || isGuidedMode || isGuidedV2Mode) {
      return;
    }
    // After auto-advance fires, allow a full next-hand timeout (+ retry) before the soft stall hint.
    const stallMs =
      DAILY_FRITZ_AUTO_ADVANCE_MS + DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS * 2 + 2500;
    const warnId = window.setTimeout(() => {
      if (!handRevealShownAtRef.current) return;
      const visibleMs = Date.now() - handRevealShownAtRef.current;
      if (visibleMs < stallMs - 500) return;
      if (handAdvanceError) return;
      warnHandLifecycleStuck('hand result modal visible past auto-advance window', {
        visibleMs,
        stallMs,
        handOver: matchRef.current.handOver,
        gameOver: matchRef.current.gameOver,
        inFlight: handTransitionInFlightRef.current,
        handAdvanceError,
      });
      // #region agent log
      emitHandLifecycleDebugLog(HAND_LIFECYCLE_DEBUG_SESSION, HAND_LIFECYCLE_DEBUG_ENDPOINT, {
        location: 'BotMatchScreen.tsx:handRevealStallWarn',
        message: 'stall-hint-shown',
        hypothesisId: 'C',
        data: { visibleMs, stallMs, inFlight: handTransitionInFlightRef.current },
      });
      // #endregion
      logDailyFritzHandBreadcrumb('manual-advance-shown', {
        reason: 'hand-reveal-stall',
        visibleMs,
        stallMs,
        inFlight: handTransitionInFlightRef.current,
      });
      setShowManualHandAdvance(true);
    }, stallMs);
    return () => window.clearTimeout(warnId);
  }, [handReveal, match.gameOver, isGuidedMode, isGuidedV2Mode, handAdvanceError]);

  // Build learning summary when hand reveal appears (guided mode only)
  useEffect(() => {
    if (!isGuidedMode || !handReveal || match.gameOver) return;
    coach.buildSummary(
      handReveal.pointsAwarded,
      match.players.you.score,
      handReveal.winner === 'you',
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handReveal]);

  // Reset per-hand learning state when a new hand begins (guided mode only)
  useEffect(() => {
    if (!isGuidedMode) return;
    coach.resetHand();
    if (isGuidedV1MinimalMode) return;

    if (frozenLesson && isOffAuthoredLine) {
      console.log(`[guided-fallback] hand ended in fallback = ${match.handNumber - 1}`);
      console.log(`[guided-fallback] resetting fallback on new hand start = ${match.handNumber}`);
      setIsOffAuthoredLine(false);

      // Resync lessonStepIndex to the first step of the new hand
      const realSteps = frozenLesson.steps.filter((s) => s.chosenMove !== null);
      const firstStepIdx = realSteps.findIndex((s) => s.handNumber === match.handNumber);
      if (firstStepIdx >= 0) {
        console.log(`[guided-fallback] resumed coached mode at step = ${firstStepIdx}`);
        setLessonStepIndex(firstStepIdx);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.handNumber, isGuidedMode, frozenLesson, isGuidedV1MinimalMode]);

  useEffect(() => {
    if (!match.handOver || match.gameOver || handReveal || handRevealTimerRef.current) return;
    if (isDailyFritzMode) return;
    if (isGuidedV1MinimalMode) return;
    // In V1 guided on-line mode, the authored lesson owns progression.
    if (isGuidedV1OnlineMode) return;
    // In V2 on-line mode the hand reveal is shown and player taps "Next Hand →"
    if (isGuidedV2Mode && !isGuidedV2OffLine) return;
    // Safety fallback: if a hand ended without the reveal modal flow starting, advance anyway.
    const timer = window.setTimeout(() => {
      if (matchRef.current.handOver && !matchRef.current.gameOver && !handRevealTimerRef.current) {
        advanceHand();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [match.handOver, match.gameOver, handReveal, advanceHand, isDailyFritzMode, isGuidedV1MinimalMode, isGuidedV1OnlineMode]);

  // ── Daily Fritz watchdog ──────────────────────────────────────────────────
  // Restores a missing reveal when possible; only advances after the countdown gate.
  useEffect(() => {
    if (!isDailyFritzMode) return;
    if (!match.handOver || match.gameOver) return;

    const watchdogMs = getDailyFritzWatchdogDelayMs(handReveal !== null);
    const id = window.setTimeout(() => {
      const live = matchRef.current;
      if (!live.handOver || live.gameOver) return;

      if (!handRevealRef.current && pendingHandRevealRef.current) {
        const pending = pendingHandRevealRef.current;
        if (shouldShowHandRevealForHand(live.handNumber, pending.handNumber)) {
          logDailyFritzHandBreadcrumb('reveal-restored', {
            handNumber: pending.handNumber,
            source: 'watchdog',
          });
          setHandReveal(pending.reveal);
          return;
        }
      }

      if (!shouldDailyFritzWatchdogAdvance({
        handOver: live.handOver,
        gameOver: live.gameOver,
        handRevealVisible: handRevealRef.current !== null,
        minAdvanceAt: dailyFritzMinAdvanceAtRef.current,
        nowMs: Date.now(),
      })) {
        dailyFritzDebugLog('[daily-flow] watchdog skipped — reveal/countdown not finished', {
          handNumber: live.handNumber,
          revealVisible: handRevealRef.current !== null,
          minAdvanceAt: dailyFritzMinAdvanceAtRef.current,
        });
        return;
      }

      dailyFritzDebugLog('[daily-flow] watchdog fired — advancing after reveal window', {
        handNumber: live.handNumber,
        handTransitionInFlight: handTransitionInFlightRef.current,
        lastLabel: lastDailyFlowLabelRef.current,
        revealVisible: handRevealRef.current !== null,
      });
      handTransitionInFlightRef.current = false;
      advanceHandRef.current();
    }, watchdogMs);

    return () => window.clearTimeout(id);
  }, [isDailyFritzMode, match.handOver, match.gameOver, handReveal]);

  useEffect(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver || drawSequenceActiveRef.current) return;
    if (isGuidedTranscriptMode) {
      const turn = currentTranscriptTurn;
      if (!turn) return;
      if (turn.expectedPlayerMove.type === 'play') {
        if (userPlayMoves.length === 0) {
          pushToast('This transcript turn has no legal authored tile play.');
          setIsOffAuthoredLine(true);
        }
        return;
      }
      acceptGuidedTranscriptTurn(turn, null);
      return;
    }
    if (isGuidedV1MinimalMode) {
      if (userPlayMoves.length === 0) {
        pushToast('This guided lesson has no authored tile play for the current turn.');
        setIsOffAuthoredLine(true);
      }
      return;
    }
    if (userPlayMoves.length > 0) return;
    // In snapshot mode each authored step always has at least one legal tile play.
    // Drawing/passing from a live boneyard that doesn't match the authored game
    // would diverge the lesson — suppress it entirely.
    if (isGuidedV1OnlineMode) {
      const expectedMove = currentLessonStep?.chosenMove ?? null;
      if (expectedMove === 'draw' || expectedMove === 'pass') {
        console.warn('[guided-skip] reason = authored-draw-pass-step', {
          stepIndex: lessonStepIndex,
          expectedMove,
        });
      } else {
        console.warn('[guided-skip] reason = missing-authored-playable-move', {
          stepIndex: lessonStepIndex,
          expectedMove,
        });
      }
      return;
    }
    // In V2 on-line mode the player-draw-event auto-apply effect handles all
    // draw/pass sequences via the authored timeline.  The live boneyard must not
    // be touched while on-line.
    if (isGuidedV2Mode && !isGuidedV2OffLine) return;
    const beforeEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    void (async () => {
      const runToken = beginLocalRun('player-draw');
      setDrawSequenceActiveBoth(true);
      try {
        // ── Daily Fritz: locked-boneyard / no-move fast path ──────────────────
        // When the boneyard is locked AND both players have no legal play moves,
        // the hand is definitively blocked right now. Resolve immediately instead
        // of waiting for a second pass, which can leave the UI frozen on "YOUR MOVE".
        const boneyardLocked = match.boneyard.length <= match.deadTiles.length;
        const botAlsoStuck =
          boneyardLocked &&
          asPlayMoves(getLegalMoves({ ...match, currentPlayer: 'bot' }, 'bot')).length === 0;
        if (isDailyFritzMode && boneyardLocked && botAlsoStuck) {
          dailyFritzDebugLog('[daily-flow] locked boneyard no-move detected', {
            handNumber: match.handNumber,
            yourScore: match.players.you.score,
            botScore: match.players.bot.score,
            boneyardLength: match.boneyard.length,
            consecutivePasses: match.consecutivePasses,
          });
          // Ensure consecutivePasses is at least 1 so the player's pass increments
          // it to 2 (≥ playerCount) and triggers blocked-hand resolution in passTurn.
          const resolveBase =
            match.consecutivePasses >= 1
              ? match
              : { ...match, consecutivePasses: 1 };
          const fastResult = passTurn(resolveBase, 'you');
          if (!isLocalRunCurrent(runToken)) return;
          dailyFritzDebugLog('[daily-flow] blocked hand resolved', {
            handEnded: Boolean(fastResult.handEnded),
            yourScore: fastResult.state.players.you.score,
            botScore: fastResult.state.players.bot.score,
            gameOver: fastResult.state.gameOver,
          });
          if (fastResult.state.gameOver) {
            dailyFritzDebugLog('[daily-flow] winning score already reached -> match complete', {
              handNumber: fastResult.state.handNumber,
              winnerId: fastResult.state.winnerId,
              yourScore: fastResult.state.players.you.score,
              botScore: fastResult.state.players.bot.score,
            });
          }
          if (fastResult.passed) {
            if (isGhostMode) {
              appendGhostMove({
                turn: moveCounterRef.current,
                hand_number: match.handNumber,
                actor: 'you',
                board_state: serializeGhostBoardState(match.board),
                tile_played: null,
                branch: 'pass',
                hand_before: handBefore.map(([low, high]) => `${low}|${high}`),
                score_delta: 0,
                forced_draw: false,
              });
            }
            appendMove({
              player: 'you',
              action: 'pass',
              boardEnds,
              handBefore,
              validMoves: [],
              pipDelta: 0,
              pointsScored: 0,
              boardState: snapshotBoardState(match.board),
              boardRenderState: cloneBoardState(match.board),
              handSnapshot: handBefore,
              engineBestMove: getFritzBestMove(match),
            });
          }
          applyAndNotify(fastResult);
          return;
        }
        // ── Normal draw-or-pass flow ───────────────────────────────────────────
        const result = await runDrawSequenceLocal(match, 'you', runToken, (step) => {
          captureGuidedMatchCandidateAction('player', step.actionKind, step.beforeState, step.result);
        });
        if (!isLocalRunCurrent(runToken)) return;
        setSelectedTile(null);
        if (result.drew) {
          if (isGhostMode) {
            appendGhostMove({
              turn: moveCounterRef.current,
              hand_number: match.handNumber,
              actor: 'you',
              board_state: serializeGhostBoardState(match.board),
              tile_played: null,
              branch: 'draw',
              hand_before: handBefore.map(([low, high]) => `${low}|${high}`),
              score_delta: 0,
              forced_draw: false,
            });
          }
          appendMove({
            player: 'you',
            action: 'draw',
            boardEnds,
            handBefore,
            validMoves: [],
            pipDelta: 0,
            pointsScored: 0,
            boardState: snapshotBoardState(match.board),
            boardRenderState: cloneBoardState(match.board),
            handSnapshot: handBefore,
            engineBestMove: getFritzBestMove(match),
          });
        }
        // ── V2 authoring: capture draw event ────────────────────────────
        if (isAuthoringV2Mode && result.drew) {
          const eventIndex = authoringV2NextEventIndexRef.current++;
          const v2event = createV2Event({
            result,
            handNumber: match.handNumber,
            actor: 'player',
            action: 'draw',
            eventIndex,
          });
          setAuthoringV2Events((prev) => [...prev, v2event]);
          console.log('[v2-capture] player draw', { eventIndex });
        }
        if (result.passed) {
          if (isAuthoringMode) {
            recordAuthoringStep('pass');
          }
          // ── V2 authoring: capture pass event ──────────────────────────
          if (isAuthoringV2Mode) {
            const eventIndex = authoringV2NextEventIndexRef.current++;
            const v2event = createV2Event({
              result,
              handNumber: match.handNumber,
              actor: 'player',
              action: 'pass',
              eventIndex,
            });
            setAuthoringV2Events((prev) => [...prev, v2event]);
            console.log('[v2-capture] player pass', { eventIndex });
          }
          if (isGuidedMode && frozenLesson) {
            isTransitioningRef.current = true;
            setLessonStepIndex((prev) => prev + 1);
          }
          if (isGhostMode) {
            appendGhostMove({
              turn: moveCounterRef.current,
              hand_number: match.handNumber,
              actor: 'you',
              board_state: serializeGhostBoardState(match.board),
              tile_played: null,
              branch: 'pass',
              hand_before: handBefore.map(([low, high]) => `${low}|${high}`),
              score_delta: 0,
              forced_draw: false,
            });
          }
          appendMove({
            player: 'you',
            action: 'pass',
            boardEnds,
            handBefore,
            validMoves: [],
            pipDelta: 0,
            pointsScored: 0,
            boardState: snapshotBoardState(match.board),
            boardRenderState: cloneBoardState(match.board),
            handSnapshot: handBefore,
            engineBestMove: getFritzBestMove(match),
          });
        }
        applyAndNotify(result);
      } finally {
        if (isLocalRunCurrent(runToken)) {
          finishLocalRun(runToken);
        }
        // Always clear — superseded runs skipped the inner branch but must not
        // leave drawSequenceActiveRef stuck true (blocks player + bot effects).
        setDrawSequenceActiveBoth(false);
      }
    })();
    return () => {
      // Progress renders from this draw sequence should not cancel its final pass/block result.
    };
  }, [
    match,
    userPlayMoves.length,
    appendGhostMove,
    appendMove,
    applyAndNotify,
    runDrawSequenceLocal,
    setDrawSequenceActiveBoth,
    beginLocalRun,
    isLocalRunCurrent,
    finishLocalRun,
    isGhostMode,
    isAuthoringMode,
    recordAuthoringStep,
    isMuted,
    getFritzBestMove,
    isGuidedTranscriptMode,
    currentTranscriptTurn,
    acceptGuidedTranscriptTurn,
    isGuidedV1MinimalMode,
    isGuidedV1OnlineMode,
    currentLessonStep,
    lessonStepIndex,
    pushToast,
    isDailyFritzMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    captureGuidedMatchCandidateAction,
  ]);

  useEffect(() => {
    if (!isDailyPuzzleRun || !dailyPuzzleDate || !match.gameOver) return;

    const syncKey = `${dailyPuzzleDate}|${userId ?? 'guest'}|${movesUsed}|${match.players.you.score}`;
    if (dailyResultSyncKeyRef.current === syncKey) return;
    dailyResultSyncKeyRef.current = syncKey;

    let active = true;
    const syncLeaderboard = async () => {
      if (isGuidedMode || isAuthoringMode) return;
      setDailyLeaderboardLoading(true);
      setDailyLeaderboardError(null);
      try {
        if (userId) {
          await upsertDailyPuzzleBestScore({
            puzzleDate: dailyPuzzleDate,
            userId,
            username: username?.trim() || `user_${userId.slice(0, 8)}`,
            score: match.players.you.score,
            movesUsed,
          });
        }
        const rows = await fetchDailyPuzzleLeaderboard(dailyPuzzleDate, 25);
        if (active) setDailyLeaderboard(rows);
      } catch (err) {
        if (active) {
          setDailyLeaderboardError(
            err instanceof Error ? err.message : 'Unable to load leaderboard.',
          );
          setDailyLeaderboard([]);
        }
      } finally {
        if (active) setDailyLeaderboardLoading(false);
      }
    };

    void syncLeaderboard();
    return () => {
      active = false;
    };
  }, [
    dailyPuzzleDate,
    isDailyPuzzleRun,
    match.gameOver,
    match.players.you.score,
    movesUsed,
    userId,
    username,
  ]);

  useEffect(() => {
    const updateHandTileSize = () => {
      if (lessonLayoutMode) {
        const tileCount = Math.max(1, match.players.you.hand.length);
        const handDeck = handAreaRef.current?.closest('[data-ui="live-hand-deck"]') as HTMLElement | null;
        const containerWidth = handDeck?.clientWidth
          ? Math.max(handDeck.clientWidth - 36, 220)
          : Math.max(window.innerWidth - 56, 220);
        const maxTileSize = window.innerWidth <= 1440 ? 34 : 38;
        const minTileSize = 24;
        const rowGap = window.innerWidth <= 1440 ? 10 : 12;
        const rackPadding = 28;
        const tileMargin = 8;
        const computeHalfWidth = (tilesPerRow: number) => {
          const usableWidth = Math.max(
            160,
            containerWidth - rackPadding - Math.max(0, (tilesPerRow - 1) * rowGap),
          );
          return Math.floor(usableWidth / (tilesPerRow * 2)) - tileMargin;
        };

        const singleRowHalfWidth = computeHalfWidth(tileCount);
        const shouldStack = tileCount >= 7 || singleRowHalfWidth < 28;
        const rowCount = shouldStack ? 2 : 1;
        const tilesPerRow = rowCount === 1 ? tileCount : Math.ceil(tileCount / 2);
        const resolvedHalfWidth = Math.max(
          minTileSize,
          Math.min(maxTileSize, computeHalfWidth(tilesPerRow)),
        );

        setLessonHandRowCount(rowCount);
        setHandTileSize(resolvedHalfWidth);
        return;
      }

      setLessonHandRowCount(1);

      const tileCount = Math.max(1, match.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = tileCount > 9;
      const maxTileSize = (isLandscape && isMobileWidth ? 42 : (tileCount > 9 ? 46 : 60));
      const handDeck = handAreaRef.current?.closest('[data-ui="live-hand-deck"]') as HTMLElement | null;
      const containerWidth = handDeck?.clientWidth
        ? Math.max(handDeck.clientWidth - 32, 220)
        : window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const gapBudget = 10;
      const usableWidth = containerWidth - Math.max(0, (effectiveLen - 1) * gapBudget);
      const tileWidth = Math.min(maxTileSize, Math.floor(usableWidth / effectiveLen));
      setHandTileSize(tileWidth);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [lessonLayoutMode, match.players.you.hand.length]);

  const handActive = !preGameDrawActive && !match.handOver && !match.gameOver;
  const dailyFritzBoardHasPlay = (match.board?.mainLine?.length ?? 0) > 0;
  const botTurn = match.currentPlayer === 'bot' && handActive;
  const showTurnStatusCluster =
    handActive &&
    !handReveal &&
    !isTransitioningRef.current;
  const preGameDrawHudCenter = (() => {
    if (!preGameDrawActive || !preGameDraw.drawState) return null;

    let label: string | null = null;
    let tone: 'your-turn' | 'opp-turn' = 'your-turn';

    if (preGameDraw.resultMessage) {
      label = preGameDraw.resultMessage;
      tone = preGameDraw.drawState.winner === 'bot' ? 'opp-turn' : 'your-turn';
    } else if (preGameDraw.isOpponentThinking) {
      label = `${opponentLabel} thinking`;
      tone = 'opp-turn';
    } else if (preGameDraw.isPlayerPickEnabled) {
      label = 'Tap a tile to draw';
      tone = 'your-turn';
    }

    if (!label) return null;

    return (
      <div className="wl-center-status" data-ui="turn-status">
        <span className={`wl-turn-label ${tone}`} role="status" aria-live="polite">
          {label}
        </span>
      </div>
    );
  })();
  const turnLabel = match.handOver
    ? match.gameOver
      ? match.winnerId === 'you'
        ? 'You win the match'
        : `${opponentLabel} wins the match`
      : ''
    : botTurn
      ? `${opponentLabel} thinking`
      : 'Your move';
  const canSaveGuidedMatchCandidate =
    enableGuidedMatchCandidateCapture &&
    match.gameOver &&
    guidedMatchCaptureStatus.enabled &&
    guidedMatchCaptureStatus.candidateStatus === 'complete';

  if (shouldLogBotMatchDebug() && isGuidedMode && !isAuthoringMode) {
    botMatchDebugLog('[guided-move] rendered match player hand =', match.players.you.hand.map(toTileKey));
    botMatchDebugLog('[guided-move] rendered match board mainLine length =', match.board?.mainLine.length);
    botMatchDebugLog('[guided-move] lessonStepIndex =', lessonStepIndex);
  }

  const openEnds = useMemo(() => getDisplayOpenEnds(match), [match.board]);
  const openEndsSum = useMemo(() => (match.board ? computeOpenEndsSum(match.board) : 0), [match.board]);

  useEffect(() => {
    if (!match.board) return;
    assertDisplayedOpenCountMatchesCanonical(match.board, openEndsSum, 'bot-match');
  }, [match.board, openEndsSum]);

  if (shouldLogBotMatchDebug() && isGuidedMode && !isAuthoringMode) {
    // ── BUG B INSTRUMENTATION ────────────────────────────────────────────
    // The tile-row highlight and userPlayMoves BOTH source from match.board.
    // The visible open ends (what's rendered in the main-line and hub branches)
    // must match the ends the legality computation uses. Log both, then log
    // getPlacementTargetsForTile for each tile in hand so we can see exactly
    // which tiles think they can be placed and on which end.
    if (match.board) {
      const rawRenderedEnds = [
        { side: 'left',  val: match.board.leftEnd,  isDouble: match.board.leftEndIsDouble },
        { side: 'right', val: match.board.rightEnd, isDouble: match.board.rightEndIsDouble },
        ...match.board.hubDoubles.flatMap((h, hi) =>
          h.isCrossed
            ? (h.branches ?? []).map((b, bi) =>
                b ? { side: `hub${hi}-arm${bi}`, val: b.openEnd, isDouble: b.openEndIsDouble } : null,
              )
            : [],
        ).filter(Boolean),
      ];
      botMatchDebugLog('[guided-legal] visible rendered open ends =', rawRenderedEnds);

      const legalityEnds = getMatchableOpenEnds(match.board).map((e) => ({
        position: e.position,
        val: e.matchValue,
      }));
      botMatchDebugLog('[guided-legal] legality source open ends =', legalityEnds);

      // Per-tile placement targets (what the legality layer thinks each tile can do)
      const perTileTargets = match.players.you.hand.map((tile) => ({
        tile: toTileKey(tile),
        targets: getPlacementTargetsForTile(match.board, tile),
      }));
      botMatchDebugLog('[guided-legal] placement targets for each tile in hand =', perTileTargets);

      // Mismatch detection: any legality end that isn't present among visible ends
      const visibleSet = new Set(rawRenderedEnds.map((e: any) => `${e.val}`));
      const legalityExtras = legalityEnds.filter((e) => !visibleSet.has(`${e.val}`));
      const mismatchReason =
        legalityExtras.length > 0
          ? `legality has values not visible: ${legalityExtras.map((e) => `${e.position}=${e.val}`).join(', ')}`
          : 'none';
      botMatchDebugLog('[guided-legal] mismatch reason =', mismatchReason);
      botMatchDebugLog('[GUIDED-CURRENT-SCREEN]', {
        lessonStepIndex,
        renderedHand: match.players.you.hand.map(toTileKey),
        renderedMainLineLen: match.board?.mainLine?.length ?? 0,
        renderedLeftEnd: match.board?.leftEnd,
        renderedRightEnd: match.board?.rightEnd,
        handOpen: match.handOpen,
        userLegalMoves: userLegalMoves.map((m) => ({
          type: m.type,
          tile: m.tile ? toTileKey(m.tile) : null,
          position: m.position ?? null,
        })),
        legalMoves: userPlayMoves.map((m) => ({
          tile: m.tile ? toTileKey(m.tile) : null,
          position: m.position ?? null,
        })),
      });
    }
  }
  const handRevealTileReveals = useMemo(
    () => (handReveal ? buildBotHandOverReveals(handReveal, opponentLabel) : []),
    [handReveal, opponentLabel],
  );
  const ghostAverageLabel =
    ghostProfile?.avgScore == null ? '—' : `${ghostProfile.avgScore} pts`;
  const ghostResultMessage = getGhostResultMessage(match.players.you.score, match.players.bot.score);
  const previousGhostRating =
    ghostResult == null
      ? ghostProfile?.ghostRating ?? 800
      : ghostResult.newRating - ghostResult.ratingDelta;
  const fritzGlickoDelta =
    !isGhostMode && ghostResult?.glickoDelta != null
      ? roundedRatingDelta(ghostResult.glickoDelta)
      : !isGhostMode && ghostResult?.glickoRating != null && matchStartGlickoRating != null
        ? roundedRatingDelta(ghostResult.glickoRating - matchStartGlickoRating)
      : null;
  const fritzNewGlickoRating =
    !isGhostMode && ghostResult?.glickoRating != null
      ? Math.round(ghostResult.glickoRating)
      : null;
  const hasConfirmedFritzRatingUpdate =
    fritzGlickoDelta != null || (!isGhostMode && ghostResult != null);
  const ghostRatingDeltaLabel = ghostResult
    ? `${ghostResult.ratingDelta >= 0 ? '+' : ''}${ghostResult.ratingDelta}`
    : null;
  const onShareGhostCard = async () => {
    const result = ghostResult;
    if (!result) return;
    await shareGhostResultCard({
      playerScore: result.playerScore,
      ghostScore: result.ghostScore,
      previousRating: previousGhostRating,
      newRating: result.newRating,
      ratingDelta: result.ratingDelta,
      message: ghostResultMessage,
    });
  };

  if (!match || !match.players || !match.players.you || !match.players.bot) {
    return (
      <div className="screen game-screen walnut-live theme-green bot-match-screen" style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ textAlign: 'center', color: 'white', padding: 40 }}>
          <h3>Game State Error</h3>
          <p>The match state is incomplete or malformed.</p>
          <button className="btn rh-back-button" onClick={exitMatch}>← Back to Home</button>
        </div>
      </div>
    );
  }


  const isFullscreenReady = true;
  const isLessonLayoutMode = lessonLayoutMode;

  const isGuidedV2FritzResolving =
    isGuidedV2Mode &&
    !isGuidedV2OffLine &&
    currentV2CursorEvent?.actor === 'fritz';

  const isHandOverTransitionOpen = Boolean(handReveal) || isTransitioningRef.current;

  const isAwaitingPlayerTurnAction =
    handActive &&
    match.currentPlayer === 'you' &&
    !botTurn &&
    !drawSequenceActive &&
    !handReveal &&
    !isTransitioningRef.current &&
    !isGuidedV2FritzResolving &&
    (!isGuidedV2Mode || isGuidedV2OffLine || currentV2CursorEvent?.actor === 'player');

  /** Player may see authored coaching, recommendations, and Play Move. */
  const showPlayerCoaching =
    isLessonLayoutMode &&
    isAwaitingPlayerTurnAction &&
    !match.handOver &&
    !match.gameOver &&
    !isHandOverTransitionOpen;

  const showFritzCoachingPanel =
    isLessonLayoutMode &&
    !showPlayerCoaching &&
    !isHandOverTransitionOpen &&
    !match.gameOver &&
    (isGuidedV2FritzResolving || (botTurn && !drawSequenceActive));

  const canPlayCoachedMove = showPlayerCoaching;

  const lessonRecommendedTileKey = !showPlayerCoaching
    ? null
    : isGuidedV2Mode && !isGuidedV2OffLine
      ? currentExpectedV2PlayerEvent?.action === 'play'
        ? currentExpectedV2PlayerEvent.tile ?? null
        : null
      : isGuidedTranscriptMode
        ? currentTranscriptTurn?.expectedPlayerMove.type === 'play' && currentTranscriptTurn.expectedPlayerMove.tile
          ? currentTranscriptTurn.expectedPlayerMove.tile
          : null
        : isGuidedFrozenLessonMode && currentLessonStep?.chosenMove
          ? currentLessonStep.chosenMove.split(':')[0]?.replace('|', '-') ?? null
          : null;

  const showLessonCoachPanel =
    isLessonLayoutMode &&
    !match.gameOver;
  const youHandTileCount = match.players.you.hand.length;
  const normalHandRows = isLessonLayoutMode
    ? (() => {
        const tiles = match.players.you.hand;
        if (lessonHandRowCount <= 1 || tiles.length <= 1) return [tiles];
        const midpoint = Math.ceil(tiles.length / 2);
        return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
      })()
    : youHandTileCount > 9
    ? (() => {
        const tiles = match.players.you.hand;
        const isMobile = typeof window !== 'undefined' && window.innerWidth <= 600;
        if (isMobile && tiles.length === 7) {
          return [tiles.slice(0, 4), tiles.slice(4)];
        }
        const midpoint = Math.ceil(tiles.length / 2);
        return [tiles.slice(0, midpoint), tiles.slice(midpoint)];
      })()
    : [match.players.you.hand];
  const handCompactStacked = normalHandRows.length > 1;

  const lessonCoachVm: GuidedCoachViewModel | null = showLessonCoachPanel
    ? (() => {
        if (isGuidedTranscriptMode && guidedTranscript) {
          return {
            stepIndex: lessonStepIndex,
            totalSteps: guidedTranscript.turns.length,
            coachingText: showPlayerCoaching ? (currentTranscriptTurn?.coachingText ?? '') : '',
            canBestMove:
              showPlayerCoaching &&
              !isOffAuthoredLine &&
              currentTranscriptTurn?.expectedPlayerMove.type === 'play' &&
              userPlayMoves.length > 0,
            isOffAuthoredLine,
          };
        }
        if (isGuidedFrozenLessonMode && frozenLesson) {
          return {
            stepIndex: lessonStepIndex,
            totalSteps: getGuidedV1OrderedAuthoredSteps(frozenLesson).length,
            coachingText: showPlayerCoaching ? (currentLessonStep?.coachingText ?? '') : '',
            canBestMove: Boolean(
              showPlayerCoaching &&
              !isOffAuthoredLine &&
              currentLessonStep?.chosenMove &&
              currentLessonStep.chosenMove !== 'draw' &&
              currentLessonStep.chosenMove !== 'pass' &&
              userPlayMoves.length > 0,
            ),
            isOffAuthoredLine,
          };
        }
        if (wantsOriginalGuidedRecordMode && guidedTranscript) {
          return {
            stepIndex: guidedTranscript.turns.findIndex((turn) => turn.stepIndex === lessonStepIndex),
            totalSteps: guidedTranscript.turns.length,
            coachingText: currentTranscriptTurn?.coachingText ?? '',
            canBestMove: false,
            isOffAuthoredLine: false,
          };
        }
        if (guidedV2PlaybackReady && frozenV2Lesson) {
          const totalPlayerPlays = frozenV2Lesson.events.filter(
            (event) => event.actor === 'player' && event.action === 'play',
          ).length;
          return {
            stepIndex: frozenV2Lesson.events
              .slice(0, guidedV2EventIndex)
              .filter((event) => event.actor === 'player' && event.action === 'play').length,
            totalSteps: Math.max(totalPlayerPlays, 1),
            coachingText: showPlayerCoaching ? currentV2CoachingText : '',
            coachingSummary: showPlayerCoaching
              ? currentExpectedV2PlayerEvent?.coachingSummary
              : undefined,
            canBestMove: Boolean(
              showPlayerCoaching &&
              !isGuidedV2OffLine &&
              currentExpectedV2PlayerEvent &&
              currentExpectedV2PlayerEvent.actor === 'player' &&
              currentExpectedV2PlayerEvent.action === 'play' &&
              currentExpectedV2PlayerEvent.tile &&
              userPlayMoves.some(
                (move) => move.tile && toTileKey(move.tile) === currentExpectedV2PlayerEvent.tile,
              )
            ),
            isOffAuthoredLine: isGuidedV2OffLine,
          };
        }
        return null;
      })()
    : null;

  const lessonCoachProgressCount = lessonCoachVm ? Math.max(lessonCoachVm.stepIndex, 0) + 1 : 1;
  const lessonCoachProgressTotal = lessonCoachVm ? Math.max(lessonCoachVm.totalSteps, 1) : 1;
  const lessonCoachProgressPct = lessonCoachVm
    ? Math.max(0, Math.min(100, (lessonCoachProgressCount / lessonCoachProgressTotal) * 100))
    : 0;
  const lessonCoachProgressLabel = `${lessonCoachProgressCount} / ${lessonCoachProgressTotal}`;
  const lessonCoachContent = useMemo(
    () => parseGuidedLessonCoachContent(
      lessonCoachVm?.coachingText ?? '',
      lessonCoachVm?.coachingSummary,
    ),
    [lessonCoachVm?.coachingText, lessonCoachVm?.coachingSummary],
  );
  const lessonCoachBodyText = useMemo(
    () => lessonCoachContent.bodyParagraphs.join('\n\n'),
    [lessonCoachContent.bodyParagraphs],
  );
  const lessonCoachPreviewText = useMemo(
    () => buildCoachPreviewText(lessonCoachBodyText, lessonCoachContent.summary),
    [lessonCoachBodyText, lessonCoachContent.summary],
  );
  const showCoachMoreButton = useMemo(() => {
    if (!showPlayerCoaching || lessonCoachVm?.isOffAuthoredLine) return false;
    const body = lessonCoachBodyText.trim();
    if (!body) return false;
    return body.length > lessonCoachPreviewText.length + GUIDED_COACH_MORE_MIN_EXTRA_CHARS;
  }, [
    lessonCoachBodyText,
    lessonCoachPreviewText,
    lessonCoachVm?.isOffAuthoredLine,
    showPlayerCoaching,
  ]);
  const lessonRecommendedTileLabel = formatLessonTileLabel(lessonRecommendedTileKey);
  const showCoachedRecommendation =
    showPlayerCoaching &&
    showRecommendation &&
    Boolean(lessonCoachVm?.canBestMove);

  const lessonBoardPlacementMoves = showPlayerCoaching ? activePlacementMoves : [];

  const lessonCoachPanelContent = useMemo(() => {
    if (!lessonCoachVm) return null;
    if (lessonCoachVm.isOffAuthoredLine) {
      return {
        title: 'Live position',
        bodyParagraphs: [
          'You went off the authored line. This hand continues live from here, so the coaching now follows the live position.',
        ],
        previewText: '',
        showMore: false,
        showFooter: false,
        progressChipLabel: lessonCoachProgressLabel,
        contextChips: [] as string[],
      };
    }
    if (showFritzCoachingPanel) {
      return {
        title: 'Fritz is playing',
        bodyParagraphs: [
          'Watch the board change. Your next coaching tip appears when it is your turn.',
        ],
        previewText: '',
        showMore: false,
        showFooter: false,
        progressChipLabel: 'Fritz turn',
        contextChips: ['Fritz turn'],
      };
    }
    if (isHandOverTransitionOpen) {
      return {
        title: 'Hand complete',
        bodyParagraphs: ['Review the hand result, then continue when you are ready.'],
        previewText: '',
        showMore: false,
        showFooter: false,
        progressChipLabel: lessonCoachProgressLabel,
        contextChips: [] as string[],
      };
    }
    if (showPlayerCoaching) {
      return {
        title: lessonCoachContent.title,
        bodyParagraphs: lessonCoachContent.bodyParagraphs,
        previewText: lessonCoachPreviewText,
        showMore: showCoachMoreButton,
        showFooter: true,
        progressChipLabel: lessonCoachProgressLabel,
        contextChips: [
          currentExpectedV2PlayerEvent ? `Hand ${currentExpectedV2PlayerEvent.handNumber}` : '',
          `Move ${lessonCoachProgressCount}`,
          lessonRecommendedTileLabel ? `Play ${lessonRecommendedTileLabel}` : '',
        ].filter(Boolean),
      };
    }
    return {
      title: 'Guided Match',
      bodyParagraphs: ['Coaching will appear when it is your turn to play.'],
      previewText: '',
      showMore: false,
      showFooter: false,
      progressChipLabel: lessonCoachProgressLabel,
      contextChips: [] as string[],
    };
  }, [
    currentExpectedV2PlayerEvent,
    isHandOverTransitionOpen,
    lessonCoachContent.bodyParagraphs,
    lessonCoachContent.title,
    lessonCoachPreviewText,
    lessonCoachProgressCount,
    lessonCoachProgressLabel,
    lessonCoachVm,
    lessonRecommendedTileLabel,
    showCoachMoreButton,
    showFritzCoachingPanel,
    showPlayerCoaching,
  ]);

  useEffect(() => {
    setShowFullCoachTip(false);
  }, [lessonCoachVm?.stepIndex]);

  useEffect(() => {
    if (!showFullCoachTip) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowFullCoachTip(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showFullCoachTip]);

  const handTray = preGameDrawActive && preGameDraw.drawState ? (
    <div className="hand-area wl-hand-area pre-game-draw-hand-dock" data-ui="tray" aria-hidden="true" />
  ) : (
    <div
      className="hand-area wl-hand-area"
      data-ui="tray"
    >
      <div className="tray-rail">
        <div className="tray-center" ref={handAreaRef}>
            <div
              className={`hand-container ${
                handCompactStacked ? 'is-stacked' : ''
              } ${normalHandRows.length > 1 ? 'has-multiple-rows' : 'has-single-row'}`}
            >
              {normalHandRows.map((row, rowIdx) => (
                <div key={`bot-hand-row-${rowIdx}`} className="hand-row">
                  {row.map((tile, idx) => {
                    const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                    const showLegality = handActive && !botTurn && !drawSequenceActive;
                    const { highlight: legalityHighlight, unplayable: isUnplayable } = getHandTileLegality(
                      tile,
                      showLegality,
                      playableTileKeys,
                    );
                    const playable = legalityHighlight;
                    const absoluteIdx = match.players.you.hand.findIndex((handTile) => tileEquals(handTile, tile));
                    const tileKey = `${tile.low}-${tile.high}`;
                    const guidedPts = isGuidedMode ? (guidedScoringTiles.get(tileKey) ?? 0) : 0;
                    const guidedClass = isGuidedMode && playable
                      ? guidedPts > 0 ? 'guided-scoring' : 'guided-legal'
                      : '';
                    const isRecommendedLessonTile =
                      showCoachedRecommendation &&
                      lessonRecommendedTileKey != null &&
                      lessonRecommendedTileKey === toTileKey(tile);
                    const baseClass = drawPulseIndex === absoluteIdx ? 'new-draw' : '';
                    return (
                      <div
                        key={`bot-hand-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                        className={`guided-tile-wrap${isGuidedMode && playable && guidedPts > 0 ? ' has-badge' : ''}${isRecommendedLessonTile ? ' is-recommended' : ''}`}
                      >
                        {isGuidedMode && playable && guidedPts > 0 && (
                          <span className="guided-score-badge">+{guidedPts}</span>
                        )}
                        <DominoTile
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          className={[
                            baseClass,
                            guidedClass,
                            isRecommendedLessonTile ? 'is-coached-recommended' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          selected={selected}
                          highlight={legalityHighlight}
                          unplayable={isUnplayable}
                          disabled={!handActive || botTurn || drawSequenceActive}
                          onClick={() => {
                            if (isDailyFritzMode) {
                              traceDailyFritzEvent('[input] tile click', {
                                tile: toTileKey(tile),
                                playable,
                                handActive,
                                botTurn,
                                drawSequenceActive,
                              });
                            }
                            if (!handActive || botTurn) return;
                            if (!playable) return;
                            setSelectedTile(tile);
                            setSelectedController('you');
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
    </div>
  );

  const boardStageInner = (
    <>
        {preGameDrawActive && preGameDraw.drawState ? (
          <PreGameTileDrawBoard
            drawState={preGameDraw.drawState}
            isPlayerPickEnabled={preGameDraw.isPlayerPickEnabled}
            onTileTap={preGameDraw.handlePlayerTileTap}
          />
        ) : (
          <>
        {scoreToast && (
          <div
            style={{
              position: 'absolute',
              top: 16,
              left: '50%',
              transform: scoreToast.visible ? 'translate(-50%, 0px)' : 'translate(-50%, -14px)',
              opacity: scoreToast.visible ? 1 : 0,
              transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              zIndex: 14,
              background: 'rgba(255,255,255,0.06)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 999,
              padding: '10px 22px',
              color: scoreToast.tone === 'you'
                ? 'rgba(151, 241, 205, 0.98)'
                : 'rgba(255, 180, 180, 0.95)',
              fontSize: '1.24rem',
              fontWeight: 700,
              letterSpacing: '0.04em',
              lineHeight: 1,
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              pointerEvents: 'none',
              boxShadow: scoreToast.tone === 'you'
                ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
                : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
            }}
          >
            {renderScoreToastMessage(scoreToast.message)}
          </div>
        )}
        {enableGuidedMatchCandidateCapture && (
          <div
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              zIndex: 16,
              display: 'grid',
              gap: 2,
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid rgba(103,217,87,0.28)',
              background: 'rgba(6,12,20,0.82)',
              color: 'rgba(228,242,232,0.9)',
              fontSize: 11,
              lineHeight: 1.25,
              pointerEvents: 'auto',
            }}
          >
            <strong style={{ color: 'rgba(141,231,165,0.95)' }}>
              Capture: {guidedMatchCaptureStatus.enabled ? 'on' : 'off'}
            </strong>
            <span>Events: {guidedMatchCaptureStatus.eventCount}</span>
            <span>Candidate: {guidedMatchCaptureStatus.candidateStatus}</span>
            <span>Last: {guidedMatchCaptureStatus.lastEventId ?? '-'}</span>
            <span>Save unlocks at match over</span>
            <button
              type="button"
              onClick={copyGuidedMatchCandidate}
              style={{
                marginTop: 4,
                padding: '4px 7px',
                borderRadius: 6,
                border: '1px solid rgba(141,231,165,0.28)',
                background: 'rgba(141,231,165,0.1)',
                color: 'rgba(228,242,232,0.94)',
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Copy Draft JSON
            </button>
          </div>
        )}
        {!match.gameOver && !isLessonLayoutMode && (
          <div
            className="rh-board-meta-bar"
            data-ui="board-meta"
          >
            <BoardOpenEndsPill board={match.board} openEndsSum={openEndsSum} />
            <BoneyardCountPill ref={boneyardRef} count={match.boneyard.length} />
          </div>
        )}
        {isGhostMode && ghostAgreementType && (
          <div className={`ghost-agreement-indicator ${ghostAgreementType}`}>
            {ghostAgreementType === 'agrees' ? '✓ Ghost agrees' : '✓ Ghost thinks so'}
          </div>
        )}
        {isGhostMode && ghostPlayedTile && (
          <div className="ghost-played-overlay" aria-hidden="true">
            <DominoTile tile={ghostPlayedTile} size={52} className="ghost-played-tile" />
          </div>
        )}
        {(isAuthoringMode || isAuthoringV2Mode) && match.currentPlayer === 'you' && !match.handOver && !match.gameOver && (
          <AuthoringCoachPanel
            stepIndex={isAuthoringV2Mode ? authoringV2PlayerMoveIndex : authoringSteps.length}
            noteText={authoringNoteText}
            onNoteChange={setAuthoringNoteText}
            onSaveNote={saveAuthoringNoteOnly}
          />
        )}
        {isGuidedMode && !isAuthoringMode && !isLessonLayoutMode && !frozenLesson && (
          <CoachPanel
            preMoveRec={coach.preMoveRec}
            preMoveEval={coach.preMoveEval}
            postMoveFeedback={coach.postMoveFeedback}
            postMoveEval={coach.postMoveEval}
            onPlayBest={playBestMove}
            onDismissFeedback={coach.dismissFeedback}
            isOnlyPlay={guidedCoachTip?.isOnlyPlay ?? false}
            currentPlayer={match.currentPlayer === 'you' ? 'you' : 'bot'}
            turnIndex={match.turnIndex ?? 0}
            debugMode={showDebug}
          />
        )}
        {isGuidedMode && showDebug && frozenLesson && (() => {
          const renderedHand = match.players.you.hand.map((t) => `${t.low}|${t.high}`);
          const frozenStep0Hand = frozenLesson.steps[0]?.playerHand ?? [];
          const handsMatch =
            renderedHand.slice().sort().join(',') === frozenStep0Hand.slice().sort().join(',');
          const isMismatch = guidedInitSourceRef.current === 'seeded-deal' && !handsMatch;
          return (
            <div style={{
              position: 'fixed',
              top: 8,
              left: 8,
              right: 8,
              zIndex: 9999,
              background: isMismatch ? 'rgba(180,30,20,0.92)' : 'rgba(0,0,0,0.82)',
              border: isMismatch
                ? '2px solid rgba(255,80,60,0.9)'
                : '1px solid rgba(100,220,160,0.4)',
              borderRadius: 8,
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: '0.68rem',
              color: 'rgba(220,240,230,0.92)',
              lineHeight: 1.7,
              pointerEvents: 'none',
            }}>
              {isMismatch && (
                <div style={{ color: 'rgba(255,120,100,1)', fontWeight: 700, marginBottom: 4, fontSize: '0.75rem' }}>
                  ⚠ GUIDED HAND MISMATCH — matchStateJson absent, seeded PRNG gave WRONG GAME
                </div>
              )}
              <div>
                <span style={{ color: 'rgba(180,200,190,0.6)' }}>source: </span>
                <span style={{ color: isMismatch ? 'rgba(255,160,100,1)' : 'rgba(100,240,160,0.9)', fontWeight: 600 }}>
                  {guidedInitSourceRef.current ?? '—'}
                </span>
              </div>
              <div>
                <span style={{ color: 'rgba(180,200,190,0.6)' }}>rendered: </span>
                {renderedHand.join(' · ') || '—'}
              </div>
              <div>
                <span style={{ color: 'rgba(180,200,190,0.6)' }}>frozen s0: </span>
                {frozenStep0Hand.join(' · ') || '—'}
              </div>
              <div style={{ marginTop: 2, fontWeight: 700, color: handsMatch ? 'rgba(100,240,160,0.95)' : 'rgba(255,100,80,1)' }}>
                {handsMatch ? '✓ hands match' : '✗ HANDS DIFFER'}
              </div>
            </div>
          );
        })()}
        {isDailyFritzMode && showDebug && (
          <div style={{
            position: 'fixed',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 9999,
            background: 'rgba(10,20,40,0.88)',
            border: '1px solid rgba(80,160,255,0.4)',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'monospace',
            fontSize: '0.68rem',
            color: 'rgba(200,220,255,0.92)',
            lineHeight: 1.8,
            pointerEvents: 'none',
          }}>
            <div style={{ fontWeight: 700, fontSize: '0.72rem', color: 'rgba(100,180,255,1)', marginBottom: 2 }}>
              ⚙ Daily Fritz Debug
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>phase: </span>
              <span style={{ fontWeight: 600, color: 'rgba(100,240,200,0.95)' }}>{lastDailyFlowLabelRef.current}</span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>hand: </span>{match.handNumber}
              {'  '}
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>player: </span>
              <span style={{ color: match.currentPlayer === 'you' ? 'rgba(100,255,160,0.9)' : 'rgba(255,180,80,0.9)' }}>
                {match.currentPlayer}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>score: </span>
              you {match.players.you.score} · bot {match.players.bot.score}
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>handOver: </span>
              <span style={{ color: match.handOver ? 'rgba(255,200,80,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {String(match.handOver)}
              </span>
              {'  '}
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>gameOver: </span>
              <span style={{ color: match.gameOver ? 'rgba(255,100,80,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {String(match.gameOver)}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>revealTimer: </span>
              <span style={{ color: handRevealTimerRef.current !== null ? 'rgba(255,220,60,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {handRevealTimerRef.current !== null ? '⏱ running' : 'idle'}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>handReveal: </span>
              <span style={{ color: handReveal !== null ? 'rgba(255,220,60,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {handReveal !== null ? '✓ visible' : 'null'}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>nextHandReady: </span>
              <span style={{ color: dailyFritzNextHandRef.current?.result != null ? 'rgba(100,255,160,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {dailyFritzNextHandRef.current?.result != null ? '✓ prefetched' : dailyFritzNextHandRef.current?.promise != null ? '⏳ in-flight' : 'none'}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>transitionInFlight: </span>
              <span style={{ color: handTransitionInFlightRef.current ? 'rgba(255,180,60,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {String(handTransitionInFlightRef.current)}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(140,170,210,0.7)' }}>submitSucceeded: </span>
              <span style={{ color: dailyFritzSubmitSucceededRef.current ? 'rgba(100,255,160,0.9)' : 'rgba(140,170,210,0.55)' }}>
                {String(dailyFritzSubmitSucceededRef.current)}
              </span>
            </div>
          </div>
        )}
        <Board
          ref={boardRef}
          showZoomTray={isLessonLayoutMode}
          board={match.board}
          legalMoves={isLessonLayoutMode ? lessonBoardPlacementMoves : activePlacementMoves}
          selectedTile={selectedTile}
          handNumber={match.handNumber}
          handOver={match.handOver}
          gameOver={match.gameOver}
          lastPlayedTile={lastPlayedTile}
          onPositionClick={onPositionClick}
          tileSize={84}
          profileDailyFritz={enableDailyFritzProfiling}
          fitMode="default"
        />
        {!isLessonLayoutMode && (
          <div
            className="wl-controls-tray control-pill"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              zIndex: 20,
            }}
          >
            <button
              type="button"
              className="wl-control-btn"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                boardRef.current?.zoomOut();
              }}
            >
              <ZoomOutIcon />
            </button>
            <button
              type="button"
              className="wl-control-btn"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                boardRef.current?.zoomIn();
              }}
            >
              <ZoomInIcon />
            </button>
            <button
              type="button"
              className="wl-control-btn"
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? 'Unmute' : 'Mute'}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              <VolumeIcon isMuted={isMuted} />
            </button>
            <button
              type="button"
              className="wl-control-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
            <button
              type="button"
              className="wl-control-btn"
              onClick={() => setShowLeaveConfirm(true)}
              title="Leave game"
              aria-label="Leave game"
            >
              <HomeIcon />
            </button>
          </div>
        )}
          </>
        )}
    </>
  );

  if (isGuidedV2Mode && guidedV2BootError) {
    return (
      <>
        <RotateOverlay />
        <div
          className="screen game-screen walnut-live theme-green bot-match-screen learn-lesson-screen learn-pvf-root pvf-root tier-rookie"
          style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 0', overflow: 'hidden' }}
        >
          <div className="home-bg" aria-hidden="true">
            <div className="home-bg__halo" />
          </div>
          <div
            className="learn-guided-pvf"
            data-ui="guided-boot-error"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}
          >
            <div className="learn-guided-hero-card" style={{ maxWidth: 520, width: '100%' }}>
              <div className="learn-guided-hero-card__content">
                <p className="learn-guided-hero-card__eyebrow">Guided Match</p>
                <h2 className="learn-guided-hero-card__title">Lesson not available</h2>
                <p className="learn-guided-hero-card__description">{guidedV2BootError}</p>
                <button type="button" className="pvf-back-btn rh-back-button" onClick={onBack} style={{ marginTop: 24 }}>
                  ← Back to Learn
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  const boardStage = (
    <div ref={boardStageRef} className="wl-stage-shell">
      <MatchNblBoardFrame className={ghostBoardPulse ? 'ghost-board-pulse' : undefined}>
        {boardStageInner}
      </MatchNblBoardFrame>
    </div>
  );

  return (
    <>
      <RotateOverlay />
      <div
        ref={rootRef}
        className={`screen game-screen walnut-live theme-green bot-match-screen rh-match-live bot-match-mode-${mode} ${isDailyFritzMode && dailyFritzBoardHasPlay ? 'df-board-has-play' : ''} ${isLessonLayoutMode ? 'learn-lesson-screen learn-pvf-root pvf-root tier-rookie claude-mode-screen-shell' : ''}`}
      >
      {isLessonLayoutMode && (
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
          <div className="home-bg__domino home-bg__domino--tl" />
          <div className="home-bg__domino home-bg__domino--tr" />
          <div className="home-bg__line home-bg__line--1" />
          <div className="home-bg__line home-bg__line--2" />
          <div className="home-bg__line home-bg__line--3" />
          <div className="home-bg__texture" />
        </div>
      )}

      <ScoreTrackOverlay
        open={scoreTrackOpen}
        onClose={() => setScoreTrackOpen(false)}
        target={winningScore}
        players={[
          { label: opponentLabel, score: match.players.bot.score, tone: 'opp' },
          { label: 'You', score: match.players.you.score, tone: 'you' },
        ]}
      />
      {false && toast && <div className="toast">{toast}</div>}
      {handReveal && !match.gameOver && (
        <GameOverlayPortal>
          <HandOverModal
            variant="sp"
            pointsAwarded={handReveal.pointsAwarded}
            winnerSide={resolveWinnerSide(handReveal.winner)}
            winnerLabel={winnerDisplayLabel(resolveWinnerSide(handReveal.winner), opponentLabel)}
            loserLabel={loserDisplayLabel(resolveWinnerSide(handReveal.winner), opponentLabel)}
            loserPips={handReveal.loserPips}
            reasonCopy={buildHandOverReasonCopy({
              youWentOut: handReveal.reason !== 'blocked' && handReveal.winner === 'you',
              opponentWentOut: handReveal.reason !== 'blocked' && handReveal.winner === 'bot',
              isBlocked: handReveal.reason === 'blocked',
              opponentName: opponentLabel,
              pointsAwarded: handReveal.pointsAwarded,
            })}
            tileReveals={handRevealTileReveals}
            nextHandLabel="Next hand starting..."
            nextHandHint={buildNextHandDealingHint({
              completedHandNumber: match.handNumber,
              isDailyFritzMode,
              opponentLabel,
            })}
            progress={isGuidedMode || isGuidedV2Mode ? undefined : handRevealProgress}
            progressTransitionMs={
              isGuidedMode || isGuidedV2Mode ? undefined : DAILY_FRITZ_AUTO_ADVANCE_MS
            }
            learningRecap={
              isGuidedMode && coach.handSummary ? (
                <LearningHandRecap summary={coach.handSummary} />
              ) : undefined
            }
            footer={
              ghostResultError ? (
                <footer className="hand-over-modal__footer">
                  <div className="hand-over-error-zone">
                    <span className="hand-over-error-text" title={ghostResultError}>
                      {ghostResultError}
                    </span>
                    <button
                      type="button"
                      className="mode-inline-btn"
                      onClick={() => {
                        setGhostResultError(null);
                        advanceHand();
                      }}
                    >
                      Retry
                    </button>
                  </div>
                </footer>
              ) : showManualHandAdvance || handAdvanceError ? (
                <footer className="hand-over-modal__footer">
                  <div className="hand-over-error-zone">
                    {handAdvanceError ? (
                      <span className="hand-over-error-text" title={handAdvanceError}>
                        {handAdvanceError}
                      </span>
                    ) : (
                      <span className="hand-over-modal__next-hint">
                        Next hand is taking longer than expected.
                      </span>
                    )}
                    <button
                      type="button"
                      className="mode-inline-btn"
                      onClick={() => {
                        setHandAdvanceError(null);
                        handTransitionInFlightRef.current = false;
                        dailyFritzNextHandRef.current = null;
                        advanceHand();
                      }}
                    >
                      {handAdvanceError ? 'Retry' : 'Continue'}
                    </button>
                  </div>
                </footer>
              ) : isGuidedMode || isGuidedV2Mode ? (
                <footer className="hand-over-modal__footer">
                  <button type="button" className="pvf-start-btn" onClick={advanceHand}>
                    <span>Next Hand</span>
                    <span className="pvf-start-arrow" aria-hidden>
                      ›
                    </span>
                  </button>
                </footer>
              ) : undefined
            }
          />
        </GameOverlayPortal>
      )}
      {showPostGameOverlays && isDailyFritzMode && dailyFritzSetOverlay && dailyFritzSetOverlay.kind === 'final' ? (
        <GameOverlayPortal>
          <DailyFritzFinalResultOverlay
            overlay={dailyFritzSetOverlay}
            shareDone={shareCopied}
            onShare={handleShareResult}
          />
        </GameOverlayPortal>
      ) : null}
      {showPostGameOverlays && isDailyFritzMode && dailyFritzSetOverlay && dailyFritzSetOverlay.kind !== 'final' ? (
        <GameOverlayPortal>
        <div className="game-over-overlay daily-fritz-set-overlay" role="dialog" aria-label="Daily Fritz set interstitial">
          <div className="game-over-card daily-fritz-set-overlay-card" onClick={(event) => event.stopPropagation()}>
            <div className="daily-fritz-set-overlay-hero">
              <span className="daily-fritz-set-overlay-kicker">{dailyFritzSetOverlay.eyebrow}</span>
              {dailyFritzSetOverlay.skunkBadge ? (
                <span className="daily-fritz-skunk-badge" aria-label="Skunk result">
                  {dailyFritzSetOverlay.skunkBadge}
                </span>
              ) : null}
              <h2 className="daily-fritz-set-overlay-title">{dailyFritzSetOverlay.headline}</h2>
              <p className="daily-fritz-set-overlay-copy">{dailyFritzSetOverlay.subheadline}</p>
            </div>

            <div className="daily-fritz-set-overlay-stats" aria-label="Daily Fritz set summary">
              <div className="daily-fritz-set-overlay-stat">
                <span>{dailyFritzSetOverlay.gameScoreLabel || 'This game'}</span>
                <strong>{dailyFritzSetOverlay.gameScoreValue || '—'}</strong>
              </div>
              <div className="daily-fritz-set-overlay-stat">
                <span>Set Score</span>
                <strong>{dailyFritzSetOverlay.setScoreValue || '—'}</strong>
              </div>
              <div className="daily-fritz-set-overlay-stat">
                <span>Set Margin</span>
                <strong className={`is-${dailyFritzSetOverlay.marginTone}`}>
                  {dailyFritzSetOverlay.marginValue || '—'}
                </strong>
              </div>
            </div>

            <div className="daily-fritz-set-overlay-tracker" aria-label="Best of three tracker">
              {dailyFritzSetOverlay.tracker.map((item) => (
                <div key={item.gameNumber} className={`daily-fritz-set-overlay-step is-${item.tone}`}>
                  <span>Game {item.gameNumber}</span>
                  <strong>{item.label}</strong>
                </div>
              ))}
            </div>

            {dailyFritzSetOverlay.objective ? (
              <div className="daily-fritz-set-overlay-objective">
                {dailyFritzSetOverlay.nextLabel ? <span>{dailyFritzSetOverlay.nextLabel}</span> : null}
                <p>{dailyFritzSetOverlay.objective}</p>
              </div>
            ) : null}

            {dailyFritzSetOverlay.practiceHint ? (
              <p className="daily-fritz-practice-hint">{dailyFritzSetOverlay.practiceHint}</p>
            ) : null}

            <p className="daily-fritz-trust-note">{FRITZ_POSTGAME_TRUST_LINE}</p>

            {dailyFritzSetOverlay.errorMessage ? (
              <div className="hand-over-error-zone">
                <span className="hand-over-error-text" title={dailyFritzSetOverlay.errorMessage}>
                  {dailyFritzSetOverlay.errorMessage}
                </span>
              </div>
            ) : null}

            <div className="daily-fritz-set-overlay-actions">
              <button
                type="button"
                className={`daily-fritz-set-overlay-primary is-${dailyFritzSetOverlay.primaryTone}`}
                onClick={dailyFritzSetOverlay.onPrimary}
                disabled={dailyFritzSetOverlay.primaryDisabled}
              >
                {dailyFritzSetOverlay.primaryLabel}
              </button>
              {dailyFritzSetOverlay.secondaryLabel ? (
                <button
                  type="button"
                  className="daily-fritz-set-overlay-secondary"
                  onClick={dailyFritzSetOverlay.onSecondary}
                >
                  {dailyFritzSetOverlay.secondaryLabel}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        </GameOverlayPortal>
      ) : null}
      {pivotalReviewOpen && pivotalSelection ? (
        <PivotalTurnReviewCard
          open
          accent="gold"
          selection={pivotalSelection}
          onComplete={completePivotalTurnReview}
        />
      ) : null}
      {pivotalReviewSummary && pivotalSelection ? (
        <PivotalReviewSummary
          open
          accent="gold"
          session={pivotalReviewSummary}
          candidates={pivotalSelection.candidates}
          onSaveAndClose={savePivotalReviewSummary}
          onFullGameReview={openFullGameReviewFromSummary}
        />
      ) : null}
      {showPostGameReviewPrompt && postGameAnalysis ? (
        <PostGameReviewPrompt
          open
          accent="gold"
          modeLabel="Play vs Fritz"
          resultLabel={match.winnerId === 'you' ? 'Victory' : 'Defeat'}
          won={match.winnerId === 'you'}
          youScore={match.players.you.score}
          opponentScore={match.players.bot.score}
          opponentLabel={opponentLabel}
          accuracy={postGameAnalysis.accuracy}
          accuracyGrade={postGameAnalysis.grade}
          onReviewPivotalTurns={openPivotalTurnReviewFromPrompt}
          onFullGameReview={openFullGameReviewFromPrompt}
          onSkip={skipPostGameReview}
        />
      ) : null}
      {showPlayVsFritzResultOverlay && (
        <PlayVsFritzResultOverlay
          won={match.winnerId === 'you'}
          opponentLabel={opponentLabel}
          dealSize={match.dealSize}
          youScore={match.players.you.score}
          botScore={match.players.bot.score}
          ratingSlot={
            isJourneyTrial ? undefined : ghostResultLoading || ghostResultError || hasConfirmedFritzRatingUpdate || fritzNewGlickoRating != null ? (
              <div className="df-result-meta-pill">
                <span className="df-result-meta-label">Rating</span>
                <span className="df-result-meta-value">
                  {ghostResultLoading
                    ? (currentGlickoRating ?? matchStartGlickoRating) != null
                      ? `${Math.round(Number(currentGlickoRating ?? matchStartGlickoRating))}  •  syncing...`
                      : 'Syncing...'
                    : fritzGlickoDelta != null && fritzNewGlickoRating != null
                      ? `${formatRatingDelta(fritzGlickoDelta)}  •  ${fritzNewGlickoRating}`
                      : fritzNewGlickoRating != null
                        ? `${fritzNewGlickoRating}`
                        : ghostResultError
                          ? ghostResultError
                          : ghostResult
                            ? 'Saved, rating unavailable'
                            : 'Rating unavailable'}
                </span>
              </div>
            ) : undefined
          }
          onRematch={startFreshMatch}
          onChangeSetup={returnToFritzSetup}
          onHome={onNavigate ? goHome : undefined}
          showHome={Boolean(onNavigate)}
          customActions={
            isJourneyTrial
              ? match.winnerId === 'you'
                ? [
                    {
                      label: 'Continue Trail',
                      onClick: () => exitJourneyTrial(true),
                      variant: 'primary',
                    },
                    { label: 'Try Again', onClick: startFreshMatch, variant: 'secondary' },
                  ]
                : [
                    { label: 'Try Again', onClick: startFreshMatch, variant: 'primary' },
                    {
                      label: 'Return to Trail',
                      onClick: () => exitJourneyTrial(false),
                      variant: 'secondary',
                    },
                  ]
              : undefined
          }
        />
      )}
      {showPostGameOverlays && !isPlayVsFritzGameOver && !(isDailyFritzMode && onDailyFritzGameComplete) && (
        <GameOverModal
          open
          ariaLabel={`${opponentLabel} match over`}
          matchKind="single-player"
          layout={isGuidedMatchVictoryResult ? 'guided-split' : 'default'}
          kicker={
            isGuidedMatchVictoryResult
              ? 'Guided Match Complete'
              : isDailyFritzMode
                ? 'Daily Fritz Complete'
                : isGhostMode
                  ? 'Ghost Match Result'
                  : 'Play vs Fritz Result'
          }
          title={
            isGhostMode
              ? match.winnerId === 'you'
                ? 'Victory'
                : 'Defeat'
              : match.winnerId === 'you'
                ? 'Victory'
                : 'Defeat'
          }
          subtitle={
            isGhostMode
              ? match.winnerId === 'you'
                ? `You finished ahead of ${opponentLabel}.`
                : `${opponentLabel} closed out the match.`
              : match.winnerId === 'you'
                ? `You beat ${opponentLabel} in ${match.dealSize}-tile play.`
                : `${opponentLabel} took the match in ${match.dealSize}-tile play.`
          }
          tone={match.winnerId === 'you' ? 'gold' : 'red'}
          stats={[
            {
              label: 'Final Score',
              value: `${match.players.you.score}-${match.players.bot.score}`,
              tone: match.winnerId === 'you' ? 'gold' : 'red',
            },
            {
              label: 'Margin',
              value: `${match.winnerId === 'you' ? '+' : '-'}${Math.abs(match.players.you.score - match.players.bot.score)}`,
              tone: match.winnerId === 'you' ? 'gold' : 'red',
            },
            {
              label: isGhostMode ? 'Mode' : 'Deal',
              value: isGhostMode ? 'Ghost' : `${match.dealSize}-Tile`,
              tone: isGhostMode ? 'blue' : 'default',
            },
          ]}
          scores={[
            {
              label: 'You',
              value: isGhostMode ? `${match.players.you.score} pts` : match.players.you.score,
              winner: match.winnerId === 'you',
              showCrown: match.winnerId === 'you',
            },
            {
              label: isGhostMode ? (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                  {ghostSubLabel && (
                    <span style={{ fontSize: '0.94rem', opacity: 0.9, textTransform: 'none', fontWeight: 700 }}>
                      {formatGhostName(ghostSubLabel)}
                    </span>
                  )}
                  <span style={{ fontSize: '1.12rem', opacity: 0.98, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 850, lineHeight: 1 }}>
                    {opponentLabel}
                  </span>
                </div>
              ) : opponentLabel,
              value: isGhostMode ? `${match.players.bot.score} pts` : match.players.bot.score,
              winner: match.winnerId === 'bot',
              showCrown: match.winnerId === 'bot',
            },
          ]}
          primaryLabel={
            isGuidedMatchVictoryResult
              ? 'Finish Lesson'
              : isDailyFritzMode
                ? 'Back Home'
                : isGhostMode
                  ? 'Play Again'
                  : 'Rematch'
          }
          onPrimary={isGuidedMatchVictoryResult ? returnToLearn : startFreshMatch}
          secondaryLabel={
            isGuidedMatchVictoryResult
              ? undefined
              : isDailyFritzMode
                ? 'Back Home'
                : isGhostMode
                  ? 'Home'
                  : 'Change Setup'
          }
          onSecondary={
            isGuidedMatchVictoryResult
              ? undefined
              : isDailyFritzMode
                ? exitMatch
                : isGhostMode
                  ? goHome
                  : returnToFritzSetup
          }
          extraActionLabel={
            isGuidedMatchVictoryResult
              ? undefined
              : canSaveGuidedMatchCandidate
                ? 'Save as Guided Match Candidate'
                : !isGuidedMode && !isGhostMode && !isDailyFritzMode && onNavigate
                  ? 'Home'
                  : undefined
          }
          onExtraAction={
            isGuidedMatchVictoryResult
              ? undefined
              : canSaveGuidedMatchCandidate
                ? saveGuidedMatchCandidate
                : !isGuidedMode && !isGhostMode && !isDailyFritzMode && onNavigate
                  ? goHome
                  : undefined
          }
          onClose={isGuidedMatchVictoryResult ? returnToLearn : exitMatch}
        >
          {isDailyFritzMode && !isGuidedMatchVictoryResult && !isGhostMode && (
            <p className="rh-go-trust-note">{FRITZ_POSTGAME_TRUST_LINE}</p>
          )}
          {guidedMatchFinalDebrief ? (
            <GuidedMatchFinalDebriefPanel debrief={guidedMatchFinalDebrief} />
          ) : null}
          {!isGuidedMatchVictoryResult && enableGuidedMatchCandidateCapture && (
            <div className="rh-go-rating">
              <span>Guided Capture</span>
              <strong>
                {guidedMatchCaptureStatus.eventCount} events · {guidedMatchCaptureStatus.candidateStatus}
              </strong>
              <button
                type="button"
                className="btn"
                onClick={copyGuidedMatchCandidate}
                style={{ marginTop: 8 }}
              >
                Copy Candidate JSON
              </button>
              {guidedMatchCandidateSaveStatus ? (
                <p style={{ margin: '8px 0 0', color: 'rgba(226,232,241,0.78)' }}>
                  {guidedMatchCandidateSaveStatus}
                </p>
              ) : null}
            </div>
          )}
          {isDailyFritzMode && (
            <div className="rh-go-daily-panel">
              <div className="rh-go-rating">
                <span>Daily Run</span>
                <strong>
                  {ghostResultLoading
                    ? 'Submitting...'
                    : ghostResultError
                      ? ghostResultError
                      : formatOrdinalPlace(dailyFritzRank)
                        ? formatOrdinalPlace(dailyFritzRank)
                        : dailyFritzLeaderboard.length > 0
                          ? 'Ranked'
                        : 'Submitted'}
                </strong>
              </div>
              {ghostResultError ? (
                <button
                  type="button"
                  className="mode-inline-btn"
                  onClick={retryDailyFritzCompletion}
                  style={{ alignSelf: 'flex-start' }}
                >
                  Retry Submit
                </button>
              ) : null}
            </div>
          )}
          {isGhostMode && (
            <div className="ghost-result-card">
              <div className="ghost-result-row">
                <span>YOU</span>
                <strong>{match.players.you.score} pts</strong>
                <div className="ghost-result-bar">
                  <div
                    className="ghost-result-bar-fill is-you"
                    style={{
                      width: `${(match.players.you.score / Math.max(match.players.you.score, match.players.bot.score, 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="ghost-result-row">
                <span>GHOST</span>
                <strong>{match.players.bot.score} pts</strong>
                <div className="ghost-result-bar">
                  <div
                    className="ghost-result-bar-fill is-ghost"
                    style={{
                      width: `${(match.players.bot.score / Math.max(match.players.you.score, match.players.bot.score, 1)) * 100}%`,
                    }}
                  />
                </div>
              </div>
              <div className="ghost-result-rating">
                {ghostResultLoading ? (
                  <span>Analyzing play style...</span>
                ) : ghostResult ? (
                  <span>Ghost Rating {ghostRatingDeltaLabel} • {Math.round(ghostResult.newRating)}</span>
                ) : ghostResultError ? (
                  <span>{ghostResultError}</span>
                ) : (
                  <span>Analyzing play style...</span>
                )}
              </div>
              <p className="ghost-result-message">{ghostResultMessage}</p>
            </div>
          )}
          {isDailyFritzMode && dailyFritzLeaderboard.length > 0 && (
            <div className="daily-fritz-inline-preview">
              <h3 className="daily-fritz-inline-preview-title">Today&apos;s Daily Fritz Top Runs</h3>
              <div className="daily-fritz-inline-preview-list">
                {dailyFritzLeaderboard.map((entry) => (
                  <div
                    key={`${entry.rank}-${entry.username}-${entry.completedAt}`}
                    className="daily-fritz-inline-preview-row"
                  >
                    <strong className="daily-fritz-inline-preview-rank">#{entry.rank}</strong>
                    <span className="daily-fritz-inline-preview-player">{entry.username}</span>
                    <span className="daily-fritz-inline-preview-score">{entry.finalScore}-{entry.opponentScore}</span>
                    <span className="daily-fritz-inline-preview-diff">{entry.pointDiff >= 0 ? '+' : ''}{entry.pointDiff}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isDailyPuzzleRun && (
            <div style={{ margin: '2px 0 4px', textAlign: 'left' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Today&apos;s Top Scores</h3>
              {!userId && (
                <p className="lobby-server" style={{ margin: '0 0 8px' }}>
                  Log in to submit your score.
                </p>
              )}
              {dailyLeaderboardLoading && (
                <p className="lobby-server" style={{ margin: 0 }}>
                  Loading leaderboard...
                </p>
              )}
              {!dailyLeaderboardLoading && dailyLeaderboardError && (
                <p className="lobby-server" style={{ margin: 0 }}>
                  {dailyLeaderboardError}
                </p>
              )}
              {!dailyLeaderboardLoading &&
                !dailyLeaderboardError &&
                dailyLeaderboard.length === 0 && (
                  <p className="lobby-server" style={{ margin: 0 }}>
                    No scores posted yet.
                  </p>
                )}
              {!dailyLeaderboardLoading && dailyLeaderboard.length > 0 && (
                <div style={{ display: 'grid', gap: 6 }}>
                  {dailyLeaderboard.map((entry, idx) => {
                    const isCurrentUser = Boolean(userId) && entry.userId === userId;
                    return (
                      <div
                        key={`${entry.userId}-${idx}`}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '52px 1fr auto',
                          gap: 8,
                          alignItems: 'center',
                          borderRadius: 8,
                          padding: '6px 8px',
                          background: isCurrentUser
                            ? 'rgba(255, 215, 0, 0.16)'
                            : 'rgba(255, 255, 255, 0.04)',
                        }}
                      >
                        <span>#{idx + 1}</span>
                        <span>@{entry.username}</span>
                        <span>{entry.bestScore}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </GameOverModal>
      )}

      {isLessonLayoutMode ? (
        <div className="walnut-match-layout game-layout-layer">
        <div className="learn-guided-pvf" data-ui="guided-cockpit">
          <div className="pvf-layout learn-guided-pvf__layout">
            <aside className="pvf-left-col learn-guided-pvf__left">
              <button
                type="button"
                className="pvf-back-btn learn-guided-pvf__exit rh-back-button"
                onClick={() => setShowLeaveConfirm(true)}
              >
                <span aria-hidden="true">←</span> Exit learn
              </button>

              <div className="pvf-header learn-guided-pvf__header">
                <div className="pvf-label">Learn Mode</div>
                <h1 className="pvf-title">Guided Match</h1>
                <p className="pvf-subtitle">Learn Racehorse by playing a real coached hand.</p>
              </div>

              <div className="learn-guided-hero-card">
                <div className="learn-guided-hero-card__content">
                  <div className="learn-guided-hero-card__header">
                    <div className="learn-guided-hero-card__header-meta">
                      <p className="learn-guided-hero-card__eyebrow">Fritz Coach</p>
                      <div className="learn-guided-hero-card__progress-chip">
                        <span>{showFritzCoachingPanel ? 'Turn' : 'Move'}</span>
                        <strong>{lessonCoachPanelContent?.progressChipLabel ?? lessonCoachProgressLabel}</strong>
                      </div>
                    </div>
                    <h2 className="learn-guided-hero-card__title">
                      {lessonCoachPanelContent?.title ?? 'Hand Over'}
                    </h2>
                    <div className="learn-guided-hero-card__progress-rail" aria-hidden="true">
                      <div
                        className="learn-guided-hero-card__progress-fill"
                        style={{ width: `${lessonCoachProgressPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="learn-guided-hero-card__divider" aria-hidden="true" />

                  <div className="learn-guided-hero-card__body-wrap">
                    <div className="learn-guided-hero-card__body">
                      {lessonCoachPanelContent?.showMore ? (
                        <p className="learn-guided-hero-card__paragraph learn-guided-hero-card__paragraph--preview">
                          {lessonCoachPanelContent.previewText}
                        </p>
                      ) : (
                        (lessonCoachPanelContent?.bodyParagraphs ?? []).map((paragraph, index) => (
                          <p key={`${index}-${paragraph.slice(0, 24)}`} className="learn-guided-hero-card__paragraph">
                            {paragraph}
                          </p>
                        ))
                      )}
                    </div>
                    {lessonCoachPanelContent?.showMore ? (
                      <div className="learn-guided-hero-card__more-row">
                        <button
                          type="button"
                          className="learn-guided-hero-card__more-btn"
                          onClick={() => setShowFullCoachTip(true)}
                          aria-expanded={showFullCoachTip}
                          aria-haspopup="dialog"
                        >
                          More
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {lessonCoachPanelContent?.showFooter ? (
                    <div className="learn-guided-hero-card__footer" aria-label="Lesson utilities">
                      <div className="learn-guided-hero-card__context-strip" aria-label="Decision context">
                        {(lessonCoachPanelContent.contextChips ?? []).map((chip) => (
                          <span key={chip}>{chip}</span>
                        ))}
                      </div>
                      <div className="learn-guided-hero-card__action-row">
                        {showLessonCoachPanel ? (
                          <button
                            type="button"
                            className="learn-guided-hero-card__action-secondary"
                            onClick={() => setShowRecommendation((prev) => !prev)}
                          >
                            {showRecommendation ? 'Hide Preview' : 'Show Preview'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="learn-guided-hero-card__action-primary"
                          disabled={!canPlayCoachedMove || !lessonCoachVm?.canBestMove}
                          onClick={playLessonBestMove}
                        >
                          Play Move
                        </button>
                      </div>
                    </div>
                  ) : lessonCoachPanelContent?.contextChips?.length ? (
                    <div className="learn-guided-hero-card__footer learn-guided-hero-card__footer--compact" aria-label="Turn status">
                      <div className="learn-guided-hero-card__context-strip" aria-label="Turn context">
                        {lessonCoachPanelContent.contextChips.map((chip) => (
                          <span key={chip}>{chip}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>

            <section className="pvf-control-panel learn-guided-pvf__panel" data-ui="guided-stage">
              <div className="learn-guided-panel-section learn-guided-panel-section--state">
                <div className="fritz-summary-strip learn-guided-summary-strip" data-ui="guided-match-state">
                  <button
                    type="button"
                    ref={guidedFritzAnchorRef}
                    className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--score"
                    onClick={() => setScoreTrackOpen(true)}
                    aria-label="Open score track"
                    data-ui="guided-fritz-draw-anchor"
                  >
                    <div>
                      <div className="fritz-summary-key">{opponentLabel}</div>
                      <div className="fritz-summary-value">
                        <AnimatedScore value={match.players.bot.score} className="learn-guided-summary-score" />
                      </div>
                      <span className="learn-guided-summary-tiles" aria-label={`${opponentLabel} has ${match.players.bot.hand.length} tiles remaining`}>
                        {match.players.bot.hand.length} {match.players.bot.hand.length === 1 ? 'tile' : 'tiles'}
                      </span>
                    </div>
                  </button>
                  <div className="fritz-summary-divider" aria-hidden />
                  <button
                    type="button"
                    className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--score"
                    onClick={() => setScoreTrackOpen(true)}
                    aria-label="Open score track"
                  >
                    <div>
                      <div className="fritz-summary-key">You</div>
                      <div className="fritz-summary-value">
                        <AnimatedScore value={match.players.you.score} className="learn-guided-summary-score" />
                      </div>
                      <span className="learn-guided-summary-tiles learn-guided-summary-tiles--you" aria-label={`You have ${match.players.you.hand.length} tiles remaining`}>
                        {match.players.you.hand.length} {match.players.you.hand.length === 1 ? 'tile' : 'tiles'}
                      </span>
                    </div>
                  </button>
                  <div className="fritz-summary-divider learn-guided-summary-divider--turn" aria-hidden />
                  <div className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--turn">
                    <span className={`learn-guided-summary-turn ${botTurn ? 'is-opponent' : 'is-you'}`}>
                      {turnLabel || (botTurn ? `${opponentLabel} thinking` : 'Your move')}
                    </span>
                  </div>
                  <div className="fritz-summary-divider learn-guided-summary-divider--turn" aria-hidden />
                  <div className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--meta">
                    <div>
                      <div className="fritz-summary-value">{openEndsSum}</div>
                      <div className="fritz-summary-key">Open Count</div>
                    </div>
                  </div>
                  <div className="fritz-summary-divider" aria-hidden />
                  <div
                    ref={guidedBoneyardAnchorRef}
                    className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--meta"
                    data-ui="guided-boneyard-draw-anchor"
                  >
                    <div>
                      <div className="fritz-summary-value">{match.boneyard.length}</div>
                      <div className="fritz-summary-key">Boneyard</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="learn-guided-panel-section learn-guided-panel-section--game">
                <div className="learn-guided-game-stage">
                <div className="rh-live-board-zone learn-guided-live-board-zone" data-ui="live-board-zone">
                  {isLessonLayoutMode && !match.board?.mainLine?.length ? (
                    <div className="learn-guided-board-card__hint" aria-hidden="true">
                      <span className="learn-guided-board-card__hint-kicker">Opening move</span>
                      <strong className="learn-guided-board-card__hint-title">The board is waiting for the first coached tile.</strong>
                    </div>
                  ) : null}
                  {boardStage}
                </div>
                  <div className="learn-guided-game-stage__hand">
                    <div className="rh-live-hand-deck learn-guided-live-hand-deck" data-ui="live-hand-deck">
                      {handTray}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
        </div>
      ) : (
        <MatchLiveLayout
          boardStageRef={boardStageRef}
          boardStageClassName={ghostBoardPulse ? 'ghost-board-pulse' : undefined}
          boardInner={boardStageInner}
          handDock={handTray}
          hudLeft={
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className={`wl-player-pill wl-player-pill-btn score-card${botTurn ? ' is-active-turn' : ''}`}
                ref={opponentPillRef}
                onClick={() => setScoreTrackOpen(true)}
                aria-label="Open score track"
              >
                <div className="wl-player-card-content">
                  <div className="wl-player-card-text">
                    {ghostSubLabel ? (
                      <span className="wl-player-subtitle">{formatGhostName(ghostSubLabel)}</span>
                    ) : null}
                    <span className="wl-player-label">{opponentLabel}</span>
                  </div>
                  <AnimatedScore value={match.players.bot.score} className="wl-player-score" />
                </div>
              </button>
              {wantsOriginalGuidedRecordMode ? (
                <div
                  style={{
                    display: 'flex',
                    gap: 6,
                    marginLeft: 6,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    maxWidth: 'min(420px, 40vw)',
                  }}
                >
                  {guidedRecordFritzPalette.map((tile, idx) => {
                    const playable = getGuidedRecordBotMovesForTile(tile).length > 0;
                    return (
                      <DominoTile
                        key={`guided-bot-hand-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={28}
                        rotation={0}
                        selected={
                          selectedController === 'bot' &&
                          !!selectedTile &&
                          tileEquals(selectedTile, tile)
                        }
                        highlight={playable}
                        disabled={!handActive || match.currentPlayer !== 'bot' || !playable}
                        onClick={() => {
                          if (!handActive || match.currentPlayer !== 'bot') return;
                          if (!playable) return;
                          setSelectedTile(tile);
                          setSelectedController('bot');
                        }}
                      />
                    );
                  })}
                </div>
              ) : (
                <TileRack
                  count={match.players.bot.hand.length}
                  isActive={botTurn}
                  variant="default"
                />
              )}
            </div>
          }
          hudCenter={
            preGameDrawHudCenter ?? (showTurnStatusCluster ? (
              <div className="wl-center-status" data-ui="turn-status">
                {isDailyFritzMode && dailyFritzPackage && (
                  <div className="daily-fritz-progress-pill" data-has-turn-label={!!turnLabel}>
                    <span className="hud-pill-label">GAME</span>
                    <span className="hud-pill-value">
                      {dailyFritzPackage.current_game_number ?? 1}
                    </span>
                  </div>
                )}
                {turnLabel && (
                  <span className={`wl-turn-label ${botTurn ? 'opp-turn' : 'your-turn'}`}>
                    {turnLabel}
                  </span>
                )}
              </div>
            ) : null)
          }
          hudRight={
            <button
              type="button"
              className={`wl-player-pill wl-player-pill-btn score-card is-you${!botTurn ? ' is-active-turn' : ''}`}
              onClick={() => setScoreTrackOpen(true)}
              aria-label="Open score track"
            >
              <div className="wl-player-card-content">
                <div className="wl-player-card-text">
                  <span className="wl-player-label">You</span>
                </div>
                <AnimatedScore value={match.players.you.score} className="wl-player-score" />
              </div>
            </button>
          }
        />
      )}

      <InGameOverlayStack>
        {flyingTiles.length > 0 && (
          <GameOverlayPortal>
            {flyingTiles.map((ft) => (
              <div
                key={ft.id}
                className="flying-tile-overlay"
                style={{
                  '--fly-from-x': `${ft.x}px`,
                  '--fly-from-y': `${ft.y}px`,
                  '--fly-to-x': `${ft.toX}px`,
                  '--fly-to-y': `${ft.toY}px`,
                } as React.CSSProperties}
              />
            ))}
          </GameOverlayPortal>
        )}
      </InGameOverlayStack>

      {isLessonLayoutMode && showFullCoachTip && showPlayerCoaching && !lessonCoachVm?.isOffAuthoredLine ? (
        <GameOverlayPortal>
          <div
            className="learn-guided-coach-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Full coach tip"
            onClick={() => setShowFullCoachTip(false)}
          >
            <div
              className="learn-guided-coach-modal__card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="learn-guided-coach-modal__header">
                <p className="learn-guided-coach-modal__eyebrow">Fritz Coach</p>
                <button
                  type="button"
                  className="learn-guided-coach-modal__close"
                  onClick={() => setShowFullCoachTip(false)}
                >
                  Close
                </button>
              </div>
              <h2 className="learn-guided-coach-modal__title">{lessonCoachContent.title}</h2>
              <div className="learn-guided-coach-modal__body">
                {lessonCoachContent.bodyParagraphs.map((paragraph, index) => (
                  <p key={`modal-${index}-${paragraph.slice(0, 24)}`} className="learn-guided-coach-modal__paragraph">
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </GameOverlayPortal>
      ) : null}

      {POST_GAME_REVIEW_VISIBLE ? (
        <GameReviewer
          open={analyzerOpen}
          onClose={() => setAnalyzerOpen(false)}
          analysis={currentAnalysis}
          title="Game Review"
        />
      ) : null}

      {showDebug && (
        <aside className="bot-debug-panel">
          <div>
            <strong>{opponentLabel} hand:</strong>{' '}
            {match.players.bot.hand.map((t) => `[${t.low}|${t.high}]`).join(' ')}
          </div>
          <div>
            <strong>Open ends:</strong> {openEnds.join(', ') || '(none)'}
          </div>
          {lastBotChoice && (
            <div>
              <strong>Last bot eval:</strong> {`score=${lastBotChoice.score.toFixed(2)} `}
              {`immediate=${lastBotChoice.breakdown.immediate} `}
              {`mobility=${lastBotChoice.breakdown.mobility} `}
              {`denial=${lastBotChoice.breakdown.denial.toFixed(1)} `}
              {`risk=${lastBotChoice.breakdown.replyRisk}`}
            </div>
          )}
        </aside>
      )}

      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={() => setShowLeaveConfirm(false)}
          onLeave={() => {
            if (isJourneyTrial) {
              setShowLeaveConfirm(false);
              exitJourneyTrial(false);
              return;
            }
            if (isStandaloneFritzMatch && !match.gameOver) {
              void abandonStandaloneFritzMatch()
                .catch((err) => {
                  console.warn('[Fritz Pending] abandon failed', err);
                })
                .finally(() => {
                  void Promise.resolve(onProfileRefresh?.()).catch(() => {});
                  exitMatch();
                });
            } else {
              exitMatch();
            }
          }}
        />
      )}
    </div>
    </>
  );
}
