import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  drawOne,
  getMatchableOpenEnds,
  getDisplayOpenEnds,
  getLegalMoves,
  passTurn,
  startNextBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotMatchState,
  type BotPlayerId,
} from './botEngine';
import { chooseBotMove, type BotChoice } from './botHeuristics';
import { getLocalDateKey } from '../dailyPuzzle/date';
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
import './botMatch.css';

interface BotMatchScreenProps {
  onBack: () => void;
  dealSize: BotDealSize;
  dailyPuzzleDate?: string | null;
  userId?: string | null;
  username?: string | null;
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

function FullscreenIcon({ isFullscreen }: { isFullscreen: boolean }) {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

function VolumeIcon({ isMuted }: { isMuted: boolean }) {
  return (
    <svg className="icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
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

function toastFromResult(result: BotActionResult): string {
  if (result.handEnded) {
    const winner = result.handEnded.winner === 'you' ? 'You' : 'Fritz';
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.passed) return `${result.passed.player === 'you' ? 'You' : 'Fritz'} passed`;
  return '';
}

export default function BotMatchScreen({
  onBack,
  dealSize,
  dailyPuzzleDate = null,
  userId = null,
  username = null,
}: BotMatchScreenProps) {
  const DRAW_STEP_MS = 700;
  const rootRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const [match, setMatch] = useState<BotMatchState>(() => createBotMatch(60, dealSize));
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
  const [movesUsed, setMovesUsed] = useState(0);
  const [dailyLeaderboard, setDailyLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [dailyLeaderboardLoading, setDailyLeaderboardLoading] = useState(false);
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveEntry[]>([]);
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
  const dailyResultSyncKeyRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameWinConfettiKeyRef = useRef('');
  const gameOverSoundKeyRef = useRef('');
  const matchRef = useRef(match);
  const prevTurnRef = useRef<BotPlayerId>(match.currentPlayer);
  const isDailyPuzzleRun = Boolean(dailyPuzzleDate);
  const showDebug =
    typeof window !== 'undefined' && window.localStorage.getItem('BOT_DEBUG') === '1';
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const showDevCapture = Boolean(
    adminEmail &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem('sb-fisfadjqllojdzibcdfx-auth-token') &&
    (() => {
      try {
        const raw = window.localStorage.getItem('sb-fisfadjqllojdzibcdfx-auth-token');
        const parsed = JSON.parse(raw ?? '{}');
        return parsed?.user?.email?.toLowerCase() === adminEmail.toLowerCase();
      } catch {
        return false;
      }
    })(),
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
    showBoardToast(`${player === 'you' ? 'You' : 'Fritz'} scored +${points}`, player);
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

  const appendMove = (entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you' ? moveCounterRef.current++ : moveCounterRef.current;
    setMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  };

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
    const choice = chooseBotMove(evalState, 'hard');
    if (!choice || !choice.move.tile) return null;
    return {
      tile: toTileTuple(choice.move.tile as Tile),
      position: choice.move.position,
      score: choice.score,
      breakdown: choice.breakdown,
    };
  }, []);

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

  const copyAsDailyPuzzleJson = async () => {
    if (!match.board) {
      pushToast('Open the hand first to capture a puzzle state');
      return;
    }

    const payload = {
      title: 'Captured Puzzle',
      puzzle_date: getLocalDateKey(),
      puzzle_type: 'one_turn_high_score',
      max_moves: 1,
      target_score: 1,
      deal_size: match.dealSize,
      starting_board: match.board,
      starting_hand: match.players.you.hand,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      pushToast('Copied puzzle JSON');
    } catch {
      pushToast('Copy failed');
    }
  };

  const startFreshMatch = () => {
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);
    setHandReveal(null);
    setMovesUsed(0);
    setDailyLeaderboard([]);
    setDailyLeaderboardError(null);
    setDailyLeaderboardLoading(false);
    setMoveLog([]);
    moveCounterRef.current = 1;
    setCurrentAnalysis(null);
    setAnalyzerOpen(false);
    dailyResultSyncKeyRef.current = '';
    gameWinConfettiKeyRef.current = '';
    setMatch(createBotMatch(60, dealSize));
  };

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

  const userLegalMoves = useMemo(() => {
    return match.currentPlayer === 'you' ? getLegalMoves(match, 'you') : [];
  }, [match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);

  const applyAndNotify = (result: BotActionResult) => {
    setMatch((prev) => {
      const trackedDraw = result.drew?.player === 'you' ? 1 : 0;
      const trackedPass = result.passed?.player === 'you' ? 1 : 0;
      if (trackedDraw === 0 && trackedPass === 0) {
        return result.state;
      }

      const openEnds = result.state.board
        ? getMatchableOpenEnds(result.state.board).map((end) => end.matchValue)
        : [];

      return {
        ...result.state,
        opponentPassedOnEnds: [
          ...(prev.opponentPassedOnEnds ?? []),
          ...Array.from({ length: trackedDraw + trackedPass }, () => openEnds).flat(),
        ],
        opponentDrawCount: (prev.opponentDrawCount ?? 0) + trackedDraw,
        opponentKnownMissing: prev.opponentKnownMissing ?? result.state.opponentKnownMissing ?? [],
      };
    });
    if (result.handEnded) {
      flashLastPlayed(null);
      const handEndedData = result.handEnded;
      const yourRemainingTiles = result.state.players.you.hand;
      const botRemainingTiles = result.state.players.bot.hand;
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
    const msg = toastFromResult(result);
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
    const validMoves = userPlayMoves
      .filter((m) => m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    const beforePips = sumTilePips(match.players.you.hand);
    const result = applyPlayMove(match, 'you', move);
    const afterPips = sumTilePips(result.state.players.you.hand);
    setMovesUsed((prev) => prev + 1);
    applyAndNotify(result);
    flashLastPlayed(move.tile ?? null);
    setSelectedTile(null);
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

  useEffect(() => {
    if (match.currentPlayer !== 'bot' || match.handOver || match.gameOver || drawSequenceActiveRef.current) return;
    let cancelled = false;
    let actionResolved = false;
    let playedTileForHighlight: Tile | null = null;

    const timer = setTimeout(() => {
      void (async () => {
        let working = match;
        let result: BotActionResult | null = null;
        let chosen: BotChoice | null = null;
        const beforeEndsRaw = getDisplayOpenEnds(match);
        const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];

        const botPlayable = asPlayMoves(getLegalMoves(working, 'bot'));
        if (botPlayable.length === 0) {
          setDrawSequenceActiveBoth(true);
          try {
            const drawPass = await runDrawSequenceLocal(working, 'bot');
            if (cancelled) return;
            working = drawPass.state;

            if (drawPass.drew) {
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
              chosen = chooseBotMove(working, 'hard');
              playedTileForHighlight = chosen?.move?.tile ?? afterDraw[0]?.tile ?? null;
              queueSound(() => playTileSound('deal', isMuted), 0);
              result = applyPlayMove(working, 'bot', chosen?.move ?? afterDraw[0]);
            }
          } finally {
            setDrawSequenceActiveBoth(false);
          }
        } else {
          chosen = chooseBotMove(working, 'hard');
          playedTileForHighlight = chosen?.move?.tile ?? botPlayable[0]?.tile ?? null;
          queueSound(() => playTileSound('deal', isMuted), 0);
          result = applyPlayMove(working, 'bot', chosen?.move ?? botPlayable[0]);
        }

        if (cancelled || actionResolved) return;
        if (chosen) setLastBotChoice(chosen);
        if (result) {
          actionResolved = true;
          setSelectedTile(null);
          if (chosen?.move?.tile) {
            appendMove({
              player: 'opponent',
              action: 'place',
              tile: toTileTuple(chosen.move.tile),
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
          applyAndNotify(result);
          flashLastPlayed(playedTileForHighlight);
        }
      })();
    }, 760);

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
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(maxThinkingTimer);
    };
  }, [
    match,
    appendMove,
    runDrawSequenceLocal,
    setDrawSequenceActiveBoth,
    isMuted,
    toEngineBestFromChoice,
  ]);

  const advanceHand = useCallback(() => {
    setSelectedTile(null);
    flashLastPlayed(null);
    setLastBotChoice(null);
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
  }, []);

  useEffect(() => {
    if (!handReveal || match.gameOver) {
      setHandRevealProgress(1);
      return;
    }
    setHandRevealProgress(1);
    const rafId = requestAnimationFrame(() => setHandRevealProgress(0));
    const timer = setTimeout(() => {
      advanceHand();
    }, 5000);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
    };
  }, [handReveal, match.gameOver, advanceHand]);

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
  }, [match, userPlayMoves.length, appendMove, runDrawSequenceLocal, setDrawSequenceActiveBoth, isMuted, getFritzBestMove]);

  useEffect(() => {
    if (!isDailyPuzzleRun || !dailyPuzzleDate || !match.gameOver) return;

    const syncKey = `${dailyPuzzleDate}|${userId ?? 'guest'}|${movesUsed}|${match.players.you.score}`;
    if (dailyResultSyncKeyRef.current === syncKey) return;
    dailyResultSyncKeyRef.current = syncKey;

    let active = true;
    const syncLeaderboard = async () => {
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
        : 'Fritz wins the match'
      : 'Hand complete'
    : botTurn
      ? 'Fritz thinking'
      : 'Your move';

  const openEnds = getDisplayOpenEnds(match);
  const openEndsSum = match.board ? computeOpenEndsSum(match.board) : 0;
  return (
    <div
      ref={rootRef}
      className={`screen game-screen walnut-live theme-${uiTheme} bot-match-screen`}
    >
      <ScoreTrackOverlay
        open={scoreTrackOpen}
        onClose={() => setScoreTrackOpen(false)}
        target={60}
        players={[
          { label: 'Fritz', score: match.players.bot.score, tone: 'opp' },
          { label: 'You', score: match.players.you.score, tone: 'you' },
        ]}
      />
      {toast && <div className="toast">{toast}</div>}
      {handReveal && !match.gameOver && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1500,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(6, 10, 18, 0.62)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'rgba(10,18,15,0.95)',
              border: '1px solid rgba(236,252,245,0.14)',
              borderRadius: 20,
              padding: 32,
              width: 480,
              maxWidth: '90vw',
              boxShadow: '0 26px 70px rgba(0,0,0,0.48)',
              color: 'rgba(232,245,240,0.95)',
              display: 'grid',
              gap: 18,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, marginBottom: 6 }}>
              Hand Over
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: '1rem',
                color:
                  handReveal.winner === 'you' ? '#2ecc8e' : 'rgba(232,245,240,0.6)',
                marginBottom: 20,
                fontWeight: 600,
              }}
            >
              {handReveal.winner === 'you'
                ? `🎉 You won this hand  +${handReveal.pointsAwarded} pts`
                : `Fritz won this hand  +${handReveal.pointsAwarded} pts`}
            </p>

            {handReveal.reason === 'blocked' ? (
              <div style={{ display: 'grid', gap: 16 }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div
                    style={{
                      fontSize: '0.95rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'rgba(232,245,240,0.9)',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    Your Remaining Tiles
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
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
                <div style={{ display: 'grid', gap: 8 }}>
                  <div
                    style={{
                      fontSize: '0.95rem',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: 'rgba(232,245,240,0.9)',
                      fontWeight: 600,
                      textAlign: 'center',
                    }}
                  >
                    Fritz Remaining Tiles
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
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
              <div style={{ display: 'grid', gap: 10 }}>
                <div
                  style={{
                    color: 'rgba(151, 241, 205, 0.98)',
                    fontWeight: 700,
                    fontSize: '1rem',
                    textAlign: 'center',
                  }}
                >
                  🎉 You cleared your hand
                </div>
                <div
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: 'rgba(232,245,240,0.9)',
                    textAlign: 'center',
                  }}
                >
                  Fritz had {handReveal.botRemainingTiles.length} tile
                  {handReveal.botRemainingTiles.length === 1 ? '' : 's'} remaining:
                </div>
                {handReveal.botRemainingTiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
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
              <div style={{ display: 'grid', gap: 10 }}>
                <div
                  style={{
                    color: 'rgba(232,245,240,0.9)',
                    fontWeight: 600,
                    fontSize: '0.95rem',
                    textAlign: 'center',
                  }}
                >
                  Fritz cleared their hand
                </div>
                <div
                  style={{
                    color: 'rgba(232,245,240,0.9)',
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  Your remaining tiles:
                </div>
                {handReveal.yourRemainingTiles.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
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
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 3,
                background: 'rgba(46,204,142,0.25)',
                borderRadius: '0 0 20px 20px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(1, handRevealProgress)) * 100}%`,
                  background: '#2ecc8e',
                  borderRadius: '0 0 20px 20px',
                  transition: 'width 5000ms linear',
                }}
              />
            </div>
          </div>
        </div>
      )}
      {match.gameOver && (
        <GameOverModal
          open
          ariaLabel="Fritz match over"
          title={match.winnerId === 'you' ? 'Champion!' : 'Fritz Wins'}
          subtitle={`Final hand ${match.handNumber} · ${match.dealSize}-tile mode`}
          scores={[
            {
              label: 'You',
              value: match.players.you.score,
              winner: match.winnerId === 'you',
              showCrown: match.winnerId === 'you',
            },
            {
              label: 'Fritz',
              value: match.players.bot.score,
              winner: match.winnerId === 'bot',
              showCrown: match.winnerId === 'bot',
            },
          ]}
          primaryLabel="New Match"
          onPrimary={startFreshMatch}
          secondaryLabel="Home"
          onSecondary={onBack}
          extraActionLabel="Analyze Game"
          onExtraAction={openAnalyzer}
          onClose={onBack}
        >
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
              style={{ width: 110, minWidth: 'unset' }}
            >
              <div className="wl-pill-top">
                <span className="wl-player-label">Fritz</span>
              </div>
              <span className="wl-player-score">{match.players.bot.score}</span>
            </button>
            <TileRack
              count={match.players.bot.hand.length}
              isActive={botTurn}
            />
          </div>
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
          {showDevCapture && (
            <button
              className="btn text compact bot-chip-control bot-admin-chip"
              onClick={copyAsDailyPuzzleJson}
              title="Copy Puzzle JSON"
            >
              <span aria-hidden="true">📋</span>
              <span className="bot-admin-chip-label">Copy Puzzle JSON</span>
            </button>
          )}
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
        <div className="board-area wl-board-area" data-ui="board">
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
                top: 10,
                right: 10,
                zIndex: 8,
                borderRadius: 999,
                border: '1px solid rgba(236,252,245,0.24)',
                background: 'rgba(255,255,255,0.06)',
                backdropFilter: 'blur(20px)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
                color: 'rgba(232,245,240,0.85)',
                padding: '5px 10px',
                fontSize: '0.78rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                pointerEvents: 'none',
              }}
            >
              <BoneyardStackIcon className="boneyard-icon" />
              <span className="boneyard-count">{match.boneyard.length}</span>
              {match.boneyard.length > 0 && match.boneyard.length <= 2 ? (
                <span className="boneyard-meta">locked</span>
              ) : null}
            </div>
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
              bottom: 10,
              right: 10,
              zIndex: 20,
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 999,
              padding: '4px 6px',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            }}
          >
            <button
              onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))}
              title="Toggle table color"
              className={`table-theme-toggle ${uiTheme === 'green' ? 'is-green' : 'is-brown'}`}
            >
              <span className="table-theme-dot" aria-hidden="true" />
            </button>
            <button
              className="btn text icon-btn volume-btn"
              onClick={() => setIsMuted((prev) => !prev)}
              title={isMuted ? 'Unmute' : 'Mute'}
              style={{
                padding: '4px 6px',
                color: 'rgba(200,220,215,0.7)',
                background: 'none',
                border: 'none',
              }}
            >
              <VolumeIcon isMuted={isMuted} />
            </button>
            <button
              className="btn text icon-btn fullscreen-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              style={{
                padding: '4px 6px',
                color: 'rgba(200,220,215,0.7)',
                background: 'none',
                border: 'none',
              }}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
            <button
              onClick={() => setShowLeaveConfirm(true)}
              title="Leave game"
              style={{
                padding: '4px 6px',
                color: 'rgba(200,220,215,0.55)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
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
                    return (
                      <DominoTile
                        key={`bot-hand-${rowIdx}-${idx}-${tile.low}-${tile.high}`}
                        tile={tile}
                        size={handTileSize}
                        rotation={0}
                        className={drawPulseIndex === absoluteIdx ? 'new-draw' : ''}
                        selected={selected}
                        highlight={playable}
                        disabled={!handActive || botTurn || drawSequenceActive}
                        onClick={() => {
                          if (!handActive || botTurn) return;
                          if (!playable) return;
                          setSelectedTile(tile);
                        }}
                      />
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
            <strong>Fritz hand:</strong>{' '}
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
                onClick={onBack}
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
