import { useEffect, useMemo, useRef, useState } from 'react';
import { Board, DominoTile, ScoreTrackOverlay } from '../components';
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
  type MoveEntry,
  pickEngineBestMove,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from '../analyzer/moveLogger';
import {
  applyPlayMove,
  createBotMatch,
  drawUntilPlayableOrEmpty,
  getDisplayOpenEnds,
  getLegalMoves,
  startNextBotHand,
  type BotActionResult,
  type BotDealSize,
  type BotMatchState,
} from './botEngine';
import { chooseBotMove, type BotChoice, type BotDifficulty } from './botHeuristics';
import { getLocalDateKey } from '../dailyPuzzle/date';
import './botMatch.css';

interface BotMatchScreenProps {
  onBack: () => void;
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
  if (result.scored) {
    return `${result.scored.player === 'you' ? 'You' : 'Bot'} scored +${result.scored.points}`;
  }
  if (result.handEnded) {
    const winner = result.handEnded.winner === 'you' ? 'You' : 'Bot';
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.drew) return `${result.drew.player === 'you' ? 'You' : 'Bot'} drew`;
  if (result.passed) return `${result.passed.player === 'you' ? 'You' : 'Bot'} passed`;
  return '';
}

export default function BotMatchScreen({
  onBack,
  dailyPuzzleDate = null,
  userId = null,
  username = null,
}: BotMatchScreenProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [dealSize, setDealSize] = useState<BotDealSize>(7);
  const [match, setMatch] = useState<BotMatchState>(() => createBotMatch(60, 7));
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [toast, setToast] = useState('');
  const [difficulty, setDifficulty] = useState<BotDifficulty>('standard');
  const [lastBotChoice, setLastBotChoice] = useState<BotChoice | null>(null);
  const [handReveal, setHandReveal] = useState<BotHandReveal | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [movesUsed, setMovesUsed] = useState(0);
  const [dailyLeaderboard, setDailyLeaderboard] = useState<DailyPuzzleLeaderboardEntry[]>([]);
  const [dailyLeaderboardLoading, setDailyLeaderboardLoading] = useState(false);
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveEntry[]>([]);
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const moveCounterRef = useRef(1);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const dailyResultSyncKeyRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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

  const appendMove = (entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you' ? moveCounterRef.current++ : moveCounterRef.current;
    setMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  };

  const openAnalyzer = () => {
    const analysis = analyzeMoveLog(moveLog);
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
    setMatch(createBotMatch(60, dealSize));
  };

  const userLegalMoves = useMemo(() => {
    return match.currentPlayer === 'you' ? getLegalMoves(match, 'you') : [];
  }, [match]);
  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);

  const applyAndNotify = (result: BotActionResult) => {
    setMatch(result.state);
    if (result.handEnded) {
      setHandReveal({
        winner: result.handEnded.winner,
        reason: result.handEnded.reason,
        pointsAwarded: result.handEnded.pointsAwarded,
        loserPips: result.handEnded.loserPips,
        calcText: result.handEnded.calcText,
        botRemainingTiles: result.state.players.bot.hand,
      });
    }
    const msg = toastFromResult(result);
    if (msg) pushToast(msg);
  };

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
    const mirroredChoice = chooseBotMove(
      {
        ...match,
        players: {
          you: match.players.bot,
          bot: match.players.you,
        },
        currentPlayer: 'bot',
      },
      'hard',
    );
    setMovesUsed((prev) => prev + 1);
    setSelectedTile(null);
    appendMove({
      player: 'you',
      action: 'place',
      tile: toTileTuple(selectedTile),
      boardEnds,
      handBefore,
      validMoves,
      pipDelta: beforePips - afterPips,
      boardState: snapshotBoardState(match.board),
      boardRenderState: cloneBoardState(match.board),
      handSnapshot: handBefore,
      engineBestMove: mirroredChoice?.move?.tile
        ? {
            tile: toTileTuple(mirroredChoice.move.tile as Tile),
            position: mirroredChoice.move.position,
            score: mirroredChoice.score,
          }
        : pickEngineBestMove(
            userPlayMoves
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
    });
    applyAndNotify(result);
  };

  useEffect(() => {
    if (match.currentPlayer !== 'bot' || match.handOver || match.gameOver) return;

    const timer = setTimeout(() => {
      let working = match;
      let result: BotActionResult | null = null;
      let chosen: BotChoice | null = null;
      const beforeEndsRaw = getDisplayOpenEnds(match);
      const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];

      const botPlayable = asPlayMoves(getLegalMoves(working, 'bot'));
      if (botPlayable.length === 0) {
        const drawPass = drawUntilPlayableOrEmpty(working, 'bot');
        working = drawPass.state;
        if (drawPass.drew) {
          appendMove({
            player: 'opponent',
            action: 'draw',
            boardEnds,
            handBefore: [],
            validMoves: [],
            pipDelta: 0,
            boardState: snapshotBoardState(match.board),
            boardRenderState: cloneBoardState(match.board),
            handSnapshot: match.players.you.hand.map(toTileTuple),
            engineBestMove: null,
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
            boardState: snapshotBoardState(match.board),
            boardRenderState: cloneBoardState(match.board),
            handSnapshot: match.players.you.hand.map(toTileTuple),
            engineBestMove: null,
          });
        }
        const afterDraw = asPlayMoves(getLegalMoves(working, 'bot'));
        if (afterDraw.length === 0) {
          result = drawPass;
        } else {
          chosen = chooseBotMove(working, difficulty);
          result = applyPlayMove(working, 'bot', chosen?.move ?? afterDraw[0]);
        }
      } else {
        chosen = chooseBotMove(working, difficulty);
        result = applyPlayMove(working, 'bot', chosen?.move ?? botPlayable[0]);
      }

      if (chosen) setLastBotChoice(chosen);
      if (result) {
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
            boardState: snapshotBoardState(match.board),
            boardRenderState: cloneBoardState(match.board),
            handSnapshot: match.players.you.hand.map(toTileTuple),
            engineBestMove: null,
          });
        }
        applyAndNotify(result);
      }
    }, 760);

    return () => clearTimeout(timer);
  }, [match, difficulty]);

  useEffect(() => {
    if (!handReveal || match.gameOver) return;
    const timer = setTimeout(() => {
      setSelectedTile(null);
      setLastBotChoice(null);
      setHandReveal(null);
      setMatch((prev) => (prev.handOver && !prev.gameOver ? startNextBotHand(prev) : prev));
    }, 4200);
    return () => clearTimeout(timer);
  }, [handReveal, match.gameOver]);

  useEffect(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    if (userPlayMoves.length > 0) return;
    const beforeEndsRaw = getDisplayOpenEnds(match);
    const boardEnds: [number, number] = [beforeEndsRaw[0] ?? -1, beforeEndsRaw[1] ?? -1];
    const handBefore = match.players.you.hand.map(toTileTuple);
    const result = drawUntilPlayableOrEmpty(match, 'you');
    setSelectedTile(null);
    if (result.drew) {
      appendMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves: [],
        pipDelta: 0,
        boardState: snapshotBoardState(match.board),
        boardRenderState: cloneBoardState(match.board),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          userPlayMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
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
        boardState: snapshotBoardState(match.board),
        boardRenderState: cloneBoardState(match.board),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          userPlayMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    }
    applyAndNotify(result);
  }, [match, userPlayMoves.length]);

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
      const MAX_TRAY_WIDTH = window.innerWidth - 32;
      const BASE_TILE_WIDTH = 56;
      const MIN_TILE_WIDTH = 32;
      const fittedWidth = Math.floor(MAX_TRAY_WIDTH / tileCount);
      const tileWidth = Math.max(MIN_TILE_WIDTH, Math.min(BASE_TILE_WIDTH, fittedWidth));
      const useVertical = tileWidth <= MIN_TILE_WIDTH || tileCount > 14;
      setHandTileSize(tileWidth);
      setHandCompactStacked(useVertical);
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
        : 'Bot wins the match'
      : 'Hand complete'
    : botTurn
      ? 'Bot thinking'
      : 'Your move';

  const openEnds = getDisplayOpenEnds(match);

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
          { label: 'Bot', score: match.players.bot.score, tone: 'opp' },
          { label: 'You', score: match.players.you.score, tone: 'you' },
        ]}
      />
      {toast && <div className="toast">{toast}</div>}
      {handReveal && !match.gameOver && (
        <div className="hand-reveal-overlay">
          <div className="hand-reveal-backdrop" />
          <div className="hand-reveal-modal">
            <div className="hand-reveal-card">
              <h3>Hand Over</h3>
              <p className="reveal-points">
                {handReveal.winner === 'you' ? 'You' : 'Bot'} +{handReveal.pointsAwarded}
                {' · '}
                {handReveal.reason} ({handReveal.calcText})
              </p>
              <p className="reveal-label">Bot remaining tiles</p>
              <div className="reveal-tiles">
                {handReveal.botRemainingTiles.map((tile, idx) => (
                  <DominoTile
                    key={`bot-reveal-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={34}
                    className="hand-over-tile"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {match.gameOver && (
        <GameOverModal
          open
          ariaLabel="Bot match over"
          title={match.winnerId === 'you' ? 'Champion!' : 'Bot Wins'}
          subtitle={`Final hand ${match.handNumber} · ${match.dealSize}-tile mode`}
          scores={[
            {
              label: 'You',
              value: match.players.you.score,
              winner: match.winnerId === 'you',
              showCrown: match.winnerId === 'you',
            },
            {
              label: 'Bot',
              value: match.players.bot.score,
              winner: match.winnerId === 'bot',
              showCrown: match.winnerId === 'bot',
            },
          ]}
          primaryLabel="New Match"
          onPrimary={startFreshMatch}
          secondaryLabel="Home"
          onSecondary={onBack}
          onClose={onBack}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              width: '100%',
              marginTop: 24,
              gridColumn: '1 / -1',
            }}
          >
            <button className="mode-inline-btn" onClick={openAnalyzer}>
              Analyze Game
            </button>
          </div>
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

      <div className="wl-top-rail bot-top-rail" data-ui="hud">
        {/* Left: Bot score pill */}
        <button
          type="button"
          className={`wl-player-pill wl-player-pill-btn ${botTurn ? 'is-active' : ''}`}
          onClick={() => setScoreTrackOpen(true)}
          aria-label="Open score track"
        >
          <div className="wl-pill-top">
            <span className="wl-player-label">Bot</span>
            <span className="wl-tiles-chip">
              <span className="wl-tiles-count">{match.players.bot.hand.length}</span>
              <span className="wl-tiles-text">tiles</span>
            </span>
          </div>
          <span className="wl-player-score">{match.players.bot.score}</span>
        </button>

        {/* Center zone: left-controls | status | right-controls */}
        <div className="bot-center-zone">
          {/* Left controls: fullscreen + Bot difficulty + Deal */}
          <div className="bot-controls-left">
            <button
              className="btn text icon-btn fullscreen-btn bot-chip-control"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <FullscreenIcon isFullscreen={isFullscreen} />
            </button>
            <label className="bot-difficulty bot-chip-control">
              <span>Bot</span>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as BotDifficulty)}
              >
                <option value="casual">Casual</option>
                <option value="standard">Standard</option>
                <option value="hard">Hard</option>
              </select>
            </label>
            <label className="bot-difficulty bot-chip-control">
              <span>Deal</span>
              <select
                value={dealSize}
                onChange={(e) => {
                  const nextDeal = Number(e.target.value) as BotDealSize;
                  setDealSize(nextDeal);
                  setSelectedTile(null);
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
                  setMatch(createBotMatch(60, nextDeal));
                }}
              >
                <option value={7}>7 tiles + boneyard</option>
                <option value={14}>14 tiles (no boneyard)</option>
              </select>
            </label>
          </div>

          {/* Center status */}
          <div className="wl-center-status">
            <span className={`wl-turn-label ${botTurn ? 'opp-turn' : 'your-turn'}`}>
              {turnLabel}
            </span>
            <span className="wl-room-code">
              Hand {match.handNumber} · Offline vs Bot · {match.dealSize}-tile
              {match.dealSize === 14 ? ' (no boneyard)' : ''}
            </span>
          </div>

          {/* Right controls: Color + New Match + Copy JSON + Home */}
          <div className="bot-controls-right">
            <button
              className="btn text compact bot-chip-control"
              onClick={() => setUiTheme((prev) => (prev === 'green' ? 'brown' : 'green'))}
            >
              Color
            </button>
            <button className="btn text compact bot-chip-control" onClick={startFreshMatch}>
              New Match
            </button>
            {showDevCapture && (
              <button className="btn text compact bot-chip-control" onClick={copyAsDailyPuzzleJson}>
                Copy Puzzle JSON
              </button>
            )}
            <button className="btn text leave-btn compact bot-chip-control" onClick={onBack}>
              Home
            </button>
          </div>
        </div>

        {/* Right: You score pill */}
        <button
          type="button"
          className={`wl-player-pill wl-player-pill-btn is-you ${!botTurn && handActive ? 'is-active' : ''}`}
          onClick={() => setScoreTrackOpen(true)}
          aria-label="Open score track"
        >
          <span className="wl-player-label">You</span>
          <span className="wl-player-score">{match.players.you.score}</span>
        </button>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          {!match.gameOver && (
            <div
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                zIndex: 8,
                borderRadius: 999,
                border: '1px solid rgba(236,252,245,0.24)',
                background: 'rgba(10,16,28,0.78)',
                color: 'rgba(232,245,240,0.95)',
                padding: '5px 10px',
                fontSize: '0.78rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                pointerEvents: 'none',
              }}
            >
              Boneyard: {match.boneyard.length > 0 ? `${match.boneyard.length} left` : 'Empty'}
            </div>
          )}
          <Board
            board={match.board}
            legalMoves={userPlayMoves}
            selectedTile={selectedTile}
            onPositionClick={onPositionClick}
            tileSize={72}
          />
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div className={`hand-container ${handCompactStacked ? 'is-stacked' : ''}`}>
              {match.players.you.hand.map((tile, idx) => {
                const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                const playable = userPlayMoves.some((m) => m.tile && tileEquals(m.tile, tile));
                return (
                  <DominoTile
                    key={`bot-hand-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={handTileSize}
                    rotation={handCompactStacked ? 90 : 0}
                    selected={selected}
                    highlight={playable}
                    disabled={!handActive || botTurn}
                    onClick={() => {
                      if (!handActive || botTurn) return;
                      if (!playable) return;
                      setSelectedTile(tile);
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <GameReviewer
        open={analyzerOpen}
        onClose={() => setAnalyzerOpen(false)}
        analysis={currentAnalysis}
        title="Game Review"
      />

      {showDebug && (
        <aside className="bot-debug-panel">
          <div>
            <strong>Bot hand:</strong>{' '}
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
    </div>
  );
}
