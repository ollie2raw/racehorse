import React, { Suspense, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { User } from '@supabase/supabase-js';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from './components/RoomReactions';
import type { Socket } from 'socket.io-client';
import './App.css';
import { Board, BoneyardStackIcon, DominoTile, ScoreTrackOverlay } from './components';
import TileRack from './components/TileRack';
import {
  playDrawSound,
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playTileSound,
} from './utils/sound';
import GameOverModal from './components/GameOverModal';
import { isTemporaryUsername, useAuth } from './auth/useAuth';
import LayoutScreen from './ui/LayoutScreen';
import { analyzeMoveLog, saveGameAnalysis, type GameAnalysis } from './analyzer/moveAnalyzer';
import {
  type MoveEntry,
  nextEndsForTile,
  pickEngineBestMove,
  snapshotBoardState,
  cloneBoardState,
  toTileTuple,
} from './analyzer/moveLogger';
import { fetchUserStatsByUserId, fetchWeeklyRecap, recordMatchResult } from './stats/statsApi';
import { fetchGhostProfileSummary, type GhostProfileSummary } from './ghost/api';
import type { Tile, PlacementPosition, GameState, Move, StateUpdate } from './types';
import type { BotDealSize } from './bot/botEngine';
import type { FritzTier } from './bot/fritzConfig';
import { useRoomSocketSync } from './multiplayer/useRoomSocketSync';
import { useMultiplayerConnection } from './multiplayer/useMultiplayerConnection';
import { useMultiplayerRoomActions } from './multiplayer/useMultiplayerRoomActions';
import { useRenderProfiler } from './debug/renderProfiler';
import {
  loadAuthoringSession,
  saveFrozenLesson,
  loadFrozenLesson,
} from './learn/guidedAuthoring';

function emitWithAck<TResp>(
  socket: { emit: (...args: any[]) => void },
  event: string,
  ...argsWithoutAck: any[]
): Promise<TResp> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${event} timed out after 8000ms`)),
      8000,
    );
    socket.emit(event, ...argsWithoutAck, (resp: TResp) => {
      window.clearTimeout(t);
      resolve(resp);
    });
  });
}

// ─── Utilities ───────────────────────────────────────────────
type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};
type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';
type TournamentPlayer = {
  socketId: string;
  username: string;
  userId?: string | null;
  isBot?: boolean;
};

const EMPTY_MOVES: Move[] = [];

const NoBrainerLabScreen = React.lazy(() => import('./practice/NoBrainerLabScreen'));
const BotMatchScreen = React.lazy(() => import('./bot/BotMatchScreen'));
const BotSetupScreen = React.lazy(() => import('./bot/BotSetupScreen'));
const GhostSetupScreen = React.lazy(() => import('./ghost/GhostSetupScreen'));
const DailyPuzzleScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleScreen'));
const DailyFritzScreen = React.lazy(() => import('./dailyFritz/DailyFritzScreen'));
const DailyPuzzleAdminScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleAdminScreen'));
const LeagueScreen = React.lazy(() => import('./league/LeagueScreen'));
const RatingHistoryPage = React.lazy(() => import('./ranking/RatingHistoryPage'));
const GameReviewer = React.lazy(() => import('./analyzer/GameReviewer'));
const AuthModal = React.lazy(() => import('./auth/AuthModal'));
const UsernameModal = React.lazy(() => import('./auth/UsernameModal'));
const StatsScreen = React.lazy(() => import('./stats/StatsScreen'));
const FriendsScreen = React.lazy(() => import('./friends/FriendsScreen'));
const LearnHome = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.LearnHome })),
);
const LearnPlayer = React.lazy(() =>
  import('./learn').then((module) => ({ default: module.LearnPlayer })),
);

function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

function tileListEquals(a: Tile[], b: Tile[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!tileEquals(a[i], b[i])) return false;
  }
  return true;
}

function normalizeUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeRoomPlayers(value: unknown): RoomPlayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, username: 'Guest', userId: null };
      }
      if (entry && typeof entry === 'object') {
        const rec = entry as { id?: unknown; username?: unknown; userId?: unknown };
        const id = typeof rec.id === 'string' ? rec.id : '';
        const userId = typeof rec.userId === 'string' ? rec.userId.trim() || null : null;
        return { id, username: normalizeUsername(rec.username), userId };
      }
      return { id: '', username: 'Guest', userId: null };
    })
    .filter((p) => Boolean(p.id));
}

const LAST_ROOM_STORAGE_KEY = 'racehorse_last_room_code';

function getBoardEnds(board: GameState['board']): [number, number] {
  if (!board) return [-1, -1];
  return [board.leftEnd, board.rightEnd];
}


function getBoardTileCount(board: GameState['board']): number {
  if (!board) return 0;
  let count = board.mainLine.length;
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      if (arm) count += arm.tiles.length;
    }
  }
  return count;
}

function getBoardTiles(board: GameState['board']): Tile[] {
  if (!board) return [];
  const tiles: Tile[] = [];
  for (const placed of board.mainLine) {
    tiles.push(placed.tile);
  }
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (!branch) continue;
      for (const placed of branch.tiles) {
        tiles.push(placed.tile);
      }
    }
  }
  return tiles;
}

function ScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(180deg, #11231b 0%, #0c1511 100%)',
        color: 'rgba(232,245,240,0.92)',
        padding: 24,
      }}
    >
      <div
        style={{
          padding: '14px 18px',
          borderRadius: 18,
          border: '1px solid rgba(236,252,245,0.16)',
          background: 'rgba(15,25,20,0.72)',
          fontSize: '0.95rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

function tileKey(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}-${high}`;
}

function findPlacedTile(
  previousBoard: GameState['board'],
  nextBoard: GameState['board'],
): Tile | null {
  const prevCounts = new Map<string, number>();
  for (const tile of getBoardTiles(previousBoard)) {
    const key = tileKey(tile);
    prevCounts.set(key, (prevCounts.get(key) ?? 0) + 1);
  }
  for (const tile of getBoardTiles(nextBoard)) {
    const key = tileKey(tile);
    const prevCount = prevCounts.get(key) ?? 0;
    if (prevCount <= 0) return tile;
    prevCounts.set(key, prevCount - 1);
  }
  return null;
}

function getOpenEndsSum(board: GameState['board']): number {
  if (!board || board.mainLine.length === 0) return 0;
  if (board.mainLine.length === 1) {
    const tile = board.mainLine[0]?.tile;
    return tile ? tile.low + tile.high : 0;
  }

  let sum = 0;
  sum += board.leftEndIsDouble ? board.leftEnd * 2 : board.leftEnd;
  sum += board.rightEndIsDouble ? board.rightEnd * 2 : board.rightEnd;
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (!branch) continue;
      sum += branch.openEndIsDouble ? branch.openEnd * 2 : branch.openEnd;
    }
  }
  return sum;
}

const LEARN_MODE_VISIBLE = true;

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
    <svg className="icon-svg volume-svg" style={style} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 10h4l5-4v12l-5-4H4z" />
      {!isMuted && (
        <>
          <path d="M16 9a4 4 0 010 6" />
          <path d="M18 7a7 7 0 010 10" />
        </>
      )}
      {isMuted && <path className="icon-slash" d="M5 5l14 14" />}
    </svg>
  );
}

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
  tileSize: number;
  compactStacked: boolean;
  drawPulseIndex: number | null;
}

const HandView = React.memo(function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  compactStacked,
  drawPulseIndex,
}: HandViewProps) {
  useRenderProfiler('HandView');
  const playableTiles = useMemo(() => {
    return legalMoves.filter((m) => m.type === 'play' && m.tile).map((m) => m.tile!);
  }, [legalMoves]);

  const canPlayTile = (tile: Tile) => {
    return playableTiles.some((t) => tileEquals(t, tile));
  };

  const renderTile = (tile: Tile, idx: number) => {
    const isSel = selectedTile && tileEquals(tile, selectedTile);
    const canPlay = isMyTurn && canPlayTile(tile);
    return (
      <DominoTile
        key={`${tile.low}-${tile.high}`}
        tile={tile}
        size={tileSize}
        selected={isSel ?? false}
        highlight={canPlay}
        onClick={() => isMyTurn && onSelect(tile)}
        disabled={!isMyTurn}
        className={drawPulseIndex === idx ? 'new-draw' : ''}
      />
    );
  };

  if (compactStacked) {
    const splitAt = Math.ceil(hand.length / 2);
    const firstRow = hand.slice(0, splitAt);
    const secondRow = hand.slice(splitAt);
    return (
      <div className="hand-container is-stacked">
        <div className="hand-row">{firstRow.map((tile, idx) => renderTile(tile, idx))}</div>
        <div className="hand-row">{secondRow.map((tile, idx) => renderTile(tile, splitAt + idx))}</div>
      </div>
    );
  }

  return <div className="hand-container">{hand.map((tile, idx) => renderTile(tile, idx))}</div>;
}, (prev, next) => (
  prev.hand === next.hand &&
  prev.selectedTile === next.selectedTile &&
  prev.onSelect === next.onSelect &&
  prev.isMyTurn === next.isMyTurn &&
  prev.legalMoves === next.legalMoves &&
  prev.tileSize === next.tileSize &&
  prev.compactStacked === next.compactStacked &&
  prev.drawPulseIndex === next.drawPulseIndex
));

// ─── Game Over Overlay ───────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onPrimary: () => void;
  primaryLabel: string;
  onExit: () => void;
  secondaryLabel: string;
  waitingText?: string;
  players: RoomPlayer[];
  ratingSummary?: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}

interface HandEndedPayload {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
}

function GameOverOverlay({
  state,
  myId,
  onPrimary,
  primaryLabel,
  onExit,
  secondaryLabel,
  waitingText,
  players,
  ratingSummary = null,
  extraActionLabel,
  onExtraAction,
}: GameOverOverlayProps) {
  const winner = state.winnerId;
  const iWon = winner === myId;
  const getName = (pid: string, idx: number) => {
    const p = players.find((pl) => pl.id === pid);
    if (p?.username) return `@${p.username}`;
    return pid === myId ? 'You' : `Player ${idx + 1}`;
  };
  const winnerIdx = winner ? state.playerIds.indexOf(winner) : -1;
  const victoryTitle = winner
    ? `${getName(winner, winnerIdx >= 0 ? winnerIdx : 0)} wins!`
    : iWon
      ? 'You Win!'
      : 'You Lose';

  return (
    <GameOverModal
      open
      ariaLabel="Game over"
      title={victoryTitle}
      subtitle="Final score"
      scores={state.playerIds.map((pid, idx) => ({
        label: getName(pid, idx),
        value: state.players[pid]?.score ?? 0,
        winner: pid === winner,
        showCrown: pid === winner,
      }))}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onExit}
      extraActionLabel={extraActionLabel}
      onExtraAction={onExtraAction}
      onClose={onExit}
    >
      {ratingSummary && (
        <div className="game-over-result-stat">
          <span>Rating</span>
          <strong>
            {ratingSummary.pending
              ? 'Updating...'
              : ratingSummary.delta != null && ratingSummary.newRating != null
                ? `${ratingSummary.delta >= 0 ? '+' : ''}${ratingSummary.delta}  •  ${ratingSummary.newRating}`
                : 'Updated'}
          </strong>
        </div>
      )}
      {waitingText && (
        <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', fontSize: '0.92rem' }}>{waitingText}</p>
      )}
    </GameOverModal>
  );
}


function WeeklyStatsScreen({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
}) {
  const [recap, setRecap] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) {
      setRecap(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void fetchWeeklyRecap(user)
      .then((resp) => {
        if (!active) return;
        setLoading(false);
        if (resp.error || !resp.data) {
          setError(resp.error ?? 'Unable to load weekly recap.');
          setRecap(null);
          return;
        }
        setRecap(resp.data);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setError('Unable to load weekly recap.');
      });
    return () => {
      active = false;
    };
  }, [open, user]);

  const recapSections = recap
    ? [
        {
          title: 'Fritz This Week',
          icon: '🤖',
          tone: 'rgba(94, 234, 212, 0.16)',
          rows: [
            { label: 'Ranked Games', value: recap.fritz.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.fritz.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.fritz.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.fritz.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.fritz.bestWinMarginThisWeek == null ? '—' : `${recap.fritz.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Ghost This Week',
          icon: '👻',
          tone: 'rgba(216, 180, 254, 0.16)',
          rows: [
            { label: 'Ghost Games', value: recap.ghost.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.ghost.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.ghost.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.ghost.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.ghost.bestWinMarginThisWeek == null ? '—' : `${recap.ghost.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Puzzle This Week',
          icon: '🧩',
          tone: 'rgba(240, 192, 64, 0.16)',
          rows: [
            { label: 'Completions', value: recap.puzzle.completionsThisWeek },
            { label: 'Best Today', value: recap.puzzle.bestScoreToday == null ? '—' : recap.puzzle.bestScoreToday },
          ],
        },
        {
          title: 'Multiplayer This Week',
          icon: '🌐',
          tone: 'rgba(148, 163, 184, 0.16)',
          rows: [
            { label: 'Online Games', value: recap.multiplayer.gamesThisWeek },
            { label: 'Wins', value: recap.multiplayer.wins },
            { label: 'Losses', value: recap.multiplayer.losses },
          ],
        },
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Weekly stats"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        pointerEvents: open ? 'auto' : 'none',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transform: open ? 'scale(1)' : 'scale(0.97)',
        transition: 'opacity 180ms ease, transform 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1901,
          pointerEvents: 'auto',
          width: 'min(1120px, calc(100vw - 32px))',
          maxHeight: 'min(92vh, 920px)',
          borderRadius: '20px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '22px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '16px',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true">🏆</span>
              <span>Weekly Recap</span>
            </h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', fontSize: '1.12rem' }}>
              {recap?.weekLabel ?? 'This week'}
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading weekly recap...</p>}
        {error && <p className="auth-inline-error" style={{ margin: 0 }}>{error}</p>}

        {!loading && !error && recapSections.length > 0 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {recapSections.map((section) => (
              <div
                key={section.title}
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '16px',
                  display: 'grid',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: '1.22rem' }}>{section.icon}</span>
                  <strong style={{ fontSize: '1.16rem', color: 'rgba(240,248,255,0.96)' }}>{section.title}</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 12,
                  }}
                >
                  {section.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: section.tone,
                        padding: '14px 16px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: '0.98rem', color: 'rgba(191,213,223,0.88)', fontWeight: 700 }}>{row.label}</span>
                      <strong style={{ fontSize: '1.56rem', color: '#f8fafc' }}>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
            No weekly recap available yet.
          </p>
        )}
      </div>
    </div>
  );
}


