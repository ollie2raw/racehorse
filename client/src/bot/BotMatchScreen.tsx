import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Board, BoneyardStackIcon, DominoTile, ScoreTrackOverlay } from '../components';
import TileRack from '../components/TileRack';
import type { Move, Tile } from '../types';
import {
  fetchDailyPuzzleLeaderboard,
  upsertDailyPuzzleBestScore,
  type DailyPuzzleLeaderboardEntry,
} from '../dailyPuzzle/api';
import GameOverModal from '../components/GameOverModal';
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
  computeOpenEndsSum,
  createBotMatch,
  createFixedBotMatch,
  drawOne,
  getMatchableOpenEnds,
  getDisplayOpenEnds,
  getLegalMoves,
  isDouble,
  passTurn,
  previewPlayMove,
  startNextBotHand,
  startNextFixedBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotHandDeal,
  type BotMatchState,
  type BotPlayerId,
} from './botEngine';
import { chooseBotMove, toBotVisibleState, type BotChoice } from './botHeuristics';
import { FRITZ_TIERS, type FritzTier } from './fritzConfig';
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
  nextDailyFritzHand,
  type DailyFritzLeaderboardRow,
  type DailyFritzNextHandResponse,
  type DailyFritzStartResponse,
} from '../dailyFritz/api';
import './botMatch.css';
import { useLearningCoach } from '../learning/useLearningCoach';
import CoachPanel from '../learning/CoachPanel';
import LearningHandRecap from '../learning/LearningHandRecap';
import '../learning/coach.css';

interface BotMatchScreenProps {
  onBack: () => void;
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
  resumeKey?: string | null;
  onMatchComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
  }) => void) | null;
  dailyFritzPackage?: DailyFritzStartResponse | null;
  onDailyFritzComplete?: (() => void) | null;
  isGuidedMode?: boolean;
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

function formatOrdinalPlace(value: number | null): string | null {
  if (!value || value <= 0) return null;
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th Place`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st Place`;
  if (mod10 === 2) return `${value}nd Place`;
  if (mod10 === 3) return `${value}rd Place`;
  return `${value}th Place`;
}

function FullscreenIcon({ isFullscreen, style }: { isFullscreen: boolean; style?: React.CSSProperties }) {
  return (
    <svg className="icon-svg" style={style} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {isFullscreen ? (
        <>
          <path d="M4 9V4h5" />
          <path d="M20 9V4h-5" />
          <path d="M4 15v5h5" />
          <path d="M20 15v5h-5" />
        </>
      ) : (
        <>
          <path d="M9 4H4v5" />
          <path d="M15 4h5v5" />
          <path d="M9 20H4v-5" />
          <path d="M15 20h5v-5" />
        </>
      )}
    </svg>
  );
}

function VolumeIcon({ isMuted, style }: { isMuted: boolean; style?: React.CSSProperties }) {
  return (
    <svg className="icon-svg" style={style} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path className="icon-body" d="M3 10v4h4l5 4V6L7 10H3z" />
      {!isMuted && (
        <>
          <path className="icon-wave" d="M16 8.5a5 5 0 010 7" />
          <path className="icon-wave" d="M19 6a9 9 0 010 12" />
        </>
      )}
      {isMuted && <path className="icon-slash" d="M5 5l14 14" />}
    </svg>
  );
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
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
      forced_draw: entry.action === 'draw',
    }));
}