// ─── Main App ────────────────────────────────────────────────

export default function App() {
  useRenderProfiler('App');
  const appRootRef = useRef<HTMLDivElement>(null);
  const trayCenterRef = useRef<HTMLDivElement>(null);
  const autoConnectAttemptedRef = useRef(false);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const pendingCreateOnConnectRef = useRef(false);
  const pendingCreateResolversRef = useRef<Array<(code: string | null) => void>>([]);
  const [serverUrl] = useState(import.meta.env.VITE_SERVER_URL || 'http://localhost:3001');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [appMode, setAppMode] = useState<
    | 'home'
    | 'multiplayer'
    | 'noBrainer'
    | 'botSetup'
    | 'bot'
    | 'ghostSetup'
    | 'ghost'
    | 'daily'
    | 'dailyFritz'
    | 'league'
    | 'learn'
    | 'ratingHistory'
    | 'singlePlayerHub'
    | 'tournament'
  >('home');
  const [selectedLearnLessonId, setSelectedLearnLessonId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('racehorse_muted') === '1';
  });
  const [uiTheme, setUiTheme] = useState<'green' | 'brown'>(() => {
    if (typeof window === 'undefined') return 'green';
    const stored = window.localStorage.getItem('racehorse_ui_theme');
    return stored === 'brown' ? 'brown' : 'green';
  });
  const [botDealSize, setBotDealSize] = useState<BotDealSize>(() => {
    if (typeof window === 'undefined') return 7;
    const stored = window.localStorage.getItem('racehorse_bot_deal_size');
    return stored === '14' ? 14 : 7;
  });
  const [botFritzTier, setBotFritzTier] = useState<FritzTier>('elite');
  const [isGuidedMode, setIsGuidedMode] = useState(false);
  const [isAuthoringMode, setIsAuthoringMode] = useState(false);
  const [isAuthoringV2Mode, setIsAuthoringV2Mode] = useState(false);
  const [isGuidedV2Mode, setIsGuidedV2Mode] = useState(false);
  const [ghostProfile, setGhostProfile] = useState<GhostProfileSummary | null>(null);
  const [ghostOpponentName, setGhostOpponentName] = useState<string>('Ghost');
  const [ghostOpponentUserId, setGhostOpponentUserId] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [tournamentCode, setTournamentCode] = useState('');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<any>(null);
  const [tournamentActiveRoom, setTournamentActiveRoom] = useState<string | null>(null);
  const [roomReactions, setRoomReactions] = useState<Array<RoomChatEvent | RoomEmoteEvent>>([]);
  const [multiplayerRatingBaseline, setMultiplayerRatingBaseline] = useState<number | null>(null);
  const [multiplayerRatingPending, setMultiplayerRatingPending] = useState(false);
  const multiplayerRatingRefreshKeyRef = useRef('');

  useEffect(() => {
    if (!LEARN_MODE_VISIBLE && appMode === 'learn') {
      setSelectedLearnLessonId(null);
      setAppMode('singlePlayerHub');
    }
  }, [appMode]);

  const sendRoomChat = (text: string) => {
    const t = String(text ?? '').trim();
    if (!t) return;

    const localMsg = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      t: Date.now(),
      from: { userId: null as string | null, username: 'you' },
      text: t,
    };

    setRoomReactions((prev) => {
      const next = prev.concat(localMsg as any);
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    if (!socket) return;
    socket.emit('room:chat:send', { text: t });
  };

  const sendRoomEmote = (emote: string) => {
    const e = String(emote ?? '').trim();
    if (!e) return;

    const localEvt = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      t: Date.now(),
      from: { userId: null as string | null, username: 'you' },
      emote: e,
    };

    setRoomReactions((prev) => {
      const next = prev.concat(localEvt as any);
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });

    if (!socket) return;
    socket.emit('room:emote:send', { emote: e });
  };


  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [you, setYou] = useState<string>('');
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [legalMoves, setLegalMoves] = useState<Move[]>([]);
  const [canDraw, setCanDraw] = useState(false);
  const [error, setError] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');
  const [toast, setToast] = useState<string>('');
  const [scoreToast, setScoreToast] = useState<{
    message: string;
    tone: 'you' | 'opp';
    visible: boolean;
  } | null>(null);
  const [handReveal, setHandReveal] = useState<HandEndedPayload | null>(null);
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchReadyIds, setRematchReadyIds] = useState<string[]>([]);
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [multiplayerMoveLog, setMultiplayerMoveLog] = useState<MoveEntry[]>([]);
  const multiplayerMoveCounterRef = useRef(1);
  const previousStateForAnalysisRef = useRef<GameState | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [pendingUiAction, setPendingUiAction] = useState<
    null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'
  >(null);
  const {
    user: authUser,
    profile: authProfile,
    loading: authLoading,
    justVerified,
    supabaseEnabled,
    supabaseConfigError,
    signIn,
    signUp,
    resetPassword,
    signOut,
    updateUsername,
    refreshAuthProfile,
    applyProfilePatch,
  } = useAuth();
  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);
  const [weeklyAwards, setWeeklyAwards] = useState<any | null>(null);
  const [playersOnlineCount, setPlayersOnlineCount] = useState<number | null>(null);
  const [friendInvite, setFriendInvite] = useState<{
    fromUsername: string;
    roomCode: string;
    inviteUrl: string;
  } | null>(null);

  useEffect(() => {
    if (!authUser) {
      setGhostProfile(null);
      return;
    }
    let active = true;
    void fetchGhostProfileSummary(authUser.id)
      .then((summary) => {
        if (active) setGhostProfile(summary);
      })
      .catch(() => {
        if (active) setGhostProfile(null);
      });
    return () => {
      active = false;
    };
  }, [authUser]);

  const loadWeeklyAwards = useCallback(() => {
    if (!socket || !socket.connected) return;
    socket.emit("stats:weekly", (resp: any) => {
      if (!resp?.ok) return;
      setWeeklyAwards(resp.awards ?? null);
    });
  }, [socket]);

  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const joinedRoomRef = useRef<string | null>(null);
  const stateRef = useRef<GameState | null>(state);
  const reconnectRoomCodeRef = useRef<string | null>(null);
  const reconnectShouldJoinRef = useRef(false);
  const preventAutoRejoinRef = useRef(false);
  const autoJoinAttemptedRef = useRef(false);
  const joinInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);
  const inviteJoinInFlightRef = useRef(false);
  const rejoinInFlightRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const reconnectAttemptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptCountRef = useRef(0);
  const previousMultiplayerGameOverRef = useRef(false);
  const maxSequenceRef = useRef<number>(-1);
  const [isRecoveringConnection, setIsRecoveringConnection] = useState(false);
  const [roomRecoveryState, setRoomRecoveryState] = useState<RoomRecoveryState>('idle');
  const [roomRecoveryMessage, setRoomRecoveryMessage] = useState('');
  const roomMatchIdRef = useRef<string | null>(null);
  const maxEventSequenceRef = useRef<number>(-1);

  useEffect(() => {
    maxSequenceRef.current = -1;
    maxEventSequenceRef.current = -1;
    roomMatchIdRef.current = null;
  }, [joinedRoom]);

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [handTileSize, setHandTileSize] = useState(44);
  const [handCompactStacked, setHandCompactStacked] = useState(false);
  const autoTurnActionKeyRef = useRef<string>('');
  const handRevealShownRef = useRef<number | null>(null);
  const prevOppCountRef = useRef<number | null>(null);
  const [oppTilePulse, setOppTilePulse] = useState(false);
  const prevBoardTileCountRef = useRef(0);
  const prevTurnIdRef = useRef<string | null>(null);
  const [hudScorePulse, setHudScorePulse] = useState<Record<string, boolean>>({});
  const prevHudScoresRef = useRef<Record<string, number>>({});
  const prevMyHandLenRef = useRef(0);
  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);
  const [boneyardDisplayCount, setBoneyardDisplayCount] = useState<number | null>(null);
  const [drawStepMyHand, setDrawStepMyHand] = useState<Tile[] | null>(null);
  const [drawStepActorId, setDrawStepActorId] = useState<string | null>(null);
  const [optimisticPlayedTile, setOptimisticPlayedTile] = useState<Tile | null>(null);
  const [drawStepOpponentHandCount, setDrawStepOpponentHandCount] = useState<number | null>(null);
  const [drawSequenceActive, setDrawSequenceActive] = useState(false);
  const drawSequenceActiveRef = useRef(false);
  const drawSequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [flyingTiles, setFlyingTiles] = useState<
    { x: number; y: number; toX: number; toY: number; id: number }[]
  >([]);
  const flyingTileIdRef = useRef(0);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const [opponentDragging, setOpponentDragging] = useState(false);
  const draggingStateRef = useRef(false);
  const handRevealAutoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealAutoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [handRevealAutoProgress, setHandRevealAutoProgress] = useState(1);
  const isMutedRef = useRef(isMuted);
  const youRef = useRef(you);
  const matchRecordKeyRef = useRef('');
  const prevGameOverRef = useRef(false);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adminEmail = import.meta.env.VITE_ADMIN_EMAIL as string | undefined;
  const isAdmin = Boolean(
    authUser?.email && adminEmail && authUser.email.toLowerCase() === adminEmail.toLowerCase(),
  );
  const needsUsernameOnboarding = Boolean(
    authUser && !authLoading && authProfile !== null && isTemporaryUsername(authProfile.username),
  );
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem('username_onboarding_dismissed');
    if (!raw) return false;
    // Only snooze for 24 hours - after that the prompt returns
    const dismissedAt = parseInt(raw, 10);
    const SNOOZE_MS = 24 * 60 * 60 * 1000;
    return Date.now() - dismissedAt < SNOOZE_MS;
  });

  const showToast = useCallback((msg: string, duration = 3000) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => setToast(''), duration);
  }, []);

  const setDrawSequenceActiveBoth = useCallback((val: boolean) => {
    drawSequenceActiveRef.current = val;
    setDrawSequenceActive(val);
  }, []);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) {
      clearTimeout(lastPlayedTileTimerRef.current);
    }
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
      if (reconnectAttemptTimerRef.current) clearTimeout(reconnectAttemptTimerRef.current);
      if (drawSequenceTimeoutRef.current) clearTimeout(drawSequenceTimeoutRef.current);
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
  }, []);

  const clearReconnectAttemptTimer = useCallback(() => {
    if (reconnectAttemptTimerRef.current) {
      clearTimeout(reconnectAttemptTimerRef.current);
      reconnectAttemptTimerRef.current = null;
    }
  }, []);

  const showScoreLikeToast = useCallback((message: string, tone: 'you' | 'opp') => {
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      message,
      tone,
      visible: true,
    });
    scoreToastHideTimerRef.current = setTimeout(() => {
      setScoreToast((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 2800);
    scoreToastClearTimerRef.current = setTimeout(() => setScoreToast(null), 3200);
  }, []);

  const showScoreToast = useCallback(
    (player: 'you' | 'opp', points: number, label?: string) => {
      const currentScore = player === 'you'
        ? (stateRef.current?.players[you]?.score ?? 0)
        : (stateRef.current?.players[stateRef.current?.playerIds.find(p => p !== you) ?? '']?.score ?? 0);
      showScoreLikeToast(`${label ?? (player === 'you' ? 'You' : 'Opponent')} scored +${points} · ${currentScore} pts`, player);
    },
    [showScoreLikeToast, you],
  );

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasSeen = window.localStorage.getItem('hasSeenWelcome');
    if (!hasSeen) setWelcomeOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_ui_theme', uiTheme);
  }, [uiTheme]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_bot_deal_size', String(botDealSize));
  }, [botDealSize]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('racehorse_muted', isMuted ? '1' : '0');
  }, [isMuted]);


  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    authUserRef.current = authUser;
  }, [authUser]);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  useEffect(() => {
    if (justVerified) {
      showToast('✓ Email verified! Welcome to Racehorse Dominoes.', 5000);
    }
  }, [justVerified, showToast]);

  useEffect(() => {
    youRef.current = you;
  }, [you]);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (state) return;
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepOpponentHandCount(null);
    setBoneyardDisplayCount(null);
  }, [state, setDrawSequenceActiveBoth]);

  useEffect(() => {
    if (!socket || !authUser?.id) return;

    const username = authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player';

    const emitIdentify = () => {
      console.log('[presence] emitting presence:identify', { userId: authUser.id, connected: socket.connected });
      socket.emit('presence:identify', { userId: authUser.id, username }, () => {
        console.log('[presence] identify ack received');
      });
    };

    // Always register reconnect handler
    socket.on('connect', emitIdentify);

    // Also fire immediately if already connected
    if (socket.connected) {
      emitIdentify();
    }

    return () => {
      socket.off('connect', emitIdentify);
    };
  }, [socket, authUser?.id, authProfile?.username, authUser?.email]);

  useEffect(() => {
    joinedRoomRef.current = joinedRoom;
    if (typeof window === 'undefined') return;
    if (joinedRoom) {
      window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, joinedRoom);
    }
  }, [joinedRoom]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (inviteJoinInFlightRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const linkedRoom = normalizeRoomCode(params.get('room'));
    if (!linkedRoom) return;
    setRoomCode(linkedRoom);
    setAppMode('home');
  }, []);

  const getInviteLink = useCallback((code: string) => {
    if (typeof window === 'undefined') return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    return url.toString();
  }, []);

  const resolvePendingCreate = useCallback((code: string | null) => {
    const pending = pendingCreateResolversRef.current.splice(0);
    pending.forEach((resolve) => resolve(code));
  }, []);

  const clearTransientRoomUi = useCallback(() => {
    setSelectedTile(null);
    setPendingUiAction(null);
    setActionError('');
    setOptimisticPlayedTile(null);
    setOpponentDragging(false);
    draggingStateRef.current = false;
    if (drawSequenceTimeoutRef.current) {
      clearTimeout(drawSequenceTimeoutRef.current);
      drawSequenceTimeoutRef.current = null;
    }
    setDrawSequenceActiveBoth(false);
    setDrawStepMyHand(null);
    setDrawStepActorId(null);
    setDrawStepOpponentHandCount(null);
    setFlyingTiles([]);
  }, [setDrawSequenceActiveBoth]);

  const resetMultiplayerRoomState = useCallback(
    (options: { keepPlayers?: boolean; clearRoomCode?: boolean } = {}) => {
      const { keepPlayers = false, clearRoomCode = true } = options;
      setJoinedRoom(null);
      if (clearRoomCode) setRoomCode('');
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setSelectedTile(null);
      setHandReveal(null);
      setRematchRequested(false);
      setRematchReadyIds([]);
      setScoreTrackOpen(false);
      if (!keepPlayers) {
        setPlayers([]);
      }
      clearTransientRoomUi();
    },
    [clearTransientRoomUi],
  );

  const resetRoomRecoveryState = useCallback(() => {
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    preventAutoRejoinRef.current = true;
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
  }, []);

  const applyRoomEventMeta = useCallback((meta?: RoomEventMeta | null) => {
    if (!meta) return;
    const incomingMatchId = typeof meta.matchId === 'string' ? meta.matchId : null;
    if (incomingMatchId && roomMatchIdRef.current && roomMatchIdRef.current !== incomingMatchId) {
      maxSequenceRef.current = -1;
      maxEventSequenceRef.current = -1;
    }
    if (incomingMatchId) {
      roomMatchIdRef.current = incomingMatchId;
    }
    if (typeof meta.lastEventSequence === 'number') {
      maxEventSequenceRef.current = Math.max(maxEventSequenceRef.current, meta.lastEventSequence);
    }
  }, []);

  const emitCreateRoom = useCallback(
    async (targetSocket: Socket) => {
      setError('');
      setActionError('');
      try {
        const resp = await emitWithAck<any>(
          targetSocket,
          'room:create',
          {
            username: authProfile?.username ?? 'Guest',
            userId: authUser?.id ?? null,
          },
        );
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }
        setError('');
        setActionError('');
        setState(null);
        setLegalMoves([]);
        setCanDraw(false);
        setSelectedTile(null);
        setJoinedRoom(resp.roomCode);
        setRoomCode(resp.roomCode);
        setPlayers(normalizeRoomPlayers(resp.players));
        applyRoomEventMeta(resp.eventMeta);
        clearTransientRoomUi();
        setRoomRecoveryState('idle');
        setRoomRecoveryMessage('');
        autoJoinAttemptedRef.current = false;
        preventAutoRejoinRef.current = false;
        resolvePendingCreate(resp.roomCode);
        return resp;
      } catch (e) {
        resolvePendingCreate(null);
        throw e;
      }
    },
    [authProfile?.username, authUser?.id, resolvePendingCreate, applyRoomEventMeta, clearTransientRoomUi],
  );

  const applyJoinedRoomResponse = useCallback((resp: any) => {
    applyRoomEventMeta(resp.eventMeta);
    setJoinedRoom(resp.roomCode);
    setRoomCode(resp.roomCode);
    setState(resp.state ?? null);
    setPlayers(normalizeRoomPlayers(resp.players));
    clearTransientRoomUi();
    setLegalMoves(Array.isArray(resp.legalMoves) ? resp.legalMoves : []);
    setCanDraw(typeof resp.canDraw === 'boolean' ? resp.canDraw : false);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
  }, [applyRoomEventMeta, clearTransientRoomUi]);

  const roomSocketSyncParams = useMemo(
    () => ({
      socket,
      showToast,
      normalizeRoomPlayers,
      applyRoomEventMeta,
      setFriendInvite,
      joinedRoomRef,
      maxSequenceRef,
      setPlayers,
      setState,
      setRoomRecoveryState,
      setRoomRecoveryMessage,
      setOptimisticPlayedTile,
      setLegalMoves,
      setCanDraw,
      drawSequenceActiveRef,
      drawSequenceTimeoutRef,
      setDrawSequenceActiveBoth,
      setDrawStepMyHand,
      setDrawStepActorId,
      setDrawStepOpponentHandCount,
      setFlyingTiles,
      setBoneyardDisplayCount,
      setDrawPulseIndex,
      boneyardRef,
      handAreaRef,
      opponentPillRef,
      youRef,
      stateRef,
      flyingTileIdRef,
      isMutedRef,
      playDrawSound,
      tileEquals,
    }),
    [socket, showToast, applyRoomEventMeta, setDrawSequenceActiveBoth],
  );

  useRoomSocketSync(roomSocketSyncParams);

  useEffect(() => {
    if (!friendInvite) return;
    const timer = setTimeout(() => setFriendInvite(null), 30000);
    return () => clearTimeout(timer);
  }, [friendInvite]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (appRootRef.current) {
        await appRootRef.current.requestFullscreen();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to toggle fullscreen.';
      setError(`Fullscreen error: ${message}`);
    }
  }, []);

  const { connect, retryRoomRecovery, disconnect } = useMultiplayerConnection({
    emitWithAck,
    normalizeRoomCode,
    lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
    serverUrl,
    socket,
    isConnecting,
    isConnected,
    roomRecoveryState,
    appMode,
    authUserId: authUser?.id ?? null,
    authEmail: authUser?.email ?? null,
    authProfileUsername: authProfile?.username ?? null,
    tournamentId,
    tournamentStateStatus: tournamentState?.status ?? null,
    roomCode,
    connectRef,
    socketRef,
    authUserRef,
    authProfileRef,
    joinedRoomRef,
    stateRef,
    pendingCreateOnConnectRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    preventAutoRejoinRef,
    autoJoinAttemptedRef,
    joinInFlightRef,
    createInFlightRef,
    inviteJoinInFlightRef,
    rejoinInFlightRef,
    intentionalDisconnectRef,
    reconnectAttemptTimerRef,
    reconnectAttemptCountRef,
    autoConnectAttemptedRef,
    draggingStateRef,
    isMutedRef,
    handRevealShownRef,
    setSocket,
    setIsConnected,
    setIsConnecting,
    setIsRecoveringConnection,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setYou,
    setServerWaking,
    setError,
    setActionError,
    setRematchRequested,
    setRematchReadyIds,
    setOpponentDragging,
    setJoinedRoom,
    setState,
    setLegalMoves,
    setCanDraw,
    setTournamentId,
    setTournamentState,
    setTournamentActiveRoom,
    setRoomCode,
    setAppMode,
    setRoomReactions,
    setHandReveal,
    setPlayers,
    setSelectedTile,
    setPendingUiAction,
    showToast,
    applyJoinedRoomResponse,
    emitCreateRoom,
    clearReconnectAttemptTimer,
    clearTransientRoomUi,
  });

  const authUsernameRef = useRef(authProfile?.username ?? 'Guest');
  const authUserIdRef = useRef<string | null>(authUser?.id ?? null);
  useEffect(() => {
    authUsernameRef.current = authProfile?.username ?? 'Guest';
    authUserIdRef.current = authUser?.id ?? null;
  }, [authProfile?.username, authUser?.id]);

  const {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
    openLeagueLiveRoom,
    acceptFriendInvite,
  } = useMultiplayerRoomActions({
    socket,
    socketRef,
    connectRef,
    joinedRoomRef,
    pendingCreateOnConnectRef,
    pendingCreateResolversRef,
    autoJoinAttemptedRef,
    preventAutoRejoinRef,
    joinInFlightRef,
    createInFlightRef,
    inviteJoinInFlightRef,
    reconnectRoomCodeRef,
    reconnectShouldJoinRef,
    roomCode,
    friendInvite,
    authUsername: authProfile?.username ?? 'Guest',
    authUserId: authUser?.id ?? null,
    authUsernameRef,
    authUserIdRef,
    normalizeRoomCode,
    normalizeRoomPlayers,
    emitWithAck,
    emitCreateRoom,
    getInviteLink,
    resolvePendingCreate,
    applyJoinedRoomResponse,
    showToast,
    setAppMode,
    setRoomCode,
    setPlayers,
    setError,
    setActionError,
    setPendingUiAction,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setFriendsOpen,
    setFriendInvite,
    lastRoomStorageKey: LAST_ROOM_STORAGE_KEY,
  });

  useEffect(() => {
    if (!weeklyStatsOpen) return;

    if (!socket || !socket.connected) {
      connect();
      window.setTimeout(() => loadWeeklyAwards(), 250);
      return;
    }

    loadWeeklyAwards();
  }, [weeklyStatsOpen, socket, connect, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) {
      setPlayersOnlineCount(null);
      return;
    }

    let active = true;
    const refreshPresence = () => {
      socket.emit('presence:online', [], (resp: any) => {
        if (!active || !resp?.ok) return;
        if (Number.isFinite(resp.onlineCount)) {
          setPlayersOnlineCount(Number(resp.onlineCount));
          return;
        }
        if (Array.isArray(resp.onlineUserIds)) {
          setPlayersOnlineCount(resp.onlineUserIds.length);
          return;
        }
        setPlayersOnlineCount(null);
      });
    };

    refreshPresence();
    const interval = window.setInterval(refreshPresence, 30000);
    const onConnect = () => refreshPresence();
    socket.on('connect', onConnect);

    return () => {
      active = false;
      window.clearInterval(interval);
      socket.off('connect', onConnect);
    };
  }, [appMode, socket]);

  useEffect(() => {
    if (appMode !== 'home') return;
    if (!socket || !socket.connected) return;

    loadWeeklyAwards();
    const interval = window.setInterval(loadWeeklyAwards, 60000);
    return () => window.clearInterval(interval);
  }, [appMode, socket, loadWeeklyAwards]);

  useEffect(() => {
    if (appMode !== 'botSetup') return;
    setBotDealSize(7);
  }, [appMode]);



  const handlePostGame = useCallback(() => {
    resetRoomRecoveryState();
    // Tournament matches should return to tournament lobby, not disconnect to Home.
    const inTournament = Boolean(tournamentId) || tournamentState?.status === 'running';
    if (!inTournament) return disconnect('post-game to home');
    resetMultiplayerRoomState({ keepPlayers: true });
    setActionError('');
    setAppMode('tournament');
  }, [disconnect, tournamentId, tournamentState?.status, resetMultiplayerRoomState, resetRoomRecoveryState]);

  const _backToTournamentHub = useCallback(() => {
    resetRoomRecoveryState();
    if (socket && joinedRoom) {
      socket.emit('room:leave', joinedRoom);
    }
    resetMultiplayerRoomState({ keepPlayers: true });
    setActionError('');
    setAppMode('tournament');
  }, [socket, joinedRoom, resetMultiplayerRoomState, resetRoomRecoveryState]);

  const startGame = useCallback(async () => {
    setError('');
    setActionError('');
    if (!socket || !joinedRoom) return setError('Not in a room.');
    setPendingUiAction('start');
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    try {
      const resp = await emitWithAck<any>(socket, 'game:start', joinedRoom);
      if (!resp?.ok) return setError(resp?.error ?? 'Unable to start game.');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'start' ? null : prev));
    }
  }, [socket, joinedRoom, showToast]);

  const requestRematch = useCallback(() => {
    if (!socket || !joinedRoom || !state?.gameOver || rematchRequested) return;
    setRematchRequested(true);
    socket.emit('game:rematch', joinedRoom, (resp: any) => {
      if (resp?.ok) return;
      setRematchRequested(false);
      showToast(resp?.error ?? 'Rematch failed.');
    });
  }, [socket, joinedRoom, state?.gameOver, rematchRequested, showToast]);

  const appendMultiplayerMove = useCallback((entry: Omit<MoveEntry, 'moveNumber'>) => {
    const moveNumber =
      entry.player === 'you'
        ? multiplayerMoveCounterRef.current++
        : multiplayerMoveCounterRef.current;
    setMultiplayerMoveLog((prev) => [...prev, { ...entry, moveNumber }]);
  }, []);

  const openMultiplayerAnalyzer = useCallback(() => {
    const analysis = analyzeMoveLog(multiplayerMoveLog, true);
    setCurrentAnalysis(analysis);
    saveGameAnalysis('multiplayer', analysis);
    setAnalyzerOpen(true);
  }, [multiplayerMoveLog]);

  const emitDraggingState = useCallback(
    (dragging: boolean) => {
      if (draggingStateRef.current === dragging) return;
      draggingStateRef.current = dragging;
      if (!socket || !joinedRoom || !state || state.gameOver || state.handOver) return;
      if (!state.playerIds.includes(you)) return;
      socket.emit('player:dragging', joinedRoom, { dragging });
    },
    [socket, joinedRoom, state, you],
  );

  // Game actions
  const draw = useCallback(async () => {
    setActionError('');
    const boneyardLockedNow = (state?.boneyard.length ?? 0) <= 2;
    if (!socket || !joinedRoom || boneyardLockedNow || drawSequenceActive) return;
    emitDraggingState(false);
    setPendingUiAction('draw');
    const boardEnds = getBoardEnds(state?.board ?? null);
    const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMoves
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitWithAck<any>(socket, 'game:action', joinedRoom, { type: 'DRAW' });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to draw.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'draw',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(state?.board ?? null),
        boardRenderState: cloneBoardState(state?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'draw' ? null : prev));
    }
  }, [socket, joinedRoom, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast, showScoreLikeToast, drawSequenceActive]);

  const pass = useCallback(async () => {
    setActionError('');
    if (!socket || !joinedRoom || drawSequenceActive) return;
    emitDraggingState(false);
    setPendingUiAction('pass');
    const boardEnds = getBoardEnds(state?.board ?? null);
    const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
    const validMoves = legalMoves
      .filter((m) => m.type === 'play' && m.tile)
      .map((m) => toTileTuple(m.tile as Tile));
    try {
      const resp = await emitWithAck<any>(socket, 'game:action', joinedRoom, { type: 'PASS' });
      if (!resp?.ok) {
        setActionError(resp?.error ?? 'Unable to pass.');
        return;
      }
      appendMultiplayerMove({
        player: 'you',
        action: 'pass',
        boardEnds,
        handBefore,
        validMoves,
        pipDelta: 0,
        pointsScored: 0,
        boardState: snapshotBoardState(state?.board ?? null),
        boardRenderState: cloneBoardState(state?.board ?? null),
        handSnapshot: handBefore,
        engineBestMove: pickEngineBestMove(
          legalMoves
            .filter((m) => m.type === 'play' && m.tile)
            .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
          boardEnds,
          handBefore,
        ),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Action failed', 2000);
    } finally {
      setPendingUiAction((prev) => (prev === 'pass' ? null : prev));
    }
  }, [socket, joinedRoom, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast, drawSequenceActive]);

  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      if (!socket || !joinedRoom || !selectedTile) return;
      const tileToPlay = selectedTile;
      const selectedMove = legalMoves.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      emitDraggingState(false);
      setPendingUiAction('play');
      setSelectedTile(null);
      setOptimisticPlayedTile(tileToPlay);
      setDrawStepMyHand(null);
      const boardEnds = getBoardEnds(state?.board ?? null);
      const handBefore = (state?.players[you]?.hand ?? []).map(toTileTuple);
      const validMoves = legalMoves
        .filter((m) => m.type === 'play' && m.tile)
        .map((m) => toTileTuple(m.tile as Tile));
      const playedTile = toTileTuple(tileToPlay);

      try {
        const resp = await emitWithAck<any>(
          socket,
          'game:action',
          joinedRoom,
          {
            type: 'MOVE',
            move: { tile: tileToPlay, position },
          },
        );
        if (!resp?.ok) {
          setActionError(resp?.error ?? 'Unable to play tile.');
          setOptimisticPlayedTile(null);
          return;
        }
        flashLastPlayed(selectedMove?.tile ?? tileToPlay);
        appendMultiplayerMove({
          player: 'you',
          action: 'place',
          tile: playedTile,
          boardEnds,
          handBefore,
          validMoves,
          pipDelta: -(playedTile[0] + playedTile[1]),
          pointsScored: (() => {
            const possibleEnds = nextEndsForTile(playedTile, boardEnds);
            for (const ends of possibleEnds) {
              const s = ends[0] + ends[1];
              if (s > 0 && s % 5 === 0) return s / 5;
            }
            return 0;
          })(),
          boardState: snapshotBoardState(state?.board ?? null),
          boardRenderState: cloneBoardState(state?.board ?? null),
          handSnapshot: handBefore,
          engineBestMove: pickEngineBestMove(
            legalMoves
              .filter((m) => m.type === 'play' && m.tile)
              .map((m) => ({ tile: toTileTuple(m.tile as Tile), position: m.position })),
            boardEnds,
            handBefore,
          ),
        });
      } catch (e) {
        setOptimisticPlayedTile(null);
        showToast(e instanceof Error ? e.message : 'Action failed', 2000);
      } finally {
        setPendingUiAction((prev) => (prev === 'play' ? null : prev));
      }
    },
    [socket, joinedRoom, selectedTile, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast, flashLastPlayed],
  );

  // Derived state
  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const authoritativeMyHand = state?.players[you]?.hand ?? [];
  const handForRenderBase = drawSequenceActive && drawStepActorId === you
    ? (drawStepMyHand ?? authoritativeMyHand)
    : authoritativeMyHand;
  const myHand = optimisticPlayedTile
    ? handForRenderBase.filter((t) => !tileEquals(t, optimisticPlayedTile))
    : handForRenderBase;
  const opponentId = state?.playerIds.find((pid) => pid !== you) ?? null;
  const authoritativeOpponentTileCount =
    state && opponentId
      ? (state.handCounts?.[opponentId] ?? state.players[opponentId]?.hand?.length ?? 0)
      : 0;
  const opponentTileCount = drawStepOpponentHandCount ?? authoritativeOpponentTileCount;
  const myScore = state?.players[you]?.score ?? 0;
  const opponentScore = opponentId ? (state?.players[opponentId]?.score ?? 0) : 0;
  const opponent = players.find((pl) => pl.id !== you) ?? null;
  const opponentName = opponent?.username ? `@${opponent.username}` : 'Rival';
  const myName = authProfile?.username ? `@${authProfile.username}` : 'you';
  const myHandle = authProfile?.username
    ? `@${authProfile.username}`
    : authUser?.email
      ? `@${authUser.email.split('@')[0]}`
      : '@player';
  const homeInitials = useMemo(() => {
    const source = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'racehorse';
    const parts = source
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
    return initials || source.slice(0, 2).toUpperCase();
  }, [authProfile?.username, authUser?.email]);
  const homeRatingLabel = (authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : 800).toLocaleString();
  const homeFriendsOnline = 3;
  const homePlayersOnline = playersOnlineCount ?? 142;
  const homeActiveRooms = Math.max(12, Math.round(homePlayersOnline / 12));
  const homeLeaderRating = '1,820';
  const weeklyAwardRows = Array.isArray(weeklyAwards?.awards) ? weeklyAwards.awards : [];
  const weeklyLeaderHandle = useMemo(() => {
    const mostWins = weeklyAwardRows.find((entry: any) =>
      `${entry?.key ?? ''} ${entry?.title ?? ''}`.toLowerCase().includes('most wins'),
    );
    const fallback = weeklyAwardRows.find((entry: any) => Boolean(entry?.leader?.username));
    const username = mostWins?.leader?.username ?? fallback?.leader?.username ?? null;
    return username ? `@${username}` : null;
  }, [weeklyAwardRows]);
  const homeLeaderHandle = weeklyLeaderHandle ?? '@kai';
  const weeklyRank: number | null = null;
  const hasSocialProofData =
    playersOnlineCount !== null && weeklyLeaderHandle !== null && weeklyRank !== null;
  const inGame = Boolean(isConnected && joinedRoom && state);
  useRenderProfiler(inGame ? 'MultiplayerGameShell' : 'AppNonGame');
  const isSpectatingMatch = Boolean(tournamentId && joinedRoom && state && !state.playerIds.includes(you));
  const isTournamentMatch = Boolean(tournamentId || tournamentState?.status === 'running');
  const spectateRightPlayerId = isSpectatingMatch ? (state?.playerIds?.[1] ?? null) : null;
  const spectateRightPlayer = spectateRightPlayerId ? players.find((pl) => pl.id === spectateRightPlayerId) ?? null : null;
  const hudRightLabel = isSpectatingMatch
    ? (spectateRightPlayer?.username ? `@${spectateRightPlayer.username}` : 'Spectating')
    : myName;
  const hudRightScore =
    isSpectatingMatch && spectateRightPlayerId ? (state?.players[spectateRightPlayerId]?.score ?? 0) : myScore;
  const hudRightScorePulse = isSpectatingMatch && spectateRightPlayerId ? Boolean(hudScorePulse[spectateRightPlayerId]) : Boolean(hudScorePulse[you]);
  const canDrawNow = canDraw && !drawSequenceActive;
  const canPass = legalMoves.some((m) => m.type === 'pass') && !drawSequenceActive;
  const hasPlayMoves = legalMoves.some((m) => m.type === 'play');
  const boneyardCount = boneyardDisplayCount ?? state?.boneyard.length ?? 0;
  const isBoneyardLocked = boneyardCount <= 2;
  const openEndsSum = getOpenEndsSum(state?.board ?? null);
  const canUseRematch = Boolean(
    state?.gameOver && joinedRoom && !isSpectatingMatch && !isTournamentMatch && state.playerIds.includes(you),
  );
  const rematchWaitingText = rematchRequested
    ? (() => {
        const readyNames = rematchReadyIds
          .map((pid) => {
            if (pid === you) return 'You';
            const player = players.find((pl) => pl.id === pid);
            return player?.username ? `@${player.username}` : 'Opponent';
          })
          .join(', ');
        return readyNames ? `Waiting for opponent... Ready: ${readyNames}` : 'Waiting for opponent...';
      })()
    : undefined;
  const multiplayerRatingEligible = Boolean(
    !isTournamentMatch &&
    !isSpectatingMatch &&
    authUser &&
    players.length === 2 &&
    players.every((p) => Boolean(p.userId)),
  );
  const multiplayerRatingSummary =
    multiplayerRatingEligible && state?.gameOver
      ? {
          pending: multiplayerRatingPending,
          delta:
            multiplayerRatingBaseline != null && authProfile?.glicko_rating != null
              ? Math.round(Number(authProfile.glicko_rating) - multiplayerRatingBaseline)
              : null,
          newRating:
            authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null,
        }
      : null;
  const boardLegalMoves = useMemo(
    () => (isMyTurn ? legalMoves : EMPTY_MOVES),
    [isMyTurn, legalMoves],
  );
  const boardSelectedTile = useMemo(
    () => (isMyTurn ? selectedTile : null),
    [isMyTurn, selectedTile],
  );
  const boardShowOpenEndGlow = useMemo(
    () => Boolean(isMyTurn && opponentDragging),
    [isMyTurn, opponentDragging],
  );
  const handSelectedTile = useMemo(
    () => (isMyTurn ? selectedTile : null),
    [isMyTurn, selectedTile],
  );

  const handleTileTap = useCallback(
    (tile: Tile) => {
      if (!isMyTurn || state?.handOver || state?.gameOver) return;
      if (selectedTile && tileEquals(selectedTile, tile)) {
        setSelectedTile(null);
        emitDraggingState(false);
        return;
      }
      setSelectedTile(tile);
      emitDraggingState(true);
    },
    [isMyTurn, state?.handOver, state?.gameOver, selectedTile, emitDraggingState],
  );

  useEffect(() => {
    emitDraggingState(Boolean(selectedTile));
  }, [selectedTile, emitDraggingState]);

  useEffect(() => {
    setRematchRequested(false);
    setRematchReadyIds([]);
    setMultiplayerMoveLog([]);
    multiplayerMoveCounterRef.current = 1;
    previousStateForAnalysisRef.current = null;
    setOpponentDragging(false);
    draggingStateRef.current = false;
    setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
    setMultiplayerRatingPending(false);
    multiplayerRatingRefreshKeyRef.current = '';
    previousMultiplayerGameOverRef.current = false;
  }, [joinedRoom]);

  useEffect(() => {
    if (!joinedRoom || state?.gameOver) return;
    if (multiplayerRatingBaseline != null) return;
    if (authProfile?.glicko_rating == null) return;
    setMultiplayerRatingBaseline(Number(authProfile.glicko_rating));
  }, [authProfile?.glicko_rating, joinedRoom, multiplayerRatingBaseline, state?.gameOver]);

  useEffect(() => {
    const wasGameOver = previousMultiplayerGameOverRef.current;
    const isGameOver = Boolean(state?.gameOver);
    if (wasGameOver && !isGameOver) {
      setMultiplayerRatingBaseline(authProfile?.glicko_rating != null ? Number(authProfile.glicko_rating) : null);
      setMultiplayerRatingPending(false);
      multiplayerRatingRefreshKeyRef.current = '';
    }
    previousMultiplayerGameOverRef.current = isGameOver;
  }, [authProfile?.glicko_rating, state?.gameOver]);

  useEffect(() => {
    if (!state?.gameOver || !joinedRoom || !authUser || isSpectatingMatch || isTournamentMatch) return;
    const ratingEligible = players.length === 2 && players.every((p) => Boolean(p.userId));
    if (!ratingEligible) return;
    const key = `${joinedRoom}:${state.handNumber}:${state.players[you]?.score ?? 0}:${state.winnerId ?? ''}`;
    if (multiplayerRatingRefreshKeyRef.current === key) return;
    multiplayerRatingRefreshKeyRef.current = key;
    setMultiplayerRatingPending(true);
    void Promise.resolve(refreshAuthProfile())
      .catch((err) => {
        console.warn('[Multiplayer Rating] profile refresh failed:', err);
      })
      .finally(() => {
        setMultiplayerRatingPending(false);
      });
  }, [
    authUser,
    isSpectatingMatch,
    isTournamentMatch,
    joinedRoom,
    players,
    refreshAuthProfile,
    state,
    you,
  ]);

  useEffect(() => {
    if (!isMyTurn || state?.gameOver || state?.handOver) {
      emitDraggingState(false);
      setSelectedTile(null);
    }
  }, [isMyTurn, state?.gameOver, state?.handOver, emitDraggingState]);

  useEffect(() => {
    const updateHandTileSize = () => {
      const tileCount = Math.max(1, myHand.length);
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
  }, [myHand.length]);

  useEffect(() => {
    if (!inGame) {
      prevMyHandLenRef.current = 0;
      setDrawPulseIndex(null);
      return;
    }

    if (myHand.length > prevMyHandLenRef.current) {
      setDrawPulseIndex(myHand.length - 1);
      const timer = setTimeout(() => setDrawPulseIndex(null), 360);
      prevMyHandLenRef.current = myHand.length;
      return () => clearTimeout(timer);
    }

    prevMyHandLenRef.current = myHand.length;
    setDrawPulseIndex(null);
  }, [inGame, myHand.length]);

  useEffect(() => {
    if (!inGame || !state || state.gameOver || !state.handOver) return;
    if (handRevealShownRef.current === state.handNumber) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    handRevealShownRef.current = state.handNumber;
    const tid = window.setTimeout(() => {
      setHandReveal({
        handNumber: state.handNumber,
        yourRemainingTiles: state.players[you]?.hand ?? [],
        opponentRemainingTiles: opponentIdFromState
          ? (state.players[opponentIdFromState]?.hand ?? [])
          : [],
        pointsAwarded: { you: 0, opponent: 0 },
      });
    }, 1400);
    return () => window.clearTimeout(tid);
  }, [inGame, state, you]);

  useEffect(() => {
    if (!handReveal || !state || state.gameOver || !state.handOver) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    const nextYourRemaining = state.players[you]?.hand ?? [];
    const nextOpponentRemaining = opponentIdFromState
      ? (state.players[opponentIdFromState]?.hand ?? [])
      : [];
    if (
      tileListEquals(handReveal.yourRemainingTiles, nextYourRemaining) &&
      tileListEquals(handReveal.opponentRemainingTiles, nextOpponentRemaining)
    ) {
      return;
    }
    setHandReveal((prev) =>
      prev
        ? {
            ...prev,
            yourRemainingTiles: nextYourRemaining,
            opponentRemainingTiles: nextOpponentRemaining,
          }
        : prev,
    );
  }, [handReveal, state, you]);


  const continueAfterHandReveal = useCallback(() => {
    if (socket && joinedRoom) {
      emitWithAck(socket, 'hand:ready', joinedRoom).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[hand:ready] failed:', error instanceof Error ? error.message : error);
        }
      });
    }
    setHandReveal(null);
  }, [socket, joinedRoom]);

  // Recover lost hand:ready on reconnect — if the server says the hand is over but
  // we're not in a reveal window, the hand:ready was lost during disconnect. Re-emit it.
  const handReadyRecoveryRef = useRef(false);
  useEffect(() => {
    const needsReady =
      Boolean(state?.handOver) && !state?.gameOver && !handReveal && Boolean(joinedRoom) && socket?.connected;
    if (!needsReady) {
      handReadyRecoveryRef.current = false;
      return;
    }
    if (handReadyRecoveryRef.current) return;
    handReadyRecoveryRef.current = true;
    if (import.meta.env.DEV) {
      console.log('[hand:ready] recovering lost hand:ready signal after reconnect');
    }
    emitWithAck(socket!, 'hand:ready', joinedRoom!).catch((error) => {
      handReadyRecoveryRef.current = false;
      showToast('Could not signal hand ready. Reconnecting…', 2500);
      if (import.meta.env.DEV) {
        console.warn('[hand:ready] recovery failed:', error instanceof Error ? error.message : error);
      }
    });
  }, [state?.handOver, state?.gameOver, handReveal, joinedRoom, socket]);

  useEffect(() => {
    if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
    if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);

    if (!handReveal || state?.gameOver) {
      setHandRevealAutoProgress(1);
      return;
    }

    const durationMs = 4000;
    const start = Date.now();
    setHandRevealAutoProgress(1);

    handRevealAutoIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const nextProgress = Math.max(0, 1 - elapsed / durationMs);
      setHandRevealAutoProgress(nextProgress);
    }, 50);

    handRevealAutoTimeoutRef.current = setTimeout(() => {
      continueAfterHandReveal();
    }, durationMs);

    return () => {
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
    };
  }, [handReveal, state?.gameOver, continueAfterHandReveal]);

  useEffect(() => {
    const handActive = Boolean(state) && !state?.handOver && !state?.gameOver;
    if (!handActive || !isMyTurn || hasPlayMoves || drawSequenceActive) {
      autoTurnActionKeyRef.current = '';
      return;
    }

    const autoAction: 'draw' | 'pass' | null = canDrawNow ? 'draw' : canPass ? 'pass' : null;
    if (!autoAction) return;

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHand.length}:${boneyardCount}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === 'draw') {
      draw();
    } else {
      pass();
    }
  }, [state, isMyTurn, hasPlayMoves, canDrawNow, canPass, myHand.length, boneyardCount, draw, pass, drawSequenceActive]);

  useEffect(() => {
    if (!state) {
      previousStateForAnalysisRef.current = null;
      return;
    }
    const prev = previousStateForAnalysisRef.current;
    previousStateForAnalysisRef.current = state;
    if (!prev) return;
    if (state.handNumber !== prev.handNumber) return;
    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId || actorId === you) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    let action: MoveEntry['action'] = 'pass';
    if (nextBoardCount > prevBoardCount) action = 'place';
    else if ((state.boneyard?.length ?? 0) < (prev.boneyard?.length ?? 0)) action = 'draw';
    if (action === 'place') {
      flashLastPlayed(findPlacedTile(prev.board, state.board));
    }

    appendMultiplayerMove({
      player: 'opponent',
      action,
      boardEnds: getBoardEnds(prev.board),
      handBefore: [],
      validMoves: [],
      pipDelta: 0,
      pointsScored: 0,
      boardState: snapshotBoardState(prev.board),
      boardRenderState: cloneBoardState(prev.board),
      handSnapshot: (prev.players[you]?.hand ?? []).map(toTileTuple),
      engineBestMove: null,
    });
  }, [state, you, appendMultiplayerMove, flashLastPlayed]);

  // Pulse the opp-tile card whenever the count changes
  useEffect(() => {
    if (prevOppCountRef.current !== null && prevOppCountRef.current !== opponentTileCount) {
      setOppTilePulse(true);
      const t = setTimeout(() => setOppTilePulse(false), 250);
      return () => clearTimeout(t);
    }
    prevOppCountRef.current = opponentTileCount;
  }, [opponentTileCount]);

  // Pulse score cards on scoring events.
  useEffect(() => {
    if (!state) return;

    const nextScores: Record<string, number> = {};
    const nextPulse: Record<string, boolean> = {};
    let changed = false;

    for (const pid of state.playerIds) {
      const score = state.players[pid]?.score ?? 0;
      const prevScore = prevHudScoresRef.current[pid];
      nextScores[pid] = score;
      if (prevScore !== undefined && prevScore !== score) {
        nextPulse[pid] = true;
        changed = true;
        const delta = score - prevScore;
        if (delta > 0 && !state.handOver && !state.gameOver) {
          playScoreSound(delta, isMutedRef.current);
          if (pid === you) {
            showScoreToast('you', delta, 'You');
          } else {
            const playerName =
              players.find((p) => p.id === pid)?.username?.trim() || opponentName || 'Opponent';
            showScoreToast('opp', delta, playerName);
          }
        }
      }
    }

    prevHudScoresRef.current = nextScores;
    if (!changed) return;

    setHudScorePulse(nextPulse);
    const timeout = setTimeout(() => setHudScorePulse({}), 260);
    return () => clearTimeout(timeout);
  }, [state, you, players, opponentName, showScoreToast]);

  // Track turn changes for UI state sync.
  useEffect(() => {
    if (!inGame || !state) {
      prevBoardTileCountRef.current = 0;
      prevTurnIdRef.current = null;
      return;
    }

    const currentTileCount = getBoardTileCount(state.board);
    prevBoardTileCountRef.current = currentTileCount;

    const activePlayerId = state.playerIds[state.currentPlayerIndex] ?? null;
    prevTurnIdRef.current = activePlayerId;
  }, [inGame, state]);

  useEffect(() => {
    const finalState = state;
    const isGameOver = Boolean(finalState?.gameOver);
    if (!isGameOver) {
      prevGameOverRef.current = false;
      matchRecordKeyRef.current = '';
      return;
    }
    if (!finalState) return;
    if (prevGameOverRef.current) return;
    prevGameOverRef.current = true;
    if (!joinedRoom) return;

    const winnerSocketId = finalState?.winnerId ?? null;
    if (!winnerSocketId) return;
    if (winnerSocketId === you) {
      playMatchWinSound(isMutedRef.current);
    } else {
      playMatchLoseSound(isMutedRef.current);
    }
    if (winnerSocketId === you) {
      const canvas = confettiCanvasRef.current;
      if (canvas) {
        void import('canvas-confetti').then(({ default: confetti }) => {
          const myConfetti = confetti.create(canvas, { resize: true, useWorker: true });
          const colors = ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff', '#f59e0b'];

          myConfetti({
            particleCount: 120,
            spread: 100,
            origin: { x: 0.5, y: 0.4 },
            colors,
            scalar: 1.3,
          });
          setTimeout(
            () =>
              myConfetti({
                particleCount: 80,
                spread: 120,
                origin: { x: 0.2, y: 0.5 },
                colors,
                scalar: 1.1,
              }),
            200,
          );
          setTimeout(
            () =>
              myConfetti({
                particleCount: 80,
                spread: 120,
                origin: { x: 0.8, y: 0.5 },
                colors,
                scalar: 1.1,
              }),
            400,
          );
        }).catch(() => {
          // Confetti is celebratory only; skip if the chunk fails to load.
        });
      }
    }
    const loserSocketId = finalState.playerIds.find((pid) => pid !== winnerSocketId) ?? null;
    if (!loserSocketId) return;

    const key = `${joinedRoom}:${winnerSocketId}:${loserSocketId}`;
    if (matchRecordKeyRef.current === key) return;
    matchRecordKeyRef.current = key;

    if (!supabaseEnabled || !authUser) return;

    const bySocketId = new Map(players.map((p) => [p.id, p.userId ?? null] as const));
    let winnerUserId = bySocketId.get(winnerSocketId) ?? null;
    let loserUserId = bySocketId.get(loserSocketId) ?? null;

    // Always ensure the authenticated user's ID is set
    // correctly - never leave both sides unidentified.
    if (winnerSocketId === you) {
      winnerUserId = authUser.id;
    } else if (loserSocketId === you) {
      loserUserId = authUser.id;
    }

    // If we still can't place the current user as a
    // participant, skip recording - better no record
    // than a corrupted one.
    if (winnerUserId !== authUser.id && loserUserId !== authUser.id) return;

    const winnerScore = finalState.players[winnerSocketId]?.score ?? null;
    const loserScore = finalState.players[loserSocketId]?.score ?? null;
    const matchAnalysis = analyzeMoveLog(multiplayerMoveLog, true);
    const avgMoveQuality =
      matchAnalysis.analyzedMoves.length > 0 && matchAnalysis.accuracy > 0
        ? matchAnalysis.accuracy
        : undefined;

    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.log('[StatsDebug] about to record match', {
        joinedRoom,
        you,
        winnerSocketId,
        loserSocketId,
        winnerUserId,
        loserUserId,
        winnerScore,
        loserScore,
      });
    }

    void recordMatchResult({
      mode: 'online',
      opponentType: 'online',
      winnerUserId,
        loserUserId,
        winnerScore,
        loserScore,
        avgMoveQuality,
        moveCount: null,
        roomCode: joinedRoom,
        metadata: { roomCode: joinedRoom, winnerSocketId, loserSocketId },
    }).then(({ error }) => {
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.log('[StatsDebug] recordMatchResult response', { error });
      }

      if (error && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.error('[Stats] recordMatchResult failed:', error);
      }
    });
  }, [state, joinedRoom, players, supabaseEnabled, authUser, you, multiplayerMoveLog]);

  // ─── Render ───────────────────────────────────────────────
  const appRootClassName = 'app large-mode';

  if (appMode === 'noBrainer') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading No Brainer Lab…" />}>
          <NoBrainerLabScreen
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'learn' && LEARN_MODE_VISIBLE) {
    if (selectedLearnLessonId) {
      return (
        <div className={appRootClassName}>
          <Suspense fallback={<ScreenLoader label="Loading Lesson…" />}>
            <LearnPlayer
              lessonId={selectedLearnLessonId}
              onExit={() => {
                setSelectedLearnLessonId(null);
              }}
            />
          </Suspense>
        </div>
      );
    }
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Learn Mode…" />}>
          <LearnHome
            onBack={() => setAppMode('home')}
            isAdmin={isAdmin}
            onStartGuidedGame={() => {
              setIsGuidedMode(true);
              // Use elite Fritz if a frozen lesson exists (authored vs Elite Fritz)
              const frozen = loadFrozenLesson();
              setBotFritzTier(frozen ? 'elite' : 'rookie');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartGuidedAuthoring={() => {
              setIsAuthoringMode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onFreezeLesson={() => {
              const session = loadAuthoringSession();
              if (session) {
                saveFrozenLesson(session);
              }
            }}
            onStartGuidedV2Game={() => {
              setIsGuidedV2Mode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
            onStartAuthoringV2={() => {
              setIsAuthoringV2Mode(true);
              setBotFritzTier('elite');
              setBotDealSize(7);
              setAppMode('bot');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'botSetup') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Setup…" />}>
          <BotSetupScreen
            dealSize={botDealSize}
            fritzTier={botFritzTier}
            onDealSizeChange={setBotDealSize}
            onFritzTierChange={setBotFritzTier}
            onStart={() => setAppMode('bot')}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'bot') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Fritz Match…" />}>
          <BotMatchScreen
            onBack={() => {
              setIsGuidedMode(false);
              setIsAuthoringMode(false);
              setIsAuthoringV2Mode(false);
              setIsGuidedV2Mode(false);
              setAppMode('home');
            }}
            dealSize={botDealSize}
            fritzTier={botFritzTier}
            isGuidedMode={isGuidedMode}
            isAuthoringMode={isAuthoringMode}
            isAuthoringV2Mode={isAuthoringV2Mode}
            isGuidedV2Mode={isGuidedV2Mode}
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghostSetup') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Setup…" />}>
          <GhostSetupScreen
            userId={authUser?.id ?? null}
            fritzGamesPlayed={authProfile?.ranked_games_played ?? 0}
            onBack={() => setAppMode('home')}
            onStart={(summary, opponentName, opponentUserId) => {
              setGhostProfile(summary);
              setGhostOpponentName(opponentName);
              setGhostOpponentUserId(opponentUserId);
              setAppMode('ghost');
            }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ghost') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Ghost Match…" />}>
          <BotMatchScreen
            onBack={() => setAppMode('home')}
            dealSize={botDealSize}
            mode="ghost"
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            opponentName={ghostOpponentName}
            opponentUserId={ghostOpponentUserId}
            currentGlickoRating={authProfile?.glicko_rating ?? null}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'daily') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle…" />}>
          <DailyPuzzleScreen
            user={authUser}
            profile={authProfile}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'dailyFritz') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Daily Fritz…" />}>
          <DailyFritzScreen
            user={authUser}
            profile={authProfile}
            ghostProfile={ghostProfile}
            onGhostProfileChange={setGhostProfile}
            onProfileRefresh={refreshAuthProfile}
            onProfilePatch={applyProfilePatch}
            onOpenAuth={() => setAuthModalOpen(true)}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'league') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading League…" />}>
          <LeagueScreen
            user={authUser}
            profile={authProfile}
            onBack={() => setAppMode('home')}
            onOpenLiveMatch={openLeagueLiveRoom}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'ratingHistory') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Rating History…" />}>
          <RatingHistoryPage
            userId={authUser?.id ?? null}
            username={authProfile?.username ?? null}
            onBack={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'singlePlayerHub') {
    return (
      <div className={appRootClassName}>
        <LayoutScreen
          className="screen lobby-screen mode-home-screen mode-subpage-screen"
          title="Single Player Modes"
          subtitle="Choose a mode to play solo or against a bot."
          contentClassName="screen-shell"
        >
          <div className="mode-hub" style={{ width: '100%' }}>
            <div className="mode-hub-grid">
              <section className="mode-hub-middle" aria-label="Single player modes">
                <p className="mode-section-label mode-section-label-practice">Choose Mode</p>
                <div className="mode-hub-middle-cards single-player-hub-cards">
                <button
                  className="mode-option mode-option-secondary mode-accent-bot mode-card-bot"
                  onClick={() => setAppMode('botSetup')}
                >
                  <span className="mode-option-title">Play vs Fritz</span>
                  <span className="mode-option-meta">Test yourself against the toughest opponent in the room</span>
                </button>
                <button
                  className="mode-option mode-option-secondary mode-accent-ghost mode-card-ghost"
                  onClick={() => setAppMode('ghostSetup')}
                >
                  <span className="mode-option-title">Ghost Mode</span>
                  <span className="mode-option-meta">
                    Play against a ghost trained on your own playstyle
                  </span>
                  </button>

                <button
                  className="mode-option mode-option-secondary mode-accent-league mode-card-league"
                  onClick={() => setAppMode('league')}
                >
                  <span className="mode-option-title">
                    
                    Your League
                  </span>
                  <span className="mode-option-meta">
                    One match a day. Climb the table, survive promotion and relegation.
                  </span>
                </button>
                <button
                  className="mode-option mode-option-secondary mode-accent-bot mode-card-practice"
                  onClick={() => setAppMode('noBrainer')}
                >
                  <span className="mode-option-title">No Brainer Lab</span>
                  <span className="mode-option-meta">Practice one turn clear runs with curated hands</span>
                </button>
                </div>
              </section>
            </div>
            <button className="mode-inline-btn single-player-hub-back" onClick={() => setAppMode('home')}>
              Back to Home
            </button>
          </div>
        </LayoutScreen>
      </div>
    );
    }

    if (appMode === 'tournament') {
    const players: TournamentPlayer[] = Array.isArray(tournamentState?.players)
      ? tournamentState.players.filter(
          (p: TournamentPlayer) =>
            !(p.isBot || p.socketId?.startsWith('bot:fritz:') || p.username?.startsWith('Fritz')),
        )
      : [];
    const standingsRaw = (tournamentState as any)?.standings;
    const standings = Array.isArray(standingsRaw)
      ? standingsRaw
      : standingsRaw && typeof standingsRaw === 'object'
        ? Object.values(standingsRaw)
        : [];
    const matchesRaw = (tournamentState as any)?.matches;
    const matches = Array.isArray(matchesRaw) ? matchesRaw : [];
    const activeRoom = tournamentActiveRoom ?? tournamentState?.activeRoomCode ?? null;
    const activeMatchId = tournamentState?.activeMatchId ?? null;
    const isHost = Boolean(
      socket?.id &&
        ((tournamentState?.hostSocketId && tournamentState.hostSocketId === socket.id) ||
          (tournamentState?.hostId && tournamentState.hostId === socket.id)),
    );

    const mySocketId = socket?.id ?? null;
    const nameFor = (sid: string) =>
      (players.find((p: any) => p.socketId === sid)?.username as string | undefined) ?? 'Player';

    const activeMatch =
      (activeMatchId ? matches.find((m: any) => m.id === activeMatchId) : null) ??
      matches.find((m: any) => m.status === 'active') ??
      null;

    const doneCount = matches.filter((m: any) => m.status === 'done').length;
    const totalMatches = matches.length;
    const hasHubRightColumn = matches.length > 0 || standings.length > 0;

    const youArePlaying = Boolean(
      activeMatch && mySocketId && (activeMatch.a === mySocketId || activeMatch.b === mySocketId),
    );

    const nextForYou =
      mySocketId
        ? matches.find(
            (m: any) =>
              m.status !== 'done' &&
              (m.a === mySocketId || m.b === mySocketId) &&
              (!activeMatch || m.id !== activeMatch.id),
          ) ?? null
        : null;

    const yourStatus =
      tournamentState?.status === 'complete'
        ? 'Tournament complete'
        : youArePlaying
          ? 'Playing now'
          : nextForYou
            ? 'Waiting for your next match'
            : tournamentState?.status === 'running'
              ? 'Waiting for assignment'
              : 'Lobby';
    const showLobbySetup = !tournamentId || tournamentState?.status === 'lobby';

    const createLobby = () => {
      if (!socket) {
        connect();
        return setError('Connecting to server…');
      }
      if (!socket.connected) {
        connect();
        setError('Connecting to server…');
        const retry = () => {
          socket.off('connect', retry);
          socket.emit(
            'tournament:create',
            { username: authProfile?.username ?? 'Guest', userId: authUser?.id ?? null },
            (resp: any) => {
              if (!resp?.ok) return setError(resp?.error ? `Create failed: ${resp.error}` : 'Failed to create lobby.');
              setTournamentId(resp.id);
              setTournamentCode(resp.lobbyCode);
              setError('');
            },
          );
        };
        socket.on('connect', retry);
        return;
      }
      socket.emit(
        'tournament:create',
        { username: authProfile?.username ?? 'Guest', userId: authUser?.id ?? null },
        (resp: any) => {
          if (!resp?.ok) return setError(resp?.error ? `Create failed: ${resp.error}` : 'Failed to create lobby.');
          setTournamentId(resp.id);
          setTournamentCode(resp.lobbyCode);
          setError('');
        },
      );
    };

    const joinLobby = () => {
      if (!socket?.connected) {
        connect();
        return setError('Connecting to server…');
      }
      const code = tournamentCode.trim().toUpperCase();
      if (!code) return setError('Enter a lobby code.');
      socket.emit(
        'tournament:join',
        code,
        { username: authProfile?.username ?? 'Guest', userId: authUser?.id ?? null },
        (resp: any) => {
          if (!resp?.ok) {
            return setError(resp?.error === 'already_started' ? 'Tournament already started.' : 'Join failed.');
          }
          setTournamentId(resp.id);
          setTournamentCode(resp.lobbyCode);
          setError('');
        },
      );
    };

    const start = () => {
      if (!socket?.connected) {
        connect();
        return setError('Connecting to server…');
      }
      socket.emit('tournament:start', (resp: any) => {
        if (!resp?.ok) {
          if (resp?.error === 'need_2') return setError('Need at least 2 players.');
          if (resp?.error === 'need_4') return setError('Need 4+ players.');
          return setError('Start failed.');
        }
        setError('');
      });
    };

    const spectate = () => {
      if (!socket?.connected) {
        connect();
        return setError('Connecting to server…');
      }
      if (!activeRoom) return setError('No active match yet.');
      const code = String(activeRoom).trim().toUpperCase();
      socket.emit(
        'room:spectate',
        code,
        {
          username: authProfile?.username ?? 'Guest',
          userId: authUser?.id ?? null,
        },
        (resp: any) => {
          if (!resp?.ok) return setError('Spectate failed.');
          setJoinedRoom(code);
          setRoomCode(code);
          setAppMode('multiplayer');
          setError('');
        },
      );
    };

    return (
      <LayoutScreen
        className={`screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-tournament tournament-screen ${tournamentState?.status === 'running' ? 'tournament-screen-running' : ''}`}
        title={tournamentId ? 'Tournament Hub' : 'Create or Join a Lobby'}
        subtitle={
          tournamentId
            ? 'Finish your match, then wait here for the next round. Watch live games and track the standings.'
            : 'Create a new lobby or enter a code to join your friends instantly.'
        }
        contentClassName="multiplayer-menu-card screen-shell"
      >
        <div className="tournament-top-right">
          <button className="mode-option tournament-card tournament-disconnect-muted tournament-disconnect-corner" onClick={() => disconnect('user disconnect')}>
            <span className="mode-option-title">Disconnect</span>
          </button>
        </div>

        {error && (
          <div className="error-banner">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        <div className="mode-actions tournament-mode-actions">
          {!tournamentId && (
            <div className="tournament-layout-2col">
              <div className="tournament-col-left">
                <button className="mode-option tournament-card tournament-card-create is-selected" onClick={createLobby}>
                  <span className="mode-option-title">Create Lobby</span>
                  <span className="mode-option-meta">Start a tournament lobby and share the code</span>
                </button>
              </div>
              <div className="tournament-col-right">
                <div className="mode-option tournament-card tournament-card-join">
                  <span className="mode-option-title">Join Lobby</span>
                  <span className="mode-option-meta">Enter a lobby code to join an existing tournament</span>
                  <div className="mode-join-row tournament-join-row">
                    <input
                      className="mode-join-input tournament-join-input"
                      type="text"
                      placeholder="Lobby Code"
                      value={tournamentCode}
                      onChange={(e) => setTournamentCode(e.target.value.toUpperCase())}
                      maxLength={6}
                    />
                    <button className="mode-inline-btn tournament-join-btn" onClick={joinLobby} disabled={!tournamentCode.trim()}>
                      Join Lobby
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tournamentId && tournamentState?.status !== 'running' && (
            <div className="tournament-layout-2col">
              <div className="tournament-col-left">
                <div className="mode-option tournament-card tournament-card-code">
                  <span className="mode-option-title">Lobby Code</span>
                  <span className="mode-option-meta">Share this code to invite players</span>
                  <div className="tournament-code-row">
                    <div className="tournament-code-value">{tournamentCode || '------'}</div>
                    <button
                      className="btn text compact tournament-copy-btn"
                      onClick={() => tournamentCode && navigator.clipboard?.writeText(String(tournamentCode))}
                      title="Copy lobby code"
                      disabled={!tournamentCode}
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="mode-option tournament-card tournament-card-players">
                  <span className="mode-option-title">Players</span>
                  <span className="mode-option-meta">{players.length}/4 in lobby</span>
                  <div className="tournament-inner-list">
                    {players.map((p) => {
                      return (
                        <div key={p.socketId} className="tournament-inner-row tournament-standings-row">
                          <div className="tournament-row-main">
                            <span className="tournament-row-name">{p.username ?? 'Player'}</span>
                            {mySocketId && p.socketId === mySocketId && <span className="tournament-you-badge">You</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="tournament-col-right">
                <div className="mode-option tournament-card tournament-card-join">
                  <span className="mode-option-title">Join Lobby</span>
                  <span className="mode-option-meta">Enter a lobby code to join an existing tournament</span>
                  <div className="mode-join-row tournament-join-row">
                    <input
                      className="mode-join-input tournament-join-input"
                      type="text"
                      placeholder="Lobby Code"
                      value={tournamentCode}
                      onChange={(e) => setTournamentCode(e.target.value.toUpperCase())}
                      maxLength={6}
                    />
                    <button className="mode-inline-btn tournament-join-btn" onClick={joinLobby} disabled={!tournamentCode.trim()}>
                      Join Lobby
                    </button>
                  </div>
                </div>

                {isHost && (
                  <button className="mode-option tournament-card tournament-card-start is-selected" onClick={start} disabled={players.length < 2}>
                    <span className="mode-option-title">Start Tournament</span>
                    <span className="mode-option-meta">
                      {players.length < 2 ? 'Need at least 2 players to start' : 'Generate schedule and begin first match'}
                    </span>
                  </button>
                )}

                <div className="mode-option tournament-card tournament-card-status">
                  <span className="mode-option-title">Status</span>
                  <span className="mode-option-meta">
                    {yourStatus}
                    {totalMatches ? ` • ${doneCount}/${totalMatches} complete` : ''}
                  </span>
                  <div className="tournament-status-row">
                    <span className="tournament-status-key">Now Playing</span>
                    <span className="tournament-status-value">
                      {activeMatch ? `${nameFor(activeMatch.a)} vs ${nameFor(activeMatch.b)}` : 'Waiting…'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tournamentId && tournamentState?.status === 'running' && (
            <div className="tournament-layout-2col">
              <div className="tournament-col-left">
                <div className="mode-option tournament-card tournament-card-standings">
                  <span className="mode-option-title">Standings</span>
                  <span className="mode-option-meta">Wins · point diff</span>
                  <div className="tournament-inner-list">
                    {standings.map((st: any, idx: number) => {
                      const diff = (st.pointsFor ?? 0) - (st.pointsAgainst ?? 0);
                      const me = Boolean(mySocketId && st.socketId === mySocketId);
                      return (
                        <div key={st.socketId} className={`tournament-inner-row tournament-standings-row ${me ? 'is-you' : ''}`}>
                          <div className="tournament-row-main">
                            <span className="tournament-row-rank">{idx + 1}</span>
                            <span className="tournament-row-name">{st.username ?? 'Player'}</span>
                            {me && <span className="tournament-you-badge">You</span>}
                          </div>
                          <span className="tournament-row-score">
                            {st.wins ?? 0}W · {diff >= 0 ? '+' : ''}{diff}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mode-option tournament-card tournament-card-bracket">
                  <span className="mode-option-title">Bracket</span>
                  <span className="mode-option-meta">Round robin schedule</span>
                  <div className="tournament-inner-list">
                    {matches.map((m: any, i: number) => {
                      const isActive = Boolean(activeMatch && m.id === activeMatch.id);
                      const label = m.status === 'active' ? 'Playing' : m.status === 'done' ? 'Done' : 'Queued';
                      return (
                        <div key={m.id} className={`tournament-inner-row tournament-bracket-row ${isActive ? 'is-active' : ''}`}>
                          <span className="tournament-row-index">Match {i + 1}</span>
                          <span className="tournament-row-players">{nameFor(m.a)} vs {nameFor(m.b)}</span>
                          <span className={`tournament-row-status tournament-row-status-badge ${m.status === 'active' ? 'is-playing' : ''}`}>
                            {label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="tournament-col-right">
                <div className="mode-option tournament-card tournament-card-code">
                  <span className="mode-option-title">Lobby Code</span>
                  <span className="mode-option-meta">Share this code to invite players</span>
                  <div className="tournament-code-row">
                    <div className="tournament-code-value">{tournamentCode || '------'}</div>
                    <button
                      className="btn text compact tournament-copy-btn"
                      onClick={() => tournamentCode && navigator.clipboard?.writeText(String(tournamentCode))}
                      title="Copy lobby code"
                      disabled={!tournamentCode}
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="mode-option tournament-card tournament-card-status">
                  <span className="mode-option-title">Status</span>
                  <span className="mode-option-meta">{doneCount} / {totalMatches || 0} complete</span>
                  <div className="tournament-progress">
                    <div
                      className="tournament-progress-fill"
                      style={{ width: `${totalMatches ? Math.round((doneCount / totalMatches) * 100) : 0}%` }}
                    />
                  </div>
                  <div className="tournament-status-row">
                    <span className="tournament-status-key">Now Playing</span>
                    <span className="tournament-status-value">
                      {activeMatch ? `${nameFor(activeMatch.a)} vs ${nameFor(activeMatch.b)}` : 'Waiting…'}
                    </span>
                  </div>
                  <div className="tournament-status-row">
                    <span className="tournament-status-key">Up Next</span>
                    <span className="tournament-status-value">
                      {nextForYou ? (nextForYou.a === mySocketId ? nameFor(nextForYou.b) : nameFor(nextForYou.a)) : 'Waiting…'}
                    </span>
                  </div>
                  {activeRoom && !youArePlaying && (
                    <button className="tournament-status-link" onClick={spectate} disabled={!activeRoom}>
                      Watch match
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      </LayoutScreen>
    );
  }



  const friendInvitePopup = friendInvite ? (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 2000,
        background: 'linear-gradient(170deg, rgba(18,26,39,0.96), rgba(9,15,26,0.98))',
        border: '1px solid rgba(236,252,245,0.2)',
        borderRadius: 14,
        padding: '16px 20px',
        color: 'rgba(235,245,242,0.96)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        display: 'grid',
        gap: 10,
        minWidth: 280,
      }}
    >
      <p style={{ margin: 0 }}>
        ⚡ <strong>@{friendInvite.fromUsername}</strong> invited you to a game!
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="mode-inline-btn"
          onClick={() => {
            void acceptFriendInvite();
          }}
          disabled={pendingUiAction === 'join'}
        >
          {pendingUiAction === 'join' ? 'Joining…' : 'Join'}
        </button>
        {friendInvite.inviteUrl && (
          <button
            className="mode-inline-btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(friendInvite.inviteUrl);
                showToast('Invite link copied.', 1200);
              } catch {
                showToast('Could not copy invite link.', 1200);
              }
            }}
          >
            Copy Link
          </button>
        )}
        <button className="mode-inline-btn" onClick={() => setFriendInvite(null)}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  const dismissWelcome = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('hasSeenWelcome', 'true');
    }
    setWelcomeOpen(false);
  };
  const welcomeModal =
    appMode === 'home' && welcomeOpen ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Racehorse Dominoes"
        onClick={dismissWelcome}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1600,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(4px)',
          display: 'grid',
          placeItems: 'center',
          padding: 12,
        }}
      >
        <div
          className="card welcome-modal-card"
          onClick={(e) => e.stopPropagation()}
          style={{ textAlign: 'left' }}
        >
          <h3 className="welcome-modal-title" style={{ margin: 0, lineHeight: 1.2 }}>
            How to Play
          </h3>
          <p className="welcome-modal-subtitle">
            Quick guide to each game mode.
          </p>
          <div className="welcome-mode-list">
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#38bdf8' }} aria-hidden="true" />
                Multiplayer Online
              </div>
              <div className="welcome-mode-desc">Play live 1v1 against a friend with a room code</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#e05c6a' }} aria-hidden="true" />
                Tournament Mode
              </div>
              <div className="welcome-mode-desc">Round robin (4+ players), matches to 30, play everyone once</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#f59e0b' }} aria-hidden="true" />
                Daily Puzzle
              </div>
              <div className="welcome-mode-desc">One puzzle per day, compete on the leaderboard</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#60a5fa' }} aria-hidden="true" />
                vs Bot
              </div>
              <div className="welcome-mode-desc">Practice against an AI opponent</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#a78bfa' }} aria-hidden="true" />
                No Brainer Lab
              </div>
              <div className="welcome-mode-desc">Practice clearing all 7 tiles in one turn</div>
            </div>
            <div className="welcome-mode-row">
              <div className="welcome-mode-name">
                <span className="welcome-mode-dot" style={{ background: '#34d399' }} aria-hidden="true" />
                Stats &amp; Leaderboard
              </div>
              <div className="welcome-mode-desc">Track your wins, streaks, and weekly rank</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex' }}>
            <button
              className="mode-inline-btn welcome-cta"
              onClick={dismissWelcome}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    ) : null;

  if (appMode === 'home') {
    return (
      <div ref={appRootRef} className={appRootClassName}>
        <div className="layout-screen screen lobby-screen mode-home-screen mode-accent-multiplayer home-lobby-screen" style={{ paddingLeft: '65px', paddingRight: '65px' }}>
          <div className="layout-screen-bg" aria-hidden="true" />
          <div className="layout-screen-beam" aria-hidden="true" />
          <div className="layout-screen-vignette" aria-hidden="true" />
          <div className="layout-screen-inner home-lobby-shell">
            <div className="home-main-column" style={{ paddingLeft: "35px", paddingRight: "35px" }}>
              <div className="mode-hub home-restored-cards" style={{ width: '100%' }}>
                  <section className="home-utility-grid is-quad" aria-label="Quick actions">
                    <div className="home-utility-brand" aria-label="Racehorse">
                      <span className="home-brand-iconbox" aria-hidden="true">
                        <BoneyardStackIcon className="home-brand-icon" />
                      </span>
                      <span className="home-brand-wordmark">RACEHORSE</span>
                    </div>

                    {authUser ? (
                      <button
                        className="mode-option home-utility-card mode-accent-multiplayer"
                        onClick={() => setUsernameModalOpen(true)}
                        aria-label="Open player profile"
                      >
                        <span className="home-utility-profile-line">
                          <span className="mode-option-title">{myHandle}</span>
                          <span className="home-utility-profile-sep">·</span>
                          <span className="home-utility-profile-rating">{homeRatingLabel}</span>
                        </span>
                      </button>
                    ) : (
                      <button className="mode-option home-utility-card mode-accent-multiplayer" onClick={() => setAuthModalOpen(true)}>
                        <span className="home-utility-profile-line">
                          <span className="mode-option-title">Sign in</span>
                          <span className="home-utility-profile-rating">Profile</span>
                        </span>
                      </button>
                    )}

                    <button className="mode-option home-utility-card mode-accent-bot" onClick={() => setStatsOpen(true)}>
                      <span className="mode-option-title">My Stats</span>
                    </button>

                    <button className="mode-option home-utility-card mode-accent-track" onClick={() => setFriendsOpen(true)}>
                      <span className="mode-option-title">Friends</span>
                    </button>
                  </section>

                  <div className="home-main-grid">
                    <button
                      className="mode-option mode-accent-multiplayer mode-card-play-online"
                      onClick={() => setAppMode('multiplayer')}
                    >
                      <span className="mode-option-title">Multiplayer Online</span>
                      <span className="mode-option-meta">Create a private room and play head to head in real time</span>
                    </button>

                    <button
                      className="mode-option mode-accent-daily-fritz mode-card-daily-fritz"
                      onClick={() => setAppMode('dailyFritz')}
                    >
                      <span className="mode-option-title">Daily Fritz Match</span>
                      <span className="mode-option-meta">
                        One fixed live Fritz match per day. Same deals for everyone.
                      </span>
                    </button>

                    <button
                      className="mode-option mode-accent-daily mode-card-daily"
                      onClick={() => setAppMode('daily')}
                    >
                      <span className="mode-option-title">Daily Puzzle</span>
                      <span className="mode-option-meta">
                        Solve today's featured scenario and compare leaderboard results
                      </span>
                    </button>

                    <button
                      className="mode-option mode-accent-bot mode-card-single-player"
                      onClick={() => setAppMode('singlePlayerHub')}
                    >
                      <span className="mode-option-title">Single Player Modes</span>
                      <span className="mode-option-meta">Play vs Fritz, Ghost Mode, Your League, & No Brainer Lab</span>
                    </button>

                    <button
                      className="mode-option mode-accent-tournament mode-card-compete"
                      onClick={() => {
                        setError('');
                        setAppMode('tournament');
                      }}
                    >
                      <span className="mode-option-title">Tournament Mode</span>
                      <span className="mode-option-meta">Round robin (4+ players), matches to 30, play everyone once</span>
                    </button>

                    <button
                      className="mode-option mode-accent-learn mode-card-learn"
                      onClick={() => setAppMode('learn')}
                    >
                      <span className="mode-option-title">Learn Academy</span>
                      <span className="mode-option-meta">New to dominoes? Learn how to play and win.</span>
                    </button>
                  </div>
              </div>
            </div>

            {!supabaseEnabled && (
              <p className="lobby-server mode-subtitle" style={{ marginTop: 12 }}>
                {supabaseConfigError ?? 'Supabase not configured.'}
              </p>
            )}
          </div>
        </div>
        {welcomeModal}
        <Suspense fallback={null}>
          <AuthModal
            open={authModalOpen}
            supabaseEnabled={supabaseEnabled}
            supabaseConfigError={supabaseConfigError}
            onClose={() => setAuthModalOpen(false)}
            onSignIn={signIn}
            onSignUp={signUp}
            onResetPassword={resetPassword}
          />
          <UsernameModal
            open={(!onboardingDismissed && needsUsernameOnboarding) || usernameModalOpen}
            currentUsername={authProfile?.username ?? null}
            onSave={async (username) => {
              const result = await updateUsername(username);
              if (!result.error) {
                window.localStorage.removeItem('username_onboarding_dismissed');
                setOnboardingDismissed(false);
                setUsernameModalOpen(false);
              }
              return result;
            }}
            onClose={() => {
              window.localStorage.setItem('username_onboarding_dismissed', Date.now().toString());
              setOnboardingDismissed(true);
              setUsernameModalOpen(false);
            }}
            onSignOut={async () => {
              resetRoomRecoveryState();
              setSigningOut(true);
              setAppMode('home');
              resetMultiplayerRoomState();
              setError('');
              setActionError('');
              try {
                void signOut().catch(() => {});
              } catch {
                // no-op
              } finally {
                setSigningOut(false);
              }
            }}
            signingOut={signingOut}
          />
          <StatsScreen
            open={statsOpen}
            user={authUser}
            profile={authProfile}
            onClose={() => setStatsOpen(false)}
          />
          <FriendsScreen
            open={friendsOpen}
            user={authUser}
            socket={socket}
            joinedRoom={joinedRoom}
            currentUsername={authProfile?.username ?? ''}
            showToast={showToast}
            onCopyInviteLink={copyInviteLink}
            onCreatePrivateRoom={onCreatePrivateRoom}
            onClose={() => setFriendsOpen(false)}
          />
        </Suspense>
        <WeeklyStatsScreen
          open={weeklyStatsOpen}
          onClose={() => setWeeklyStatsOpen(false)}
          user={authUser}
        />
        {friendInvitePopup}
</div>
    );
  }

  return (
    <div ref={appRootRef} className={appRootClassName}>
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
      {friendInvitePopup}

      {/* Error Banner */}
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && state && !state.handOver && !state.gameOver && (
        <div className="error-banner">
          {actionError}
          <button onClick={() => setActionError('')}>×</button>
        </div>
      )}

      {/* Disconnected Lobby Screen */}
      {!isConnected && !isRecoveringConnection && (
        <LayoutScreen
          className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-multiplayer multiplayer-screen-disconnected"
          title="Multiplayer Online"
          subtitle="Connect to create a room or join a friend using a room code."
          contentClassName="multiplayer-menu-card screen-shell"
        >
            <p className="lobby-server mode-server-line multiplayer-server-line">Server: {serverUrl}</p>
            <div className="mode-actions mode-entry-panel">
              <button
                className="mode-option mode-option-primary mode-accent-multiplayer multiplayer-connect-hero"
                onClick={connect}
                disabled={isConnecting}
              >
                <span className="mode-option-title">
                  {isConnecting ? 'Connecting...' : 'Connect'}
                </span>
                <span className="mode-option-meta">Enable room creation and room joins</span>
              </button>
              <button className="mode-option mode-option-secondary multiplayer-create-muted" onClick={createRoom} disabled>
                <span className="mode-option-title">Create New Room</span>
                <span className="mode-option-meta">Connect first to start hosting</span>
              </button>
              <div className="mode-join-row">
                <input
                  className="mode-join-input"
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled
                />
                <button className="mode-inline-btn multiplayer-join-btn" onClick={joinRoom} disabled>
                  Join Room
                </button>
              </div>
              {serverWaking && (
                <p className="mode-subtitle" style={{ margin: '2px 0 0' }}>
                  Connecting to server... (this may take up to 60 seconds on first load)
                </p>
              )}
            </div>
        </LayoutScreen>
      )}

      {/* Lobby Screen */}
      {isConnected && !joinedRoom && (
        <LayoutScreen
          className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-multiplayer multiplayer-screen-lobby"
          title="Join or Create a Room"
          subtitle="Create a new room or enter a code to join your friend instantly."
          contentClassName="multiplayer-menu-card screen-shell"
        >
            <div className="mode-actions mode-entry-panel">
              <button
                className={`mode-option mode-option-primary mode-accent-multiplayer multiplayer-create-hero ${pendingUiAction === 'create' ? 'is-loading' : ''}`}
                onClick={createRoom}
                disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
              >
                <span className="mode-option-title">{pendingUiAction === 'create' ? 'Creating…' : 'Create New Room'}</span>
                <span className="mode-option-meta">Start a room and share the code</span>
              </button>
              <div className="mode-join-row">
                <input
                  className="mode-join-input"
                  type="text"
                  placeholder="Room Code"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
                />
                <button
                  className={`mode-inline-btn multiplayer-join-btn ${pendingUiAction === 'join' ? 'is-loading' : ''}`}
                  onClick={joinRoom}
                  disabled={pendingUiAction === 'create' || pendingUiAction === 'join'}
                >
                  {pendingUiAction === 'join' ? 'Joining…' : 'Join Room'}
                </button>
              </div>
              <button className="mode-option mode-option-secondary multiplayer-disconnect-muted" onClick={() => disconnect('user disconnect')}>
                <span className="mode-option-title">Disconnect</span>
                <span className="mode-option-meta">Return to offline mode selector</span>
              </button>
            </div>
        </LayoutScreen>
      )}

      {/* Room Screen (waiting for game) */}
      {isConnected && joinedRoom && !state && (
        <LayoutScreen
          className="screen room-screen mode-home-screen mode-subpage-screen mode-accent-multiplayer multiplayer-screen-room"
          title={<span>Room: <span className="multiplayer-room-code">{joinedRoom}</span></span>}
          subtitle="Waiting for all players to join before starting the hand."
          contentClassName="multiplayer-menu-card screen-shell"
        >
            <div className="mode-entry-panel room-entry-panel">
            <div className="players-list mode-room-list multiplayer-players-panel">
              <h3 className="multiplayer-players-label">Players ({players.length}/2)</h3>
              {players.map((p) => (
                <div
                  key={p.id}
                  className={`player-item mode-room-item ${p.id === you ? 'you' : ''}`}
                >
                  <div className="mode-room-item-label">
                    <span className="mode-room-item-title">
                      {p.id === you ? 'You' : `@${p.username}`}
                    </span>
                    {p.id === you && <span className="mode-room-item-sub">@{p.username}</span>}
                  </div>
                  {p.id === you && <span className="badge multiplayer-host-badge">Host</span>}
                </div>
              ))}
              {players.length < 2 && <div className="waiting multiplayer-waiting-live">Waiting for another player...</div>}
            </div>
            {players.length === 2 && (
              <button
                className={`mode-option mode-option-primary mode-accent-multiplayer ${pendingUiAction === 'start' ? 'is-loading' : ''}`}
                onClick={startGame}
                disabled={pendingUiAction === 'start'}
              >
                <span className="mode-option-title">{pendingUiAction === 'start' ? 'Starting…' : 'Start Game'}</span>
                <span className="mode-option-meta">Begin the live multiplayer hand</span>
              </button>
            )}
            {roomRecoveryState !== 'idle' && (
              <div className="mode-option mode-option-secondary" style={{ cursor: 'default' }}>
                <span className="mode-option-title">
                  {roomRecoveryState === 'reconnecting'
                    ? 'Reconnecting…'
                    : roomRecoveryState === 'resyncing'
                      ? 'Syncing room…'
                      : 'Reconnect Failed'}
                </span>
                <span className="mode-option-meta">
                  {roomRecoveryMessage || 'Restoring your room session.'}
                </span>
              </div>
            )}
            {roomRecoveryState === 'failed' && (
              <button className="mode-option mode-option-primary mode-accent-multiplayer" onClick={retryRoomRecovery}>
                <span className="mode-option-title">Retry Reconnect</span>
                <span className="mode-option-meta">Attempt to restore this room session</span>
              </button>
            )}
            <button className="mode-option mode-option-secondary multiplayer-copy-cta" onClick={copyInviteLink}>
              <span className="mode-option-title">Copy Invite Link</span>
              <span className="mode-option-meta">Share one-tap room join with friends</span>
            </button>
            <button className="mode-option mode-option-secondary multiplayer-leave-muted" onClick={() => disconnect('user leave room')}>
              <span className="mode-option-title">Leave Room</span>
              <span className="mode-option-meta">Exit this room and return to setup</span>
            </button>
            </div>
        </LayoutScreen>
      )}

      {/* Game Screen */}
      {(isConnected || isRecoveringConnection) && joinedRoom && state && (
        <div className={`screen game-screen walnut-live theme-${uiTheme}`}>
          {roomRecoveryState !== 'idle' && (
            <div
              style={{
                position: 'fixed',
                top: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1200,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid rgba(236,252,245,0.24)',
                background: 'rgba(15,25,20,0.82)',
                color: 'rgba(232,245,240,0.95)',
                fontSize: '0.84rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span>
                {roomRecoveryState === 'reconnecting'
                  ? 'Reconnecting…'
                  : roomRecoveryState === 'resyncing'
                    ? 'Syncing room…'
                    : 'Reconnect failed'}
              </span>
              {roomRecoveryMessage && roomRecoveryState !== 'reconnecting' && (
                <span style={{ fontWeight: 500, opacity: 0.9 }}>{roomRecoveryMessage}</span>
              )}
              {roomRecoveryState === 'failed' && (
                <button
                  onClick={retryRoomRecovery}
                  style={{
                    border: '1px solid rgba(236,252,245,0.24)',
                    background: 'rgba(255,255,255,0.08)',
                    color: 'inherit',
                    borderRadius: 999,
                    padding: '4px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <ScoreTrackOverlay
            open={scoreTrackOpen}
            onClose={() => setScoreTrackOpen(false)}
            target={60}
            players={[
              { label: opponentName, score: opponentScore, tone: 'opp' },
              { label: myName, score: myScore, tone: 'you' },
            ]}
          />
          <canvas
            ref={confettiCanvasRef}
            style={{
              position: 'fixed',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 2100,
              display: state.gameOver ? 'block' : 'none',
            }}
          />
          {/* Game Over Overlay */}
          {state.gameOver && (
            <GameOverOverlay
              state={state}
              myId={you}
              onPrimary={canUseRematch ? requestRematch : handlePostGame}
              primaryLabel={canUseRematch ? (rematchRequested ? 'Rematch Requested' : 'Rematch') : 'New Game'}
              onExit={handlePostGame}
              secondaryLabel={canUseRematch ? 'Home' : 'Back'}
              waitingText={canUseRematch ? rematchWaitingText : undefined}
              players={players}
              ratingSummary={multiplayerRatingSummary}
              extraActionLabel="Analyze Game"
              onExtraAction={openMultiplayerAnalyzer}
            />
          )}
          {handReveal && !state.gameOver && (
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
                  minWidth: 420,
                  boxShadow: '0 26px 70px rgba(0,0,0,0.48)',
                  color: 'rgba(232,245,240,0.95)',
                  display: 'grid',
                  gap: 18,
                  opacity: 0.92 + handRevealAutoProgress * 0.08,
                }}
              >
                {(() => {
                  const youPoints = handReveal.pointsAwarded.you;
                  const oppPoints = handReveal.pointsAwarded.opponent;
                  const youWonHand = youPoints > oppPoints;
                  const oppWonHand = oppPoints > youPoints;
                  const winnerText = youWonHand
                    ? `🎉 You won this hand  +${youPoints} pts`
                    : oppWonHand
                      ? `${opponentName} won this hand  +${oppPoints} pts`
                      : 'Hand ended  +0 pts';
                  const winnerColor = youWonHand
                    ? 'rgba(125, 241, 197, 0.95)'
                    : 'rgba(223,236,244,0.86)';
                  return (
                    <>
                <h3 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Hand Over</h3>
                <p style={{ margin: 0, fontSize: '1rem', color: winnerColor }}>
                  {winnerText}
                </p>
                    </>
                  );
                })()}
                {(() => {
                  const yourCount = handReveal.yourRemainingTiles.length;
                  const oppCount = handReveal.opponentRemainingTiles.length;
                  const whoWentOutRaw =
                    handReveal.whoWentOut ?? handReveal.winnerId ?? handReveal.handWinnerId ?? null;
                  const youWentOut =
                    whoWentOutRaw === 'you' || whoWentOutRaw === you || (whoWentOutRaw == null && yourCount === 0);
                  const oppWentOut =
                    whoWentOutRaw === 'opponent' ||
                    (Boolean(opponentId) && whoWentOutRaw === opponentId) ||
                    (whoWentOutRaw == null && oppCount === 0);
                  const blocked = yourCount > 0 && oppCount > 0;

                  const sectionLabelStyle = {
                    fontSize: '0.86rem',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                    color: 'rgba(200,220,215,0.78)',
                    fontWeight: 700,
                    textAlign: 'center' as const,
                  };

                  const tileRowStyle = {
                    display: 'flex',
                    flexWrap: 'wrap' as const,
                    gap: 8,
                    justifyContent: 'center' as const,
                  };

                  if (youWentOut && !blocked) {
                    return (
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={sectionLabelStyle}>
                          {opponentName} had {oppCount} tile{oppCount === 1 ? '' : 's'} remaining:
                        </div>
                        <div style={tileRowStyle}>
                          {handReveal.opponentRemainingTiles.map((tile, idx) => (
                            <DominoTile
                              key={`reveal-${idx}-${tile.low}-${tile.high}`}
                              tile={tile}
                              size={48}
                              className="hand-over-tile"
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  if (oppWentOut && !blocked) {
                    return (
                      <div style={{ display: 'grid', gap: 10 }}>
                        <div style={sectionLabelStyle}>Your remaining tiles:</div>
                        <div style={tileRowStyle}>
                          {handReveal.yourRemainingTiles.map((tile, idx) => (
                            <DominoTile
                              key={`you-reveal-${idx}-${tile.low}-${tile.high}`}
                              tile={tile}
                              size={48}
                              className="hand-over-tile"
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'grid', gap: 16 }}>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div style={sectionLabelStyle}>Your remaining tiles</div>
                        <div style={tileRowStyle}>
                          {handReveal.yourRemainingTiles.map((tile, idx) => (
                            <DominoTile
                              key={`you-reveal-${idx}-${tile.low}-${tile.high}`}
                              tile={tile}
                              size={48}
                              className="hand-over-tile"
                            />
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'grid', gap: 8 }}>
                        <div style={sectionLabelStyle}>{opponentName} remaining tiles</div>
                        <div style={tileRowStyle}>
                          {handReveal.opponentRemainingTiles.map((tile, idx) => (
                            <DominoTile
                              key={`reveal-${idx}-${tile.low}-${tile.high}`}
                              tile={tile}
                              size={48}
                              className="hand-over-tile"
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div style={{ display: 'grid', gap: 6, marginTop: 2 }}>
                  <div
                    style={{
                      height: 4,
                      borderRadius: 999,
                      background: 'rgba(236,252,245,0.12)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${Math.max(0, Math.min(1, handRevealAutoProgress)) * 100}%`,
                        background: 'linear-gradient(90deg, rgba(125,241,197,0.9), rgba(125,241,197,0.45))',
                        transition: 'width 50ms linear',
                      }}
                    />
                  </div>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'rgba(200,220,215,0.66)' }}>
                    Next hand in {Math.max(0, Math.ceil(handRevealAutoProgress * 4))}s
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="wl-top-rail" data-ui="hud" style={{ position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                ref={opponentPillRef}
                className={`wl-player-pill wl-player-pill-btn ${!isMyTurn ? 'is-active' : ''} ${opponentId && hudScorePulse[opponentId] ? 'score-hit' : ''}`}
                onClick={() => setScoreTrackOpen(true)}
                aria-label="Open score track"
                style={{ width: 154, minWidth: 'unset' }}
              >
                <div className="wl-pill-top">
                  <span className="wl-player-label">{opponentName}</span>
                </div>
                <span className="wl-player-score">{opponentScore}</span>
              </button>
              <TileRack
                count={opponentTileCount}
                isActive={!isMyTurn}
              />
            </div>
            <div
              className="wl-center-status"
              style={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className={`wl-turn-label ${isMyTurn ? 'your-turn' : 'opp-turn'}`}>
                {isMyTurn ? 'Your move' : 'Opponent thinking'}
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
              className="hud-right-cluster"
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
                className={`wl-player-pill wl-player-pill-btn is-you ${isMyTurn ? 'is-active' : ''} ${hudRightScorePulse ? 'score-hit' : ''}`}
                onClick={() => setScoreTrackOpen(true)}
                aria-label="Open score track"
                style={{ width: 130, minWidth: 'unset' }}
              >
                <span className="wl-player-label">{hudRightLabel}</span>
                <span className="wl-player-score">{hudRightScore}</span>
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
                    transform: scoreToast.visible
                      ? 'translate(-50%, 0px) scale(1)'
                      : 'translate(-50%, -14px) scale(0.95)',
                    opacity: scoreToast.visible ? 1 : 0,
                    transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                    zIndex: 14,
                    background: 'rgba(255,255,255,0.06)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 999,
                    padding: '10px 22px',
                    color:
                      scoreToast.tone === 'you'
                        ? 'rgba(151, 241, 205, 0.98)'
                        : 'rgba(255, 180, 180, 0.95)',
                    fontSize: '1.24rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    boxShadow: scoreToast.tone === 'you'
                      ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
                  }}
                >
                  {renderScoreToastMessage(scoreToast.message)}
                </div>
              )}
              {!state.gameOver && (
                <div
                  ref={boneyardRef}
                  className={`boneyard-pill${isBoneyardLocked ? ' locked' : ''}`}
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
                  <span className="boneyard-count">{boneyardCount}</span>
                  {isBoneyardLocked && boneyardCount > 0 ? (
                    <span className="boneyard-meta" style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', opacity: 0.9 }}>locked</span>
                  ) : null}
                </div>
              )}              <div
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
                <RoomReactions feed={roomReactions} onSendChat={sendRoomChat} onSendEmote={sendRoomEmote} />
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
              <Board
                board={state?.board ?? null}
                legalMoves={boardLegalMoves}
                selectedTile={boardSelectedTile}
                lastPlayedTile={lastPlayedTile}
                onPositionClick={play}
                tileSize={72}
                showOpenEndGlow={boardShowOpenEndGlow}
              />
              {flyingTiles.map((ft) => (
                <div
                  key={ft.id}
                  className="flying-tile-overlay"
                  style={
                    {
                      '--fly-from-x': `${ft.x}px`,
                      '--fly-from-y': `${ft.y}px`,
                      '--fly-to-x': `${ft.toX}px`,
                      '--fly-to-y': `${ft.toY}px`,
                    } as React.CSSProperties
                  }
                />
              ))}
            </div>
          </div>

          <div ref={handAreaRef} className="hand-area wl-hand-area" data-ui="tray">
            <div className="tray-rail">
              <div className="tray-center" ref={trayCenterRef}>
                <HandView
                  hand={myHand}
                  selectedTile={handSelectedTile}
                  onSelect={handleTileTap}
                  isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                  legalMoves={legalMoves}
                  tileSize={handTileSize}
                  compactStacked={handCompactStacked}
                  drawPulseIndex={drawPulseIndex}
                />
              </div>


            </div>
          </div>
        </div>
      )}
      <Suspense fallback={null}>
        <GameReviewer
          open={analyzerOpen}
          onClose={() => setAnalyzerOpen(false)}
          analysis={currentAnalysis}
          title="Game Review"
        />
      </Suspense>
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
                  setShowLeaveConfirm(false);
                  disconnect('user leave game');
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