export default function BotMatchScreen({
  onBack,
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
  resumeKey = null,
  onMatchComplete = null,
  dailyFritzPackage = null,
  onDailyFritzComplete = null,
  isGuidedMode = false,
}: BotMatchScreenProps) {
  const LEAGUE_MATCH_META_KEY = 'racehorse:league-match-meta';
  const leagueResumeStorageKey = resumeKey ? `racehorse:league-match:${resumeKey}` : null;
  const dailyFritzStorageKey =
    mode === 'daily-fritz' && dailyFritzPackage ? `racehorse:daily-fritz:${dailyFritzPackage.attempt_id}` : null;
  const resolveServerBaseUrl = () => {
    const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
    if (configured) return configured.replace(/\/$/, '');
    if (typeof window !== 'undefined') {
      const { hostname, port } = window.location;
      if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
      return '';
    }
    return 'http://localhost:3001';
  };
  const createLocalMatchId = () =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const loadPersistedLeagueMatch = () => {
    if (!leagueResumeStorageKey || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(leagueResumeStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        resumeKey?: string;
        mode?: 'bot' | 'ghost';
        opponentName?: string;
        winningScore?: number;
        dealSize?: number;
        match?: BotMatchState;
        movesUsed?: number;
        moveLog?: MoveEntry[];
        ghostMoveLog?: GhostMoveLogEntry[];
        ghostProfile?: GhostProfileSummary | null;
        matchStartGlickoRating?: number | null;
      };
      if (parsed.resumeKey !== resumeKey || !parsed.match) return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const initialPersistedLeagueMatch = loadPersistedLeagueMatch();
  const loadPersistedDailyFritzMatch = () => {
    if (!dailyFritzStorageKey || typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(dailyFritzStorageKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        attemptId?: string;
        match?: BotMatchState;
        movesUsed?: number;
        moveLog?: MoveEntry[];
      };
      if (parsed.attemptId !== dailyFritzPackage?.attempt_id || !parsed.match) return null;
      return parsed;
    } catch {
      return null;
    }
  };
  const initialPersistedDailyFritzMatch = loadPersistedDailyFritzMatch();
  const DRAW_STEP_MS = 700;
  const fritzConfig = FRITZ_TIERS[fritzTier];
  const rootRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const [match, setMatch] = useState<BotMatchState>(
    () =>
      initialPersistedDailyFritzMatch?.match ??
      initialPersistedLeagueMatch?.match ??
      (mode === 'daily-fritz' && dailyFritzPackage
        ? createFixedBotMatch(dailyFritzPackage.first_hand, winningScore, dealSize)
        : createBotMatch(winningScore, dealSize)),
  );
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [movesUsed, setMovesUsed] = useState(
    initialPersistedDailyFritzMatch?.movesUsed ?? initialPersistedLeagueMatch?.movesUsed ?? 0,
  );
  const [dailyLeaderboard, setDailyLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [dailyLeaderboardLoading, setDailyLeaderboardLoading] = useState(false);
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveEntry[]>(
    initialPersistedDailyFritzMatch?.moveLog ?? initialPersistedLeagueMatch?.moveLog ?? [],
  );
  const [ghostMoveLog, setGhostMoveLog] = useState<GhostMoveLogEntry[]>(initialPersistedLeagueMatch?.ghostMoveLog ?? []);
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
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
  const [ghostAgreementType, setGhostAgreementType] = useState<'agrees' | 'heuristic' | null>(null);
  const [ghostBoardPulse, setGhostBoardPulse] = useState(false);
  const [ghostPlayedTile, setGhostPlayedTile] = useState<Tile | null>(null);
  const [ghostResult, setGhostResult] = useState<GhostCompletionResult | null>(null);
  const [ghostResultLoading, setGhostResultLoading] = useState(false);
  const [ghostResultError, setGhostResultError] = useState<string | null>(null);
  const [matchStartGlickoRating, setMatchStartGlickoRating] = useState<number | null>(
    initialPersistedLeagueMatch?.matchStartGlickoRating != null
      ? Number(initialPersistedLeagueMatch.matchStartGlickoRating)
      : currentGlickoRating != null
        ? Number(currentGlickoRating)
        : null,
  );
  const [activeLocalMatchId, setActiveLocalMatchId] = useState<string>(
    () =>
      (mode === 'daily-fritz' && dailyFritzPackage
        ? `daily-fritz:${dailyFritzPackage.run_date}:${dailyFritzPackage.attempt_id}`
        : createLocalMatchId()),
  );
  const [verifiedMatchId, setVerifiedMatchId] = useState<string | null>(
    dailyFritzPackage?.verified_match_id ?? null,
  );
  const [dailyFritzLeaderboard, setDailyFritzLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [dailyFritzRank, setDailyFritzRank] = useState<number | null>(null);
  const dailyResultSyncKeyRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameWinConfettiKeyRef = useRef('');
  const gameOverSoundKeyRef = useRef('');
  const matchCompleteKeyRef = useRef('');
  const ghostCompleteKeyRef = useRef('');
  const dailyFritzCompleteKeyRef = useRef('');
  const dailyFritzStorageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dailyFritzStoragePendingRef = useRef<{ key: string; payload: object } | null>(null);
  const dailyFritzNextHandRef = useRef<{
    promise: Promise<DailyFritzNextHandResponse>;
    result: DailyFritzNextHandResponse | null;
    error: unknown;
  } | null>(null);
  const botChainPauseRef = useRef(false);
  const matchRef = useRef(match);
  const prevTurnRef = useRef<BotPlayerId>(match.currentPlayer);
  const localPendingRegisteredRef = useRef(false);
  const localPendingResolvedRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);
  const isGhostMode = mode === 'ghost';
  const isDailyFritzMode = mode === 'daily-fritz';
  const isDailyPuzzleRun = Boolean(dailyPuzzleDate);
  const isLeagueMatch = Boolean(onMatchComplete && resumeKey);
  const isStandaloneFritzMatch = Boolean(userId && !isGhostMode && !isDailyPuzzleRun && !isDailyFritzMode && !onMatchComplete);
  const showDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('BOT_DEBUG') === '1';
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;

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

  const formatGhostName = (rawName: string) => {
    const cleaned = rawName
      .replace(/'s Ghost/gi, '')
      .replace(/ Ghost/gi, '')
      .replace(/^@/, '')
      .trim();
    const capitalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    return `@${capitalized}`;
  };

  const clearPersistedLeagueMatch = useCallback(() => {
    if (!leagueResumeStorageKey || typeof window === 'undefined') return;
    window.sessionStorage.removeItem(leagueResumeStorageKey);
    window.sessionStorage.removeItem(LEAGUE_MATCH_META_KEY);
  }, [leagueResumeStorageKey]);

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
      const payload = {
        userId,
        localMatchId: activeLocalMatchId,
        accessToken: accessTokenRef.current,
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

  const [uiTheme, setUiTheme] = useState<'green' | 'brown'>(() => {
    if (typeof window === 'undefined') return 'green';
    const stored = window.localStorage.getItem('racehorse_ui_theme');
    return stored === 'brown' ? 'brown' : 'green';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_ui_theme', uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    const lastUserMoveNumber = moveLog.reduce(
      (max, entry) => (entry.player === 'you' ? Math.max(max, entry.moveNumber ?? 0) : max),
      0,
    );
    moveCounterRef.current = Math.max(1, lastUserMoveNumber + 1);
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
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
  }, []);

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

  const pushToast = (msg: string, ms = 1400) => {
    if (!msg) return;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(''), ms);
  };

  const showBoardToast = (message: string, tone: 'you' | 'bot') => {
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
  };

  const showScoreToast = (player: 'you' | 'bot', points: number) => {
    showBoardToast(`${player === 'you' ? 'You' : opponentLabel} scored +${points}`, player);
  };

  function flashLastPlayed(tile: Tile | null) {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }

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
    const moveNumber =
      entry.player === 'you' ? moveCounterRef.current++ : moveCounterRef.current;
    setMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const appendGhostMove = useCallback((entry: GhostMoveLogEntry) => {
    setGhostMoveLog((prev) => [...prev, entry]);
  }, []);

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

  const startFreshMatch = () => {
    if (isDailyFritzMode) {
      onDailyFritzComplete?.();
      onBack();
      return;
    }
    clearPersistedLeagueMatch();
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
    setMovesUsed(0);
    setDailyLeaderboard([]);
    setDailyLeaderboardError(null);
    setDailyLeaderboardLoading(false);
    setMoveLog([]);
    setGhostMoveLog([]);
    moveCounterRef.current = 1;
    setCurrentAnalysis(null);
    setAnalyzerOpen(false);
    dailyResultSyncKeyRef.current = '';
    gameWinConfettiKeyRef.current = '';
    matchCompleteKeyRef.current = '';
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
    setMatch(createBotMatch(winningScore, dealSize));
  };

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
    if (!isLeagueMatch || !leagueResumeStorageKey || typeof window === 'undefined') return;
    if (match.gameOver) {
      clearPersistedLeagueMatch();
      return;
    }
    const payload = {
      resumeKey,
      mode,
      opponentName,
      winningScore,
      dealSize,
      match,
      movesUsed,
      moveLog,
      ghostMoveLog,
      ghostProfile,
      matchStartGlickoRating,
    };
    window.sessionStorage.setItem(leagueResumeStorageKey, JSON.stringify(payload));
    window.sessionStorage.setItem(
      LEAGUE_MATCH_META_KEY,
      JSON.stringify({
        resumeKey,
        mode,
        ghostProfile,
      }),
    );
  }, [
    clearPersistedLeagueMatch,
    dealSize,
    ghostMoveLog,
    ghostProfile,
    isLeagueMatch,
    leagueResumeStorageKey,
    match,
    matchStartGlickoRating,
    mode,
    moveLog,
    movesUsed,
    opponentName,
    resumeKey,
    winningScore,
  ]);

  useEffect(() => {
    if (!isDailyFritzMode || !dailyFritzStorageKey || typeof window === 'undefined') return;
    if (match.gameOver) {
      if (dailyFritzStorageTimerRef.current) {
        clearTimeout(dailyFritzStorageTimerRef.current);
        dailyFritzStorageTimerRef.current = null;
      }
      dailyFritzStoragePendingRef.current = null;
      window.sessionStorage.removeItem(dailyFritzStorageKey);
      return;
    }
    if (dailyFritzStorageTimerRef.current) clearTimeout(dailyFritzStorageTimerRef.current);
    // Capture snapshot now (references to immutable state objects) but defer
    // JSON.stringify — the expensive part — by 1 s so rapid tile plays don't
    // serialize on every move.
    const snapshot = {
      attemptId: dailyFritzPackage?.attempt_id ?? null,
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
  }, [dailyFritzPackage?.attempt_id, dailyFritzStorageKey, isDailyFritzMode, match, moveLog, movesUsed]);

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
      if (isGuidedMode) return;
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
  }, [activeLocalMatchId, fritzTier, isStandaloneFritzMatch, match.gameOver, postLocalBotMatch, userId]);

  useEffect(() => {
    if (!userId || !isGhostMode || isDailyPuzzleRun || isLeagueMatch) return;
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
    isLeagueMatch,
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
    if (!onMatchComplete) return;
    if (!match.gameOver) {
      matchCompleteKeyRef.current = '';
      return;
    }
    const key = `${match.handNumber}:${match.winnerId}:${match.players.you.score}:${match.players.bot.score}`;
    if (matchCompleteKeyRef.current === key) return;
    matchCompleteKeyRef.current = key;
    onMatchComplete({
      winner: match.winnerId,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
    });
  }, [match.gameOver, match.handNumber, match.winnerId, match.players.you.score, match.players.bot.score, onMatchComplete]);

  useEffect(() => {
    if (!isDailyFritzMode || !dailyFritzPackage || !userId) return;
    if (!match.gameOver) {
      dailyFritzCompleteKeyRef.current = '';
      setGhostResultLoading(false);
      setGhostResultError(null);
      return;
    }
    const completionKey = [
      dailyFritzPackage.attempt_id,
      match.handNumber,
      match.players.you.score,
      match.players.bot.score,
      movesUsed,
    ].join(':');
    if (dailyFritzCompleteKeyRef.current === completionKey) return;
    dailyFritzCompleteKeyRef.current = completionKey;
    setGhostResultLoading(true);
    setGhostResultError(null);

    void (async () => {
      if (isGuidedMode) {
        setGhostResultLoading(false);
        return;
      }
      try {
        const completionHash = await buildDailyFritzCompletionHash({
          runDate: dailyFritzPackage.run_date,
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          currentHandIndex: Math.max(0, match.handNumber - 1),
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog,
        });
        const response = await completeDailyFritz({
          attemptId: dailyFritzPackage.attempt_id,
          verifiedMatchId: dailyFritzPackage.verified_match_id,
          completionHash,
          finalScore: match.players.you.score,
          opponentScore: match.players.bot.score,
          won: match.winnerId === 'you',
          movesUsed,
          handsPlayed: match.handNumber,
          moveLog,
        });
        setDailyFritzLeaderboard(response.leaderboard_preview);
        setDailyFritzRank(response.rank ?? null);
        setGhostResultLoading(false);
      } catch (err) {
        dailyFritzCompleteKeyRef.current = '';
        setGhostResultLoading(false);
        setGhostResultError(err instanceof Error ? err.message : 'Daily Fritz submission failed.');
      }
    })();
  }, [
    dailyFritzPackage,
    isDailyFritzMode,
    match.gameOver,
    match.handNumber,
    match.players.bot.score,
    match.players.you.score,
    match.winnerId,
    moveLog,
    movesUsed,
    onDailyFritzComplete,
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
      if (isStandaloneFritzMatch) {
        setGhostResultLoading(true);
        setGhostResultError(null);
      }
      return;
    }
    const key = `${verifiedMatchId}:${userId}:${match.handNumber}:${match.players.you.score}:${match.players.bot.score}`;
    if (ghostCompleteKeyRef.current === key) return;
    ghostCompleteKeyRef.current = key;
    setGhostResultLoading(true);
    setGhostResultError(null);

    const effectiveOpponentUserId = isGhostMode ? opponentUserId : (opponentUserId || fritzConfig.id);

    console.log('[Fritz Rating] calling completeGhostGame', {
      userId,
      effectiveOpponentUserId,
      finalScore: match.players.you.score,
      opponentScore: match.players.bot.score,
    });
    const fritzPlayerMoveLog = !isGhostMode ? moveEntriesToGhostMoveLog(moveLog) : undefined;

    if (isGuidedMode) {
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
      moveLog: !isGhostMode && fritzPlayerMoveLog ? fritzPlayerMoveLog : ghostMoveLog,
      playerMoveLog: fritzPlayerMoveLog,
      accessToken: accessTokenRef.current,
    })
      .then((result) => {
        console.log('[Fritz Rating] success:', result);
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
    return match.currentPlayer === 'you' ? getLegalMoves(match, 'you') : [];
  }, [match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);

  // Guided mode: evaluate all play moves using previewPlayMove (unified scoring source),
  // then recommend the best placement with opening-move awareness.
  const guidedCoachTip = useMemo((): GuidedCoachTip | null => {
    if (!isGuidedMode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return null;
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

  const applyAndNotify = (result: BotActionResult) => {
    const adjustedState =
      isDailyFritzMode &&
      result.handEnded &&
      !result.state.gameOver &&
      result.state.handNumber >= 12
        ? {
            ...result.state,
            handOver: true,
            gameOver: true,
            winnerId: (
              result.state.players.you.score > result.state.players.bot.score
                ? 'you'
                : result.state.players.bot.score > result.state.players.you.score
                  ? 'bot'
                  : null
            ) as BotPlayerId | null,
          }
        : result.state;
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
    if (result.handEnded) {
      // Kick off the next-hand fetch immediately so it's ready by the time the
      // 5-second reveal window closes.  Store both the promise and its settled
      // result so advanceHand can transition instantly if already resolved.
      if (isDailyFritzMode && dailyFritzPackage && !adjustedState.gameOver) {
        const cache: {
          promise: Promise<DailyFritzNextHandResponse>;
          result: DailyFritzNextHandResponse | null;
          error: unknown;
        } = {
          promise: nextDailyFritzHand({
            attemptId: dailyFritzPackage.attempt_id,
            verifiedMatchId: dailyFritzPackage.verified_match_id,
            completedHandScores: {
              you: adjustedState.players.you.score,
              fritz: adjustedState.players.bot.score,
            },
          }),
          result: null,
          error: null,
        };
        cache.promise.then((r) => { cache.result = r; }).catch((e) => { cache.error = e; });
        dailyFritzNextHandRef.current = cache;
      }
      flashLastPlayed(null);
      const handEndedData = result.handEnded;
      const yourRemainingTiles = adjustedState.players.you.hand;
      const botRemainingTiles = adjustedState.players.bot.hand;
      if (handRevealTimerRef.current) clearTimeout(handRevealTimerRef.current);
      handRevealTimerRef.current = window.setTimeout(() => {
        setHandReveal({
          winner: handEndedData.winner,
          reason: handEndedData.reason,
          pointsAwarded: handEndedData.pointsAwarded,
          loserPips: handEndedData.loserPips,
          calcText: handEndedData.calcText,
          yourRemainingTiles,
          botRemainingTiles,
        });
        handRevealTimerRef.current = null;
      }, 1400);
      if (result.handEnded.reason === 'blocked') {
        queueSound(() => playBlockedSound(isMuted), 0);
      }
      if (!adjustedState.gameOver) {
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
  };

  const setDrawSequenceActiveBoth = useCallback((val: boolean) => {
    drawSequenceActiveRef.current = val;
    setDrawSequenceActive(val);
  }, []);

  const triggerDrawStepAnimation = useCallback((drawer: BotPlayerId, nextState: BotMatchState) => {
    if (drawer === 'you') {
      const pulseIndex = nextState.players.you.hand.length - 1;
      if (pulseIndex >= 0) {
        setDrawPulseIndex(pulseIndex);
        setTimeout(() => setDrawPulseIndex((prev) => (prev === pulseIndex ? null : prev)), 420);
      }
    }

    if (!boneyardRef.current) return;
    const from = boneyardRef.current.getBoundingClientRect();
    const targetEl = drawer === 'you' ? handAreaRef.current : opponentPillRef.current;
    if (!targetEl) return;
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
  }, []);

  const runDrawSequenceLocal = useCallback(
    async (initialState: BotMatchState, player: BotPlayerId): Promise<BotActionResult> => {
      let current = initialState;
      let drewAny = false;

      while (asPlayMoves(getLegalMoves(current, player)).length === 0) {
        const step = drawOne(current, player);
        if (!step.drew) break;
        drewAny = true;
        current = step.state;
        setMatch(current);
        queueSound(() => playDrawSound(isMuted), 0);
        triggerDrawStepAnimation(player, current);
        await new Promise<void>((resolve) => setTimeout(resolve, DRAW_STEP_MS));
      }

      if (asPlayMoves(getLegalMoves(current, player)).length === 0) {
        const passResult = passTurn(current, player);
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
    [triggerDrawStepAnimation, isMuted],
  );

  const onPositionClick = (position: any) => {
    if (match.currentPlayer !== 'you' || !selectedTile || match.handOver || match.gameOver) return;
    const move = findMoveForSelection(userPlayMoves, selectedTile, position);
    if (!move) return;
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
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    coach.recordPlayerMove(match, move);
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
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
        turn: (match.turnIndex ?? 0) + 1,
        hand_number: match.handNumber,
        actor: 'you',
        board_state: boardStateKey,
        tile_played: selectedTile ? toTileKey(selectedTile) : null,
        branch: typeof position === 'string' ? position : null,
        hand_before: ghostHandBefore,
        score_delta: result.scored?.points ?? 0,
        forced_draw: Boolean(result.drew?.player === 'you'),
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
      pointsScored: result.scored?.points ?? 0,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: getFritzBestMove(match),
    });
  };

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
    console.log('[BOT-EFFECT] fired', { currentPlayer: match.currentPlayer, handOver: match.handOver, gameOver: match.gameOver, drawSequenceActive: drawSequenceActiveRef.current, cancelled: false });
    if (match.currentPlayer !== 'bot' || match.handOver || match.gameOver || drawSequenceActiveRef.current) return;
    console.log('[BOT-EFFECT] passed guard, scheduling turn');
    let cancelled = false;
    let actionResolved = false;
    let playedTileForHighlight: Tile | null = null;
    const thinkDelayMs = 1500;
    botChainPauseRef.current = false;

    const timer = setTimeout(() => {
      void (async () => {
        console.log('[BOT-TURN] timer fired', { cancelled, currentPlayer: match.currentPlayer });
        try {
          let working = match;
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
            const drawPass = await runDrawSequenceLocal(working, 'bot');
            if (cancelled) return;
            working = drawPass.state;

            if (drawPass.drew) {
              if (isGhostMode) {
                appendGhostMove({
                  turn: (match.turnIndex ?? 0) + 1,
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
                  turn: (working.turnIndex ?? 0) + 1,
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
          }

          if (cancelled || actionResolved) return;
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
                turn: (working.turnIndex ?? 0) + 1,
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
            applyAndNotify(result);
            flashLastPlayed(playedTileForHighlight);
          }
        } finally {
          setDrawSequenceActiveBoth(false);
        }
      })();
    }, thinkDelayMs);

    const maxThinkingTimer = setTimeout(() => {
      if (cancelled || actionResolved) return;
      const live = matchRef.current;
      if (!live || live.currentPlayer !== 'bot' || live.handOver || live.gameOver) return;
      const fallbackPlay = asPlayMoves(getLegalMoves(live, 'bot'))[0];
      if (!fallbackPlay) return;
      cancelled = true;
      actionResolved = true;
      const beforeEndsRaw = getDisplayOpenEnds(live);
      const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
      const forcedResult = applyPlayMove(live, 'bot', fallbackPlay);
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
    runDrawSequenceLocal,
    setDrawSequenceActiveBoth,
    isMuted,
    toEngineBestFromChoice,
  ]);

  const advanceHand = useCallback(() => {
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);
    if (isDailyFritzMode && dailyFritzPackage) {
      const cache = dailyFritzNextHandRef.current;
      dailyFritzNextHandRef.current = null;

      if (cache?.result) {
        // Prefetch already settled — instant hand transition, no spinner.
        setHandReveal(null);
        setMatch((prev) =>
          prev.handOver && !prev.gameOver
            ? {
                ...startNextFixedBotHand(prev, cache.result!.hand),
                opponentPassedOnEnds: [],
                opponentDrawCount: 0,
                opponentKnownMissing: [],
              }
            : prev,
        );
      } else {
        // Still in-flight (edge case) or no prefetch — show spinner and await.
        setGhostResultLoading(true);
        const handPromise =
          cache?.promise ??
          nextDailyFritzHand({
            attemptId: dailyFritzPackage.attempt_id,
            verifiedMatchId: dailyFritzPackage.verified_match_id,
            completedHandScores: {
              you: match.players.you.score,
              fritz: match.players.bot.score,
            },
          });
        void handPromise
          .then((response) => {
            setHandReveal(null);
            setMatch((prev) =>
              prev.handOver && !prev.gameOver
                ? {
                    ...startNextFixedBotHand(prev, response.hand),
                    opponentPassedOnEnds: [],
                    opponentDrawCount: 0,
                    opponentKnownMissing: [],
                  }
                : prev,
            );
            setGhostResultLoading(false);
          })
          .catch((err) => {
            setGhostResultLoading(false);
            setGhostResultError(err instanceof Error ? err.message : 'Failed to load next Daily Fritz hand.');
          });
      }
      return;
    }
    setHandReveal(null);
    setMatch((prev) =>
      prev.handOver && !prev.gameOver
        ? {
            ...startNextBotHand(prev),
            opponentPassedOnEnds: [],
            opponentDrawCount: 0,
            opponentKnownMissing: [],
          }
        : prev,
    );
  }, [dailyFritzPackage, isDailyFritzMode, match.players.bot.score, match.players.you.score]);

  useEffect(() => {
    if (!handReveal || match.gameOver) {
      setHandRevealProgress(1);
      return;
    }
    setHandRevealProgress(1);
    // In guided mode, user taps "Next Hand →" manually — no auto-advance
    if (isGuidedMode) return;
    const rafId = requestAnimationFrame(() => setHandRevealProgress(0));
    const timer = setTimeout(() => {
      advanceHand();
    }, 5000);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [handReveal, match.gameOver, advanceHand, isGuidedMode]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.handNumber]);

  useEffect(() => {
    if (!match.handOver || match.gameOver || handReveal || handRevealTimerRef.current) return;
    // Safety fallback: if a hand ended without the reveal modal flow starting, advance anyway.
    const timer = window.setTimeout(() => {
      if (matchRef.current.handOver && !matchRef.current.gameOver && !handRevealTimerRef.current) {
        advanceHand();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [match.handOver, match.gameOver, handReveal, advanceHand]);

  useEffect(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver || drawSequenceActiveRef.current) return;
    if (userPlayMoves.length > 0) return;
    let cancelled = false;
    const beforeEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    void (async () => {
      setDrawSequenceActiveBoth(true);
      try {
        const result = await runDrawSequenceLocal(match, 'you');
        if (cancelled) return;
        setSelectedTile(null);
        if (result.drew) {
          if (isGhostMode) {
            appendGhostMove({
              turn: (match.turnIndex ?? 0) + 1,
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
        if (result.passed) {
          if (isGhostMode) {
            appendGhostMove({
              turn: (match.turnIndex ?? 0) + 1,
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
        setDrawSequenceActiveBoth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [match, userPlayMoves.length, appendGhostMove, appendMove, runDrawSequenceLocal, setDrawSequenceActiveBoth, isGhostMode, isMuted, getFritzBestMove]);

  useEffect(() => {
    if (!isDailyPuzzleRun || !dailyPuzzleDate || !match.gameOver) return;

    const syncKey = `${dailyPuzzleDate}|${userId ?? 'guest'}|${movesUsed}|${match.players.you.score}`;
    if (dailyResultSyncKeyRef.current === syncKey) return;
    dailyResultSyncKeyRef.current = syncKey;

    let active = true;
    const syncLeaderboard = async () => {
      if (isGuidedMode) return;
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
      const tileCount = Math.max(1, match.players.you.hand.length);
      const forceTwoRows = tileCount > 9;
      const maxTileSize = 56; // 14-tile reference size cap
      let tileWidth = maxTileSize;
      if (tileCount >= 9 && tileCount <= 10) tileWidth = 64;
      else if (tileCount >= 11 && tileCount <= 14) tileWidth = 56;
      else if (tileCount >= 15) tileWidth = 48;
      tileWidth = Math.min(tileWidth, maxTileSize);
      const trayHeight = forceTwoRows ? 138 : 120;
      document.documentElement.style.setProperty('--tray-height', `${trayHeight}px`);
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [match.players.you.hand.length]);

  const handActive = !match.handOver && !match.gameOver;
  const botTurn = match.currentPlayer === 'bot' && handActive;
  const turnLabel = match.handOver
    ? match.gameOver
      ? match.winnerId === 'you'
        ? 'You win the match'
        : `${opponentLabel} wins the match`
      : 'Hand complete'
    : botTurn
      ? `${opponentLabel} thinking`
      : 'Your move';

  const openEnds = getDisplayOpenEnds(match);
  const openEndsSum = match.board ? computeOpenEndsSum(match.board) : 0;
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
          <button className="btn" onClick={onBack}>Return to Home</button>
        </div>
      </div>
    );
  }

  const handRevealScoredTiles = handReveal
    ? handReveal.winner === 'you'
      ? handReveal.botRemainingTiles
      : handReveal.yourRemainingTiles
    : [];
  const handRevealScoredPips = sumTilePips(handRevealScoredTiles);

  return (
    <div
      ref={rootRef}
      className={`screen game-screen walnut-live theme-${uiTheme} bot-match-screen`}
    >
      <ScoreTrackOverlay
        open={scoreTrackOpen}
        onClose={() => setScoreTrackOpen(false)}
        target={winningScore}
        players={[
          { label: opponentLabel, score: match.players.bot.score, tone: 'opp' },
          { label: 'You', score: match.players.you.score, tone: 'you' },
        ]}
      />
      {toast && <div className="toast">{toast}</div>}
      {handReveal && !match.gameOver && (
        <div className="game-over-overlay hand-over-upgraded-overlay">
          <div className="game-over-card hand-over-upgraded-card">
            <div className="game-over-header">
              <div className="game-over-title-block">
                <span className="game-over-kicker">Hand Complete</span>
                <h3 className="victory-title">Hand Over</h3>
              </div>
              <div className={`hand-over-points-pill ${handReveal.winner === 'you' ? 'is-you' : 'is-opponent'}`}>
                +{handReveal.pointsAwarded}
              </div>
            </div>

            <div className={`hand-over-summary-card ${handReveal.winner === 'you' ? 'winner-you' : 'winner-opponent'}`}>
              <span className="hand-over-summary-label">
                {handReveal.winner === 'you' ? 'You won this hand' : `${opponentLabel} won this hand`}
              </span>
              <strong>+{handReveal.pointsAwarded} points awarded</strong>
              <p>
                {handRevealScoredPips} remaining pips rounded to {handReveal.pointsAwarded} point
                {handReveal.pointsAwarded === 1 ? '' : 's'}.
              </p>
            </div>

            {handReveal.reason === 'blocked' ? (
              <div className="hand-over-reveal-grid">
                <div className={`hand-over-reveal-panel ${handReveal.winner === 'you' ? 'is-winner' : ''}`}>
                  <div className="hand-over-reveal-label">Your Remaining Tiles</div>
                  <div className="hand-over-tile-row">
                    {handReveal.yourRemainingTiles.map((tile, idx) => (
                      <DominoTile
                        key={`you-reveal-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={52}
                        className="hand-over-tile"
                      />
                    ))}
                  </div>
                </div>
                <div className={`hand-over-reveal-panel ${handReveal.winner === 'bot' ? 'is-winner' : ''}`}>
                  <div className="hand-over-reveal-label">{opponentLabel} Remaining Tiles</div>
                  <div className="hand-over-tile-row">
                    {handReveal.botRemainingTiles.map((tile, idx) => (
                      <DominoTile
                        key={`bot-reveal-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={52}
                        className="hand-over-tile"
                      />
                    ))}
                  </div>
                </div>
              </div>
            ) : handReveal.winner === 'you' ? (
              <div className="hand-over-reveal-panel is-winner">
                <div className="hand-over-reveal-label">You cleared your hand</div>
                <p className="hand-over-reveal-copy">
                  {opponentLabel} had {handReveal.botRemainingTiles.length} tile
                  {handReveal.botRemainingTiles.length === 1 ? '' : 's'} remaining
                </p>
                {handReveal.botRemainingTiles.length > 0 && (
                  <div className="hand-over-tile-row">
                    {handReveal.botRemainingTiles.map((tile, idx) => (
                      <DominoTile
                        key={`bot-reveal-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={52}
                        className="hand-over-tile"
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="hand-over-reveal-panel is-winner">
                <div className="hand-over-reveal-label">{opponentLabel} cleared their hand</div>
                <p className="hand-over-reveal-copy">Your remaining tiles</p>
                {handReveal.yourRemainingTiles.length > 0 && (
                  <div className="hand-over-tile-row">
                    {handReveal.yourRemainingTiles.map((tile, idx) => (
                      <DominoTile
                        key={`you-reveal-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={52}
                        className="hand-over-tile"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
            {isGuidedMode && coach.handSummary && (
              <LearningHandRecap summary={coach.handSummary} />
            )}
            {isGuidedMode ? (
              <button className="mode-inline-btn guided-next-hand-btn" onClick={advanceHand}>
                Next Hand →
              </button>
            ) : (
              <div className="hand-over-progress-track">
                <div
                  className="hand-over-progress-fill"
                  style={{ width: `${Math.max(0, Math.min(1, handRevealProgress)) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      {match.gameOver && (
        <GameOverModal
          open
          ariaLabel={`${opponentLabel} match over`}
          title={isGhostMode ? 'Ghost Mode' : match.winnerId === 'you' ? 'Champion!' : `${opponentLabel} Wins`}
          subtitle={`Final hand ${match.handNumber} · ${match.dealSize}-tile mode`}
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
            isDailyFritzMode ? 'Back to Daily Fritz' : isGhostMode ? 'Play Again' : 'New Match'
          }
          onPrimary={startFreshMatch}
          secondaryLabel="Home"
          onSecondary={onBack}
          extraActionLabel={isGuidedMode ? undefined : "Analyze Game"}
          onExtraAction={isGuidedMode ? undefined : openAnalyzer}
          onClose={onBack}
        >
          {!isGuidedMode &&
            !isGhostMode &&
            !isDailyFritzMode &&
            (ghostResultLoading || ghostResultError || hasConfirmedFritzRatingUpdate || fritzNewGlickoRating != null) && (
            <div className="game-over-result-stat">
              <span>Rating</span>
              <strong>
                {ghostResultLoading
                  ? 'Updating...'
                  : fritzGlickoDelta != null && fritzNewGlickoRating != null
                    ? `${formatRatingDelta(fritzGlickoDelta)}  •  ${fritzNewGlickoRating}`
                  : fritzNewGlickoRating != null
                    ? `${fritzNewGlickoRating}`
                  : ghostResultError
                    ? ghostResultError
                  : ghostResult
                      ? 'Saved, rating unavailable'
                      : 'Rating unavailable'}
              </strong>
            </div>
          )}
          {isDailyFritzMode && (
            <div className="game-over-result-stat">
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

      <div className="wl-top-rail bot-top-rail" data-ui="hud" style={{ position: 'relative' }}>
        <div className="bot-hud-left-cluster">
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={`wl-player-pill wl-player-pill-btn ${botTurn ? 'is-active' : ''}`}
              ref={opponentPillRef}
              onClick={() => setScoreTrackOpen(true)}
              aria-label="Open score track"
              style={{ width: ghostSubLabel ? 'auto' : 110, minWidth: ghostSubLabel ? 140 : 110, padding: '0 12px' }}
            >
              <div className="wl-pill-top" style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                {ghostSubLabel && (
                  <span className="wl-player-label" style={{ fontSize: '0.74rem', opacity: 0.9, textTransform: 'none', fontWeight: 700 }}>
                    {formatGhostName(ghostSubLabel)}
                  </span>
                )}
                <span className="wl-player-label" style={{ fontSize: '0.62rem', opacity: 0.7, letterSpacing: '0.05em' }}>{opponentLabel}</span>
              </div>
              <span className="wl-player-score">{match.players.bot.score}</span>
            </button>
            <TileRack
                  count={match.players.bot.hand.length}
                  isActive={botTurn}
                  variant="default"
                />          </div>
        </div>

        <div
          className="bot-hud-center-cluster wl-center-status"
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className={`wl-turn-label ${botTurn ? 'opp-turn' : 'your-turn'}`}>
            {turnLabel}
          </span>
          <span
            className="open-ends-pill"
            style={{
              position: 'absolute',
              left: 'calc(100% + 8px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1.05,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 999,
              padding: '4px 12px',
              fontSize: '0.78rem',
              color: 'rgba(232,245,240,0.8)',
              fontWeight: 600,
            }}
          >
            <span>{openEndsSum}</span>
            <span style={{ fontSize: '0.66rem', opacity: 0.9 }}>open</span>
          </span>
        </div>

        <div
          className="bot-hud-right-cluster"
          style={{
            gridColumn: 3,
            justifySelf: 'end',
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            type="button"
            className={`wl-player-pill wl-player-pill-btn is-you ${!botTurn && handActive ? 'is-active' : ''}`}
            onClick={() => setScoreTrackOpen(true)}
            aria-label="Open score track"
            style={{ width: 130, minWidth: 'unset' }}
          >
            <span className="wl-player-label">You</span>
            <span className="wl-player-score">{match.players.you.score}</span>
          </button>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div
          className={`board-area wl-board-area ${ghostBoardPulse ? 'ghost-board-pulse' : ''}`}
          data-ui="board"
        >
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
          {!match.gameOver && (
            <div
              ref={boneyardRef}
              className="boneyard-pill"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                zIndex: 8,
                borderRadius: 999,
                border: '1.5px solid rgba(236,252,245,0.28)',
                background: 'rgba(255,255,255,0.08)',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                color: 'rgba(232,245,240,0.98)',
                padding: '7px 14px',
                fontSize: '1rem',
                fontWeight: 800,
                letterSpacing: '0.02em',
                pointerEvents: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <BoneyardStackIcon className="boneyard-icon" style={{ width: 18, height: 18, opacity: 0.85 }} />
              <span className="boneyard-count">{match.boneyard.length}</span>
              {match.boneyard.length > 0 && match.boneyard.length <= 2 ? (
                <span className="boneyard-meta" style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.9 }}>locked</span>
              ) : null}
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
          {isGuidedMode && (
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
          <Board
            board={match.board}
            legalMoves={userPlayMoves}
            selectedTile={selectedTile}
            lastPlayedTile={lastPlayedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
          <div
            className="wl-controls-tray"
            style={{
              position: 'absolute',
              bottom: 12,
              right: 12,
              zIndex: 20,
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 999,
              padding: '6px 10px',
              border: '1.5px solid rgba(255,255,255,0.12)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
            }}
          >
            <button
              onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))}
              title="Toggle table color"
              className={`table-theme-toggle ${uiTheme === 'green' ? 'is-green' : 'is-brown'}`}
              style={{ width: 22, height: 22 }}
            >
              <span className="table-theme-dot" aria-hidden="true" style={{ width: 10, height: 10 }} />
            </button>
            <button
              className="btn text icon-btn volume-btn"
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? 'Unmute' : 'Mute'}
              style={{
                padding: '6px 8px',
                color: 'rgba(232,245,240,0.9)',
                background: 'none',
                border: 'none',
              }}
            >
              <VolumeIcon isMuted={isMuted} style={{ width: 20, height: 20 }} />
            </button>
            <button
              className="btn text icon-btn fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                padding: '6px 8px',
                color: 'rgba(232,245,240,0.9)',
                background: 'none',
                border: 'none',
              }}
            >
              <FullscreenIcon isFullscreen={isFullscreen} style={{ width: 20, height: 20 }} />
            </button>
            <button
              onClick={() => setShowLeaveConfirm(true)}
              title="Leave game"
              style={{
                padding: '6px 8px',
                color: 'rgba(232,245,240,0.8)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5z" />
                <polyline points="9 21 9 12 15 12 15 21" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center" ref={handAreaRef}>
            <div className={`hand-container ${handCompactStacked ? 'is-stacked' : ''}`}>
              {(handCompactStacked
                ? [
                    match.players.you.hand.slice(0, Math.ceil(match.players.you.hand.length / 2)),
                    match.players.you.hand.slice(Math.ceil(match.players.you.hand.length / 2)),
                  ]
                : [match.players.you.hand]
              ).map((row, rowIdx) => (
                <div key={`bot-hand-row-${rowIdx}`} className="hand-row">
                  {row.map((tile, idx) => {
                    const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                    const playable = userPlayMoves.some((m) => m.tile && tileEquals(m.tile, tile));
                    const absoluteIdx = match.players.you.hand.findIndex((handTile) => tileEquals(handTile, tile));
                    const tileKey = `${tile.low}-${tile.high}`;
                    const guidedPts = isGuidedMode ? (guidedScoringTiles.get(tileKey) ?? 0) : 0;
                    const guidedClass = isGuidedMode && playable
                      ? guidedPts > 0 ? 'guided-scoring' : 'guided-legal'
                      : '';
                    const baseClass = drawPulseIndex === absoluteIdx ? 'new-draw' : '';
                    return (
                      <div
                        key={`bot-hand-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                        className={`guided-tile-wrap${isGuidedMode && playable && guidedPts > 0 ? ' has-badge' : ''}`}
                      >
                        {isGuidedMode && playable && guidedPts > 0 && (
                          <span className="guided-score-badge">+{guidedPts}</span>
                        )}
                        <DominoTile
                          tile={tile}
                          size={handTileSize}
                          rotation={0}
                          className={[baseClass, guidedClass].filter(Boolean).join(' ')}
                          selected={selected}
                          highlight={playable}
                          disabled={!handActive || botTurn || drawSequenceActive}
                          onClick={() => {
                            if (!handActive || botTurn) return;
                            if (!playable) return;
                            setSelectedTile(tile);
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

      <GameReviewer
        open={analyzerOpen}
        onClose={() => setAnalyzerOpen(false)}
        analysis={currentAnalysis}
        title="Game Review"
      />

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
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Leave game confirmation"
          onClick={() => setShowLeaveConfirm(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1900,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(5, 8, 14, 0.62)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            padding: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '480px',
              borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.10)',
              background: 'rgb(18, 22, 32)',
              boxShadow: '0 32px 80px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
              padding: '48px 44px',
              color: 'rgba(235, 245, 242, 0.96)',
            }}
          >
            <h2
              style={{
                margin: '0 0 20px',
                fontSize: '2rem',
                fontWeight: 700,
                color: 'white',
              }}
            >
              Leave game?
            </h2>
            <p
              style={{
                margin: '0 0 36px',
                color: 'rgba(200,220,215,0.65)',
                fontSize: '0.95rem',
                lineHeight: 1.45,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span aria-hidden="true">⚠️</span>
              <span>Your progress in this hand will be lost.</span>
            </p>
            <div
              style={{
                display: 'flex',
                gap: 10,
                width: '100%',
              }}
            >
              <button
                onClick={() => setShowLeaveConfirm(false)}
                style={{
                  flex: 1,
                  background: 'rgba(45,160,120,0.85)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 14,
                  padding: '16px 0',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  clearPersistedLeagueMatch();
                  if (isStandaloneFritzMatch && !match.gameOver) {
                    void abandonStandaloneFritzMatch()
                      .catch((err) => {
                        console.warn('[Fritz Pending] abandon failed', err);
                      })
                      .finally(() => {
                        void Promise.resolve(onProfileRefresh?.()).catch(() => {});
                        onBack();
                      });
                    return;
                  }
                  onBack();
                }}
                style={{
                  flex: 1,
                  background: 'rgba(180,40,40,0.25)',
                  border: '1px solid rgba(220,80,80,0.5)',
                  color: 'rgba(240,140,140,0.9)',
                  borderRadius: 14,
                  padding: '16px 0',
                  fontSize: '1rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
