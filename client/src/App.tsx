import React, { Suspense, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from './components/RoomReactions';
import type { Socket } from 'socket.io-client';
import './App.css';
import {
  Board,
  BoneyardStackIcon,
  BrandLogo,
  DominoTile,
  RotateOverlay,
  ScoreTrackOverlay,
} from './components';
import { MatchNblBoardFrame } from './components/MatchNblBoardFrame';
import LeaveGameModal from './components/LeaveGameModal';
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
import { resolveGameServerUrl } from './lib/gameServerUrl';
import { useRoomSocketSync } from './multiplayer/useRoomSocketSync';
import { useMultiplayerConnection } from './multiplayer/useMultiplayerConnection';
import { useMultiplayerRoomActions } from './multiplayer/useMultiplayerRoomActions';
import { useRenderProfiler } from './debug/renderProfiler';
import {
  claudeRgb,
} from './ui/claudeMode';
import {
  loadAuthoringSession,
  saveFrozenLesson,
  loadFrozenLesson,
} from './learn/guidedAuthoring';
import RacehorseHomeScreen from './screens/HomeScreen';
import SinglePlayerHubScreen from './screens/SinglePlayerHubScreen';
import { TournamentScreen } from './screens/TournamentScreen';
import TournamentHubScreen from './tournament/TournamentHubScreen';
import TournamentBracketScreen from './tournament/TournamentBracketScreen';
import TournamentResultScreen from './tournament/TournamentResultScreen';
import TournamentMatchBanner from './tournament/TournamentMatchBanner';
import { useTournament } from './tournament/useTournament';
import PrivateMatchLobbyScreen from './multiplayer/PrivateMatchLobbyScreen';
import MatchmakingScreen from './matchmaking/MatchmakingScreen';

function emitWithAck<TResp>(
  socket: { emit: (...args: any[]) => void },
  event: string,
  ...argsWithoutAck: any[]
): Promise<TResp> {
  return new Promise((resolve, reject) => {
    const mpDebug =
      typeof window !== 'undefined' && window.localStorage.getItem('mp_debug') === '1';
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (mpDebug) {
      console.log('[mp-action-client] sent', {
        event,
        payload: argsWithoutAck[argsWithoutAck.length - 1],
      });
    }
    const t = window.setTimeout(
      () => {
        if (mpDebug) {
          const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          console.warn('[mp-action-client] timeout', {
            event,
            elapsedMs: Number((endedAt - startedAt).toFixed(1)),
          });
        }
        reject(new Error(`${event} timed out after 8000ms`));
      },
      8000,
    );
    socket.emit(event, ...argsWithoutAck, (resp: TResp) => {
      window.clearTimeout(t);
       if (mpDebug) {
        const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        console.log('[mp-action-client] ack', {
          event,
          elapsedMs: Number((endedAt - startedAt).toFixed(1)),
          response: resp,
        });
      }
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

type AppMode =
  | 'home'
  | 'multiplayer'
  | 'noBrainer'
  | 'botSetup'
  | 'bot'
  | 'ghostSetup'
  | 'ghost'
  | 'daily'
  | 'dailyFritz'
  | 'learn'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'tournament'
  | 'leaderboard'
  | 'profile'
  | 'feed';

const EMPTY_MOVES: Move[] = [];

const NoBrainerLabScreen = React.lazy(() => import('./practice/NoBrainerLabScreen'));
const BotMatchScreen = React.lazy(() => import('./bot/BotMatchScreen'));
const PlayVsFritz = React.lazy(() => import('./bot/PlayVsFritz'));
const GhostSetupScreen = React.lazy(() => import('./ghost/GhostSetupScreen'));
const DailyPuzzleScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleScreen'));
const DailyFritzScreen = React.lazy(() => import('./dailyFritz/DailyFritzScreen'));
const DailyPuzzleAdminScreen = React.lazy(() => import('./dailyPuzzle/DailyPuzzleAdminScreen'));
const RatingHistoryPage = React.lazy(() => import('./ranking/RatingHistoryPage'));
const GameReviewer = React.lazy(() => import('./analyzer/GameReviewer'));
const AuthModal = React.lazy(() => import('./auth/AuthModal'));
const UsernameModal = React.lazy(() => import('./auth/UsernameModal'));
const StatsScreen = React.lazy(() => import('./stats/StatsScreen'));
const FriendsScreen = React.lazy(() => import('./friends/FriendsScreen'));
const LeaderboardScreen = React.lazy(() => import('./social/LeaderboardScreen'));
const PublicProfileScreen = React.lazy(() => import('./social/PublicProfileScreen'));
const ActivityFeedScreen = React.lazy(() => import('./social/ActivityFeedScreen'));
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
const GUEST_ID_STORAGE_KEY = 'racehorse_guest_identity_v1';

function getOrCreateGuestIdentityId(): string {
  const fallback = () => `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  if (typeof window === 'undefined') return fallback();
  try {
    const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing?.startsWith('guest_')) return existing;
    const next = fallback();
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return fallback();
  }
}

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
    <div className="rh-screen-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="rh-screen-loader__bg" aria-hidden />
      <div className="rh-screen-loader__panel">
        <div className="rh-screen-loader__brand">
          <BrandLogo iconSize={30} showWordmark />
        </div>
        <p className="rh-screen-loader__label">{label}</p>
        <div className="rh-screen-loader__rail" aria-hidden>
          <div className="rh-screen-loader__rail-fill" />
        </div>
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
      matchKind="multiplayer"
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
        <div className="rh-go-rating">
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
      {waitingText && <p className="rh-go-waiting">{waitingText}</p>}
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

const SOCKET_MODES = new Set<AppMode>(['multiplayer', 'bot', 'botSetup', 'ghost', 'ghostSetup']);

const MODE_TO_PATH: Partial<Record<AppMode, string>> = {
  home: '/',
  stats: '/stats',
  friends: '/friends',
  daily: '/daily',
  dailyFritz: '/daily-fritz',
  ratingHistory: '/rating-history',
  singlePlayerHub: '/solo',
  tournament: '/tournament',
  noBrainer: '/practice',
  learn: '/learn',
};

const PATH_TO_MODE: Record<string, AppMode> = Object.fromEntries(
  Object.entries(MODE_TO_PATH).map(([mode, path]) => [path, mode as AppMode])
);

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
  const [serverUrl] = useState(() => resolveGameServerUrl());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const navigate = useNavigate();
  const [appMode, setAppMode] = useState<AppMode>(() => {
    const hash = window.location.hash.replace(/^#/, '') || '/';
    const mode = PATH_TO_MODE[hash];
    return mode && !SOCKET_MODES.has(mode) ? mode : 'home';
  });
  const [selectedLearnLessonId, setSelectedLearnLessonId] = useState<string | null>(null);
  const [mpSubView, setMpSubView] = useState<'quick' | 'private'>('quick');
  const [tournamentSubView, setTournamentSubView] = useState<'hub' | 'bracket' | 'result'>('hub');
  const [activeTournamentId, setActiveTournamentId] = useState<string | null>(null);
  const [tournamentMatch, setTournamentMatch] = useState<{
    tournamentId: string;
    matchId: string;
    round: 1 | 2 | 3;
    opponentUserId: string | null;
    opponentUsername: string | null;
    opponentRating: number | null;
  } | null>(null);
  const [completedTournamentId, setCompletedTournamentId] = useState<string | null>(null);
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

  const [profileTarget, setProfileTarget] = useState<string | null>(null);

  const [roomCode, setRoomCode] = useState('');
  const [tournamentCode, setTournamentCode] = useState('');
  const [tournamentId, setTournamentId] = useState<string | null>(null);
  const [tournamentState, setTournamentState] = useState<any>(null);
  const [tournamentActiveRoom, setTournamentActiveRoom] = useState<string | null>(null);
  const [roomReactions, setRoomReactions] = useState<Array<RoomChatEvent | RoomEmoteEvent>>([]);
  const [multiplayerRatingBaseline, setMultiplayerRatingBaseline] = useState<number | null>(null);
  const [multiplayerRatingPending, setMultiplayerRatingPending] = useState(false);
  const multiplayerRatingRefreshKeyRef = useRef('');
  const [privateLobbyHostWinStreak, setPrivateLobbyHostWinStreak] = useState<number | null>(null);

  // Sync appMode → URL hash (side effect only; appMode is still source of truth)
  useEffect(() => {
    const path = SOCKET_MODES.has(appMode) ? '/' : (MODE_TO_PATH[appMode] ?? '/');
    navigate(path, { replace: true });
  }, [appMode, navigate]);

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
  const frozenHandOverBoardRef = useRef<{ handNumber: number; board: NonNullable<GameState['board']> } | null>(null);
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [pendingUiAction, setPendingUiAction] = useState<
    null | 'create' | 'join' | 'start' | 'draw' | 'pass' | 'play'
  >(null);
  const pendingActionRef = useRef<boolean>(false);
  const {
    user: authUser,
    profile: authProfile,
    accessToken: authAccessToken,
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
  const [guestIdentityId] = useState(getOrCreateGuestIdentityId);
  const multiplayerIdentityUserId = authUser?.id ?? guestIdentityId;
  const multiplayerAuthToken = authUser?.id ? authAccessToken : null;
  // Single tournament hook instance, shared by Hub/Bracket/Result screens.
  // Hoisted from the screens so that registration changes / bracket updates /
  // pending match-ready events are observed in App.tsx and can trigger top-level
  // navigation (auto-route to result on tournament:completed).
  const tournament = useTournament({
    socket,
    userId: authUser?.id ?? null,
  });

  // Auto-route to the result screen when a tournament the user is engaged in
  // completes. "Engaged in" = they have a registration row for it, OR are
  // currently in its match room. We listen directly here so App.tsx can flip
  // `tournamentSubView` without screen-level coordination.
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { tournamentId?: string }) => {
      if (!payload?.tournamentId) return;
      setCompletedTournamentId(payload.tournamentId);
    };
    socket.on('tournament:completed', handler);
    return () => { socket.off('tournament:completed', handler); };
  }, [socket]);
  const authUserRef = useRef(authUser);
  const authProfileRef = useRef(authProfile);
  const authAccessTokenRef = useRef<string | null>(authAccessToken);
  const multiplayerIdentityUserIdRef = useRef(multiplayerIdentityUserId);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [weeklyStatsOpen, setWeeklyStatsOpen] = useState(false);
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
  const handRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const roomIdentityRef = useRef<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>(null);
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

  const copyRoomCodeToClipboard = useCallback(async () => {
    const code = normalizeRoomCode(joinedRoom || roomCode);
    if (!code) {
      showToast('No room code to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      showToast('Room code copied.');
    } catch {
      showToast('Could not copy room code.');
    }
  }, [joinedRoom, roomCode, showToast]);

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
    authAccessTokenRef.current = authAccessToken;
  }, [authAccessToken]);

  useEffect(() => {
    multiplayerIdentityUserIdRef.current = multiplayerIdentityUserId;
  }, [multiplayerIdentityUserId]);

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
      socket.emit('presence:identify', { userId: authUser.id, username, authToken: authAccessToken }, () => {
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
  }, [socket, authUser?.id, authProfile?.username, authUser?.email, authAccessToken]);

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
    pendingActionRef.current = false;
    setHandReveal(null);
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
      setTournamentMatch(null);
      roomIdentityRef.current = null;
      if (clearRoomCode) setRoomCode('');
      setState(null);
      setLegalMoves([]);
      setCanDraw(false);
      setSelectedTile(null);
      setHandReveal(null);
      setRematchRequested(false);
      setRematchReadyIds([]);
      setScoreTrackOpen(false);
      pendingActionRef.current = false;
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

  /** Leave the current private room, stay connected, and return to Private Match create/join (not Quick Match). */
  const leavePrivateLobbyRoom = useCallback(() => {
    const code = normalizeRoomCode(joinedRoomRef.current);
    const s = socketRef.current;
    if (s?.connected && code) {
      s.emit('room:leave', code);
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LAST_ROOM_STORAGE_KEY);
    }
    intentionalDisconnectRef.current = false;
    reconnectShouldJoinRef.current = false;
    reconnectRoomCodeRef.current = null;
    clearReconnectAttemptTimer();
    reconnectAttemptCountRef.current = 0;
    rejoinInFlightRef.current = false;
    preventAutoRejoinRef.current = false;
    autoJoinAttemptedRef.current = false;
    setIsRecoveringConnection(false);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
    setRoomReactions([]);
    resetMultiplayerRoomState({ clearRoomCode: true });
    /* Stay on Private Match → create / join lobby; do not jump to Quick Match. */
    setMpSubView('private');
  }, [
    normalizeRoomCode,
    clearReconnectAttemptTimer,
    resetMultiplayerRoomState,
    setMpSubView,
    setIsRecoveringConnection,
    setRoomRecoveryState,
    setRoomRecoveryMessage,
    setRoomReactions,
  ]);

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
        const username = authProfile?.username ?? 'Guest';
        const userId = multiplayerIdentityUserId;
        const authToken = multiplayerAuthToken;

        const resp = await emitWithAck<any>(targetSocket, 'room:create', {
          username,
          userId,
          authToken,
        });
        if (!resp?.ok) {
          throw new Error(resp?.error ?? 'Unable to create room.');
        }

        roomIdentityRef.current = { username, userId, authToken };

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
    [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, resolvePendingCreate, applyRoomEventMeta, clearTransientRoomUi],
  );

  const applyJoinedRoomResponse = useCallback((resp: any) => {
    applyRoomEventMeta(resp.eventMeta);

    if (!roomIdentityRef.current) {
      roomIdentityRef.current = {
        username: authProfile?.username ?? 'Guest',
        userId: multiplayerIdentityUserId,
        authToken: multiplayerAuthToken,
      };
    }

    const resolvedYou =
      typeof resp?.you === 'string' && resp.you
        ? resp.you
        : socket?.id ?? '';

    if (resolvedYou) {
      setYou(resolvedYou);
      youRef.current = resolvedYou;
    }

    setJoinedRoom(resp.roomCode);
    setRoomCode(resp.roomCode);
    setState(resp.state ?? null);
    setPlayers(normalizeRoomPlayers(resp.players));
    clearTransientRoomUi();
    setLegalMoves(Array.isArray(resp.legalMoves) ? resp.legalMoves : []);
    setCanDraw(typeof resp.canDraw === 'boolean' ? resp.canDraw : false);
    setRoomRecoveryState('idle');
    setRoomRecoveryMessage('');
    // Tournament match metadata supplied by the server (replaces fragile regex).
    setTournamentMatch(resp.tournamentMatch ?? null);

    if (import.meta.env.DEV) {
      console.warn('[multiplayer-debug] applyJoinedRoomResponse identity/state', {
        respYou: resp?.you,
        socketId: socket?.id,
        resolvedYou,
        playerIds: resp?.state?.playerIds,
        playerKeys: resp?.state?.players ? Object.keys(resp.state.players) : null,
        resolvedHandLength: resp?.state?.players?.[resolvedYou]?.hand?.length ?? null,
      });
    }
  }, [applyRoomEventMeta, clearTransientRoomUi, socket?.id]);

  /**
   * Auto-join a matchmaking-reserved room after the Match Found countdown.
   * The server will auto-start the game once both players are in the room
   * (see the matchmaking auto-start hook in server/src/index.ts).
   */
  const handleMatchmakingAutoJoin = useCallback((code: string) => {
    if (!socket) return;
    const username = authProfile?.username ?? authUser?.email?.split('@')[0] ?? 'Guest';
    socket.emit(
      'room:join',
      code.trim().toUpperCase(),
      { username, userId: multiplayerIdentityUserId, authToken: multiplayerAuthToken },
      (resp: any) => {
        if (!resp?.ok) {
          showToast(resp?.error ?? 'Could not join matched room.', 2500);
          return;
        }
        applyJoinedRoomResponse(resp);
      },
    );
  }, [socket, authProfile?.username, authUser?.email, multiplayerIdentityUserId, multiplayerAuthToken, applyJoinedRoomResponse, showToast]);

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
    authAccessTokenRef,
    multiplayerIdentityUserIdRef,
    joinedRoomRef,
    youRef,
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
    handRevealTimerRef,
    maxSequenceRef,
    roomIdentityRef,
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
  const authUserIdRef = useRef<string | null>(multiplayerIdentityUserId);
  const authTokenRef = useRef<string | null>(multiplayerAuthToken);
  useEffect(() => {
    authUsernameRef.current = authProfile?.username ?? 'Guest';
    authUserIdRef.current = multiplayerIdentityUserId;
    authTokenRef.current = multiplayerAuthToken;
  }, [authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken]);

  const {
    onCreatePrivateRoom,
    copyInviteLink,
    createRoom,
    joinRoom,
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
    authUserId: multiplayerIdentityUserId,
    authToken: multiplayerAuthToken,
    authUsernameRef,
    authUserIdRef,
    authTokenRef,
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
    setFriendInvite,
    roomIdentityRef,
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
      if (!resp?.ok) {
        setRematchRequested(false);
        showToast(resp?.error ?? 'Rematch failed.');
        return;
      }
      // If the server already started the rematch (both players ready), clear
      // the pending state immediately via the ack. The game:rematch:started
      // broadcast will also reset it, but if that event is missed on a marginal
      // connection this ack ensures the button is never stuck permanently.
      if (resp?.started) {
        setRematchRequested(false);
      }
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

  const isGameplayActionBlocked = useCallback(() => {
    if (!socket || !joinedRoom || !state || !you) return true;
    if (
      !socket.connected ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      rejoinInFlightRef.current
    ) {
      showToast('Reconnecting...', 1200);
      return true;
    }
    if (pendingActionRef.current) return true;
    if (pendingUiAction === 'draw' || pendingUiAction === 'pass' || pendingUiAction === 'play') {
      return true;
    }
    if (state.handOver || state.gameOver) return true;
    if (!state.playerIds.includes(you)) return true;
    return state.playerIds[state.currentPlayerIndex] !== you;
  }, [
    socket,
    joinedRoom,
    state,
    you,
    roomRecoveryState,
    isRecoveringConnection,
    pendingUiAction,
    showToast,
  ]);

  // Game actions
  const draw = useCallback(async () => {
    setActionError('');
    const boneyardLockedNow = (state?.boneyard.length ?? 0) <= 2;
    if (
      !socket ||
      !joinedRoom ||
      boneyardLockedNow ||
      drawSequenceActive ||
      !canDraw ||
      isGameplayActionBlocked()
    ) {
      return;
    }
    emitDraggingState(false);
    setPendingUiAction('draw');
    pendingActionRef.current = true;
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
      pendingActionRef.current = false;
    }
  }, [socket, joinedRoom, state, you, legalMoves, canDraw, appendMultiplayerMove, emitDraggingState, showToast, drawSequenceActive, isGameplayActionBlocked]);

  const pass = useCallback(async () => {
    setActionError('');
    const hasPassMove = legalMoves.some((m) => m.type === 'pass');
    if (!socket || !joinedRoom || drawSequenceActive || !hasPassMove || isGameplayActionBlocked()) return;
    emitDraggingState(false);
    setPendingUiAction('pass');
    pendingActionRef.current = true;
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
      pendingActionRef.current = false;
    }
  }, [socket, joinedRoom, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast, drawSequenceActive, isGameplayActionBlocked]);

  const play = useCallback(
    async (position: PlacementPosition) => {
      setActionError('');
      if (!socket || !joinedRoom || !selectedTile) return;

      if (isGameplayActionBlocked()) return;

      const tileToPlay = selectedTile;
      const selectedMove = legalMoves.find(
        (m) =>
          m.type === 'play' &&
          m.tile &&
          m.position === position &&
          tileEquals(m.tile, tileToPlay),
      );
      if (!selectedMove) {
        emitDraggingState(false);
        setSelectedTile(null);
        setActionError('That tile cannot be played there.');
        return;
      }
      emitDraggingState(false);
      setPendingUiAction('play');
      pendingActionRef.current = true;
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
        pendingActionRef.current = false;
      }
    },
    [socket, joinedRoom, selectedTile, state, you, legalMoves, appendMultiplayerMove, emitDraggingState, showToast, flashLastPlayed, isGameplayActionBlocked],
  );

  // Derived state
  const currentTurnId = state?.playerIds[state.currentPlayerIndex] ?? null;
  const isMyTurn = currentTurnId === you;
  const authoritativeMyHand = state?.players[you]?.hand ?? [];
  const isHandActive = Boolean(state) && !state?.handOver && !state?.gameOver;
  const handForRenderBase = drawSequenceActive && drawStepActorId === you
    ? (drawStepMyHand ?? authoritativeMyHand)
    : authoritativeMyHand;
  const myHand = optimisticPlayedTile
    ? handForRenderBase.filter((t) => !tileEquals(t, optimisticPlayedTile))
    : handForRenderBase;

  if (import.meta.env.DEV && joinedRoom && state) {
    console.warn('[multiplayer-debug] App myHand derived JSON', JSON.stringify({
      you,
      playerIds: state.playerIds,
      playerKeys: Object.keys(state.players ?? {}),
      authoritativeMyHandLength: authoritativeMyHand.length,
      myHandLength: myHand.length,
      myHandSample: myHand[0] ?? null,
      playersShape: state.players,
      handCounts: state.handCounts ?? null,
    }, null, 2));
  }
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
  const [activeHomeMode, setActiveHomeMode] = useState<
    'multiplayer' | 'dailyFritz' | 'daily' | 'singlePlayerHub' | 'tournament' | 'learn'
  >('multiplayer');
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
  const isRoomHost = players[0]?.id === you;
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
    () =>
      isMyTurn &&
      roomRecoveryState === 'idle' &&
      !isRecoveringConnection &&
      !pendingActionRef.current &&
      pendingUiAction !== 'draw' &&
      pendingUiAction !== 'pass' &&
      pendingUiAction !== 'play'
        ? legalMoves
        : EMPTY_MOVES,
    [isMyTurn, legalMoves, roomRecoveryState, isRecoveringConnection, pendingUiAction],
  );
  const selectedTileHasLegalPlay = useMemo(
    () =>
      Boolean(
        selectedTile &&
          boardLegalMoves.some(
            (m) =>
              m.type === 'play' &&
              m.tile &&
              m.position &&
              tileEquals(m.tile, selectedTile),
          ),
      ),
    [boardLegalMoves, selectedTile],
  );
  const boardSelectedTile = useMemo(
    () => (selectedTileHasLegalPlay ? selectedTile : null),
    [selectedTileHasLegalPlay, selectedTile],
  );
  const boardShowOpenEndGlow = useMemo(
    () => Boolean(isMyTurn && opponentDragging),
    [isMyTurn, opponentDragging],
  );
  const handSelectedTile = useMemo(
    () => (selectedTileHasLegalPlay ? selectedTile : null),
    [selectedTileHasLegalPlay, selectedTile],
  );

  const handleTileTap = useCallback(
    (tile: Tile) => {
      if (
        !isMyTurn ||
        state?.handOver ||
        state?.gameOver ||
        roomRecoveryState !== 'idle' ||
        isRecoveringConnection ||
        pendingActionRef.current
      ) {
        return;
      }
      if (selectedTile && tileEquals(selectedTile, tile)) {
        setSelectedTile(null);
        emitDraggingState(false);
        return;
      }
      setSelectedTile(tile);
      emitDraggingState(true);
    },
    [isMyTurn, state?.handOver, state?.gameOver, roomRecoveryState, isRecoveringConnection, selectedTile, emitDraggingState],
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
    if (appMode !== 'multiplayer' || !authUser?.id) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    const showPrivateMatchLobby =
      (!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && Boolean(joinedRoom) && !state);
    if (!showPrivateMatchLobby) {
      setPrivateLobbyHostWinStreak(null);
      return;
    }
    let cancelled = false;
    void fetchUserStatsByUserId(authUser.id).then((res) => {
      if (cancelled) return;
      if (res.error || !res.data) {
        setPrivateLobbyHostWinStreak(null);
        return;
      }
      setPrivateLobbyHostWinStreak(res.data.currentWinStreak);
    });
    return () => {
      cancelled = true;
    };
  }, [appMode, authUser?.id, isConnected, isRecoveringConnection, joinedRoom, state]);

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
    let cancelled = false;
    const baselineRating = multiplayerRatingBaseline;
    const retryDelaysMs = [0, 700, 1400, 2400, 3600, 5200];

    void (async () => {
      try {
        for (let i = 0; i < retryDelaysMs.length; i += 1) {
          const delayMs = retryDelaysMs[i];
          if (delayMs > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, delayMs));
          }
          if (cancelled) return;

          try {
            await Promise.resolve(refreshAuthProfile());
          } catch (err) {
            console.warn('[Multiplayer Rating] profile refresh failed:', err);
          }

          if (cancelled) return;
          const latestRating = authProfileRef.current?.glicko_rating;
          if (
            latestRating != null &&
            (baselineRating == null || Number(latestRating) !== baselineRating || i === retryDelaysMs.length - 1)
          ) {
            return;
          }
        }
      } finally {
        if (!cancelled) {
          setMultiplayerRatingPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authUser,
    isSpectatingMatch,
    isTournamentMatch,
    joinedRoom,
    multiplayerRatingBaseline,
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
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      
      // Split into two rows if hand is large
      const forceTwoRows = tileCount > 9;
      
      // Shrink tiles if hand is large or in mobile landscape
      const maxTileSize = (isLandscape && isMobileWidth) ? 42 : (tileCount > 9 ? 46 : 56);
      let tileWidth = maxTileSize;
      
      // Calculate available width for hand
      const containerWidth = trayCenterRef.current?.offsetWidth ?? window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      
      // Dynamic tile width based on available space
      tileWidth = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
      
      const trayHeight = forceTwoRows ? 138 : (isLandscape && isMobileWidth ? 70 : 120);
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
    const readyHandNumber = handReveal?.handNumber ?? state?.handNumber;
    if (socket && joinedRoom) {
      emitWithAck(socket, 'hand:ready', joinedRoom, readyHandNumber).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[hand:ready] failed:', error instanceof Error ? error.message : error);
        }
      });
    }
    setHandReveal(null);
  }, [socket, joinedRoom, handReveal?.handNumber, state?.handNumber]);

  // Recover lost hand:ready on reconnect — if the server says the hand is over but
  // we're not in a reveal window, the hand:ready was lost during disconnect. Re-emit it.
  const handReadyRecoveryRef = useRef(false);
  useEffect(() => {
    const needsReady =
      Boolean(state?.handOver) &&
      !state?.gameOver &&
      !handReveal &&
      handRevealShownRef.current !== state?.handNumber &&
      Boolean(joinedRoom) &&
      socket?.connected;
    if (!needsReady) {
      handReadyRecoveryRef.current = false;
      return;
    }
    if (handReadyRecoveryRef.current) return;
    handReadyRecoveryRef.current = true;
    if (import.meta.env.DEV) {
      console.log('[hand:ready] recovering lost hand:ready signal after reconnect');
    }
    emitWithAck(socket!, 'hand:ready', joinedRoom!, state?.handNumber).catch((error) => {
      handReadyRecoveryRef.current = false;
      showToast('Could not signal hand ready. Reconnecting…', 2500);
      if (import.meta.env.DEV) {
        console.warn('[hand:ready] recovery failed:', error instanceof Error ? error.message : error);
      }
    });
  }, [state?.handOver, state?.gameOver, state?.handNumber, handReveal, joinedRoom, socket]);

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
    if (
      !handActive ||
      !isMyTurn ||
      hasPlayMoves ||
      drawSequenceActive ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      pendingActionRef.current
    ) {
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
  }, [state, isMyTurn, hasPlayMoves, canDrawNow, canPass, myHand.length, boneyardCount, draw, pass, drawSequenceActive, roomRecoveryState, isRecoveringConnection]);

  useEffect(() => {
    if (!state) {
      frozenHandOverBoardRef.current = null;
      return;
    }

    if (state.board) {
      frozenHandOverBoardRef.current = {
        handNumber: state.handNumber,
        board: state.board,
      };
      return;
    }

    if (!state.handOver) {
      frozenHandOverBoardRef.current = null;
    }
  }, [state]);

  const boardForDisplay = useMemo(() => {
    if (state?.board) return state.board;
    const frozenBoard = frozenHandOverBoardRef.current;
    if (state?.handOver && frozenBoard && frozenBoard.handNumber === state.handNumber) {
      return frozenBoard.board;
    }
    return null;
  }, [state]);

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

  // Join a tournament room by code — hoisted so effects and render both use it.
  const joinTournamentRoom = useCallback((code: string) => {
    setRoomCode(code);
    if (socket?.connected) {
      socket.emit(
        'room:join',
        code.trim().toUpperCase(),
        {
          username: authProfile?.username ?? 'Guest',
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        },
        (resp: { ok: boolean; error?: string } & Record<string, unknown>) => {
          if (resp?.ok) applyJoinedRoomResponse(resp);
          else showToast(resp?.error ?? 'Could not join tournament match.', 2500);
        },
      );
    }
  }, [socket, authProfile?.username, multiplayerIdentityUserId, multiplayerAuthToken, applyJoinedRoomResponse, showToast]);

  // Drain a pending tournament:match_ready signal — auto-join the reserved room.
  // Must be an effect (not render-path logic) so React StrictMode double-invoke
  // doesn't clear the pending match before it can be acted on.
  useEffect(() => {
    if (!tournament.pendingMatch) return;
    const p = tournament.pendingMatch;
    setActiveTournamentId(p.tournamentId);
    if (p.roomCode) joinTournamentRoom(p.roomCode);
    tournament.clearPendingMatch();
  }, [tournament.pendingMatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load bracket when the result screen is shown without a prior bracket visit.
  useEffect(() => {
    if (tournamentSubView === 'result' && activeTournamentId && !tournament.activeBracket) {
      void tournament.openBracket(activeTournamentId);
    }
  }, [tournamentSubView, activeTournamentId, tournament.activeBracket, tournament.openBracket]);

  // ─── Render ───────────────────────────────────────────────
  const appRootClassName = 'app large-mode';
  const showLearnAdminView = (() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('learnAdmin')?.trim().toLowerCase();
      return raw === '1' || raw === 'true' || raw === 'yes';
    } catch {
      return false;
    }
  })();

  if (typeof window !== 'undefined' && (window.location.pathname === '/redesign' || window.location.pathname === '/') && appMode === 'home') {
    return (
      <>
        <RacehorseHomeScreen
          setAppMode={setAppMode}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenAccount={() => setUsernameModalOpen(true)}
        />
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
            isProfileEdit={usernameModalOpen}
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
                setUsernameModalOpen(false);
                setOnboardingDismissed(false);
                setAuthModalOpen(true);
              }
            }}
            signingOut={signingOut}
          />
        </Suspense>
      </>
    );
  }

  if (appMode === 'noBrainer') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading No Brainer Lab…" />}>
          <NoBrainerLabScreen
            userId={authUser?.id ?? null}
            onBack={() => setAppMode('singlePlayerHub')}
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
            showAdminView={Boolean(isAdmin && showLearnAdminView)}
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
          <PlayVsFritz
            onStart={({ difficulty, dealSize }) => {
              setBotFritzTier(difficulty);
              setBotDealSize(dealSize);
              setAppMode('bot');
            }}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
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
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
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
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
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
            onOpenAccount={() => setUsernameModalOpen(true)}
            onBack={() => setAppMode('home')}
            onNavigate={setAppMode}
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

  if (appMode === 'friends') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Friends…" />}>
          <FriendsScreen
            open={true}
            user={authUser}
            socket={socket}
            joinedRoom={joinedRoom}
            currentUsername={authProfile?.username ?? ''}
            showToast={showToast}
            onCopyInviteLink={copyInviteLink}
            onCreatePrivateRoom={onCreatePrivateRoom}
            onClose={() => setAppMode('home')}
            onViewProfile={(username) => { setProfileTarget(username); setAppMode('profile'); }}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'stats') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Stats…" />}>
          <StatsScreen
            open={true}
            user={authUser}
            profile={authProfile}
            onClose={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'feed') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Feed…" />}>
          <ActivityFeedScreen
            user={authUser}
            onViewProfile={(username) => { setProfileTarget(username); setAppMode('profile'); }}
            onClose={() => setAppMode('home')}
            onNavigateToFriends={() => setAppMode('friends')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'leaderboard') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Leaderboard…" />}>
          <LeaderboardScreen
            user={authUser}
            onViewProfile={(username) => { setProfileTarget(username); setAppMode('profile'); }}
            onClose={() => setAppMode('home')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'profile') {
    return (
      <div className={appRootClassName}>
        <Suspense fallback={<ScreenLoader label="Loading Profile…" />}>
          <PublicProfileScreen
            username={profileTarget ?? ''}
            user={authUser}
            showToast={showToast}
            onClose={() => setAppMode('home')}
            onChallenge={() => setAppMode('multiplayer')}
          />
        </Suspense>
      </div>
    );
  }

  if (appMode === 'singlePlayerHub') {
    return (
      <div className={appRootClassName}>
        <SinglePlayerHubScreen
          userId={authUser?.id ?? null}
          onBack={() => setAppMode('home')}
          onNavigate={(mode) => setAppMode(mode as any)}
        />
      </div>
    );
  }
  if (appMode === 'tournament') {
    const tIdentity = authUser?.id
      ? { userId: authUser.id, username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player' }
      : null;
    // Auto-route to result screen for a tournament we care about.
    if (completedTournamentId) {
      const ours =
        completedTournamentId === activeTournamentId ||
        tournament.registrations.some(
          (r) => r.tournament_id === completedTournamentId && (r.status === 'active' || r.status === 'winner'),
        );
      if (ours) {
        setActiveTournamentId(completedTournamentId);
        setTournamentSubView('result');
      }
      setCompletedTournamentId(null);
    }

    // Reference legacy screen so the import isn't flagged as unused.
    void TournamentScreen;

    if (tournamentSubView === 'bracket' && activeTournamentId) {
      return (
        <TournamentBracketScreen
          identity={tIdentity}
          tournamentId={activeTournamentId}
          bracket={tournament.activeBracket}
          onLoadBracket={(id) => { void tournament.openBracket(id); }}
          onBack={() => setTournamentSubView('hub')}
          onNavigate={setAppMode}
          onJoinMatch={joinTournamentRoom}
        />
      );
    }

    if (tournamentSubView === 'result' && activeTournamentId) {
      // Derive live champion + your-placement from the active bracket view.
      const bracket =
        tournament.activeBracket?.tournament.id === activeTournamentId
          ? tournament.activeBracket
          : null;
      const final = bracket?.matches.find((m) => m.round === 3) ?? null;
      const championId = final?.winner_id ?? null;
      const championReg = championId
        ? bracket?.registrations.find((r) => r.user_id === championId) ?? null
        : null;
      const championName = championReg?.username ?? null;

      const myUserId = authUser?.id ?? null;
      let yourPlacement: string | null = null;
      if (myUserId && bracket) {
        const myReg = bracket.registrations.find((r) => r.user_id === myUserId);
        if (myReg?.status === 'winner') yourPlacement = 'Champion';
        else if (final?.player1_id === myUserId || final?.player2_id === myUserId) {
          yourPlacement = 'Runner-up';
        } else if (
          bracket.matches.some(
            (m) => m.round === 2 && (m.player1_id === myUserId || m.player2_id === myUserId),
          )
        ) {
          yourPlacement = 'Semifinalist';
        } else if (
          bracket.matches.some(
            (m) => m.round === 1 && (m.player1_id === myUserId || m.player2_id === myUserId),
          )
        ) {
          yourPlacement = 'Quarterfinalist';
        }
      }

      const nextSlot = tournament.upcoming[0];
      const nextCountdown = nextSlot
        ? (() => {
            const ms = Math.max(0, Date.parse(nextSlot.scheduled_start) - Date.now());
            const total = Math.floor(ms / 1000);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = (n: number) => String(n).padStart(2, '0');
            return `${pad(h)}:${pad(m)}:${pad(s)}`;
          })()
        : '—';

      return (
        <TournamentResultScreen
          championName={championName}
          yourPlacement={yourPlacement}
          nextTournamentCountdown={nextCountdown}
          onBack={() => {
            setTournamentSubView('hub');
            setActiveTournamentId(null);
          }}
        />
      );
    }

    return (
      <TournamentHubScreen
        identity={tIdentity}
        upcoming={tournament.upcoming}
        registrations={tournament.registrations}
        error={tournament.error}
        onNavigate={setAppMode}
        onOpenAuth={() => setAuthModalOpen(true)}
        onBackHome={() => setAppMode('home')}
        onOpenBracket={(id) => {
          setActiveTournamentId(id);
          setTournamentSubView('bracket');
        }}
        onRegister={(id) => tournament.register(id)}
        onWithdraw={(id) => tournament.withdraw(id)}
      />
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
        <div className="layout-screen screen lobby-screen mode-home-screen mode-accent-multiplayer home-lobby-screen claude-home-shell claude-home-screen-shell">
          <div className="layout-screen-bg" aria-hidden="true" />
          <div className="layout-screen-beam" aria-hidden="true" />
          <div className="layout-screen-vignette" aria-hidden="true" />
          <div className="layout-screen-inner home-lobby-shell">
            <div className="claude-accordion-home">
              <div className="claude-accordion-home__topbar">
                <div className="claude-accordion-home__brand">RACEHORSE</div>
                <div className="claude-accordion-home__utilities">
                  {authUser ? (
                    <button className="claude-accordion-home__utility" onClick={() => setUsernameModalOpen(true)}>
                      {myHandle} · {homeRatingLabel}
                    </button>
                  ) : (
                    <button className="claude-accordion-home__utility" onClick={() => setAuthModalOpen(true)}>
                      Sign In · Profile
                    </button>
                  )}
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('friends')}>
                    Friends
                  </button>
                  <button className="claude-accordion-home__utility is-secondary" onClick={() => setAppMode('stats')}>
                    Stats
                  </button>
                </div>
              </div>
              <div className="claude-accordion-home__body">
                {[
                  { id: 'multiplayer', short: 'MULTI', label: 'Multiplayer Online', desc: 'Create a private room and play head to head in real time', accent: '#38bdf8', live: true, action: () => setAppMode('multiplayer') },
                  { id: 'singlePlayerHub', short: 'SOLO', label: 'Single Player Modes', desc: 'Play vs Fritz, Ghost Mode & No Brainer Lab', accent: '#a78bfa', action: () => setAppMode('singlePlayerHub') },
                  { id: 'dailyFritz', short: 'FRITZ', label: 'Daily Fritz Set', desc: 'One fixed best-of-3 Fritz set per day. Same deals for everyone.', accent: '#e05c6a', action: () => setAppMode('dailyFritz') },
                  { id: 'daily', short: 'PUZZLE', label: 'Daily Puzzle', desc: 'Solve today’s featured scenario and compare leaderboard results', accent: '#f0c040', action: () => setAppMode('daily') },
                  { id: 'tournament', short: 'TOURN', label: 'Tournament Mode', desc: 'Round robin (4+ players), matches to 30, play everyone once', accent: '#fb923c', action: () => { setError(''); setAppMode('tournament'); } },
                  { id: 'learn', short: 'LEARN', label: 'Learn Academy', desc: 'New to dominoes? Learn how to play and win.', accent: '#34d399', action: () => setAppMode('learn') },
                ].map((mode, index, all) => {
                  const isActive = activeHomeMode === mode.id;
                  const hasActive = activeHomeMode !== null;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className={`claude-accordion-home__panel${isActive ? ' is-active' : ''}${hasActive ? ' has-active' : ''}`}
                      style={{ ['--panel-accent' as string]: mode.accent, ['--panel-accent-rgb' as string]: claudeRgb(mode.accent), borderRight: index < all.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
                      onMouseEnter={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onFocus={() => setActiveHomeMode(mode.id as typeof activeHomeMode)}
                      onClick={mode.action}
                    >
                      <div className="claude-accordion-home__panel-atmo" />
                      <div className="claude-accordion-home__big-number">{index + 1}</div>
                      {mode.live ? <div className="claude-accordion-home__live">LIVE</div> : null}
                      <div className="claude-accordion-home__panel-content">
                        <div className="claude-accordion-home__mode-number">MODE {String(index + 1).padStart(2, '0')}</div>
                        <div className="claude-accordion-home__mode-title">{mode.label}</div>
                        <div className="claude-accordion-home__mode-desc">{mode.desc}</div>
                        <div className="claude-accordion-home__enter">Enter</div>
                      </div>
                      <div className="claude-accordion-home__collapsed">
                        <div className="claude-accordion-home__collapsed-label">{mode.short}</div>
                      </div>
                    </button>
                  );
                })}
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
            isProfileEdit={usernameModalOpen}
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
                setUsernameModalOpen(false);
                setOnboardingDismissed(false);
                setAuthModalOpen(true);
              }
            }}
            signingOut={signingOut}
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

      {(!isConnected && !isRecoveringConnection) ||
      (isConnected && !joinedRoom) ||
      (isConnected && joinedRoom && !state) ? (
        mpSubView === 'quick' && !joinedRoom ? (
          <MatchmakingScreen
            socket={socket}
            isConnected={isConnected}
            isConnecting={isConnecting}
            serverUrl={serverUrl}
            onRetryConnect={connect}
            identity={
              authUser?.id
                ? {
                    userId: authUser.id,
                    username: authProfile?.username ?? authUser.email?.split('@')[0] ?? 'player',
                  }
                : null
            }
            myRating={
              authProfile?.glicko_rating != null
                ? Math.round(Number(authProfile.glicko_rating))
                : null
            }
            myWinStreak={privateLobbyHostWinStreak}
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onBackHome={() => setAppMode('home')}
            onOpenPrivateMatch={() => setMpSubView('private')}
            onAutoJoinRoom={(payload) => handleMatchmakingAutoJoin(payload.roomCode)}
            onPlayBotFallback={() => setAppMode('botSetup')}
          />
        ) : (
          <PrivateMatchLobbyScreen
            phase={
              !isConnected && !isRecoveringConnection
                ? 'disconnected'
                : isConnected && !joinedRoom
                  ? 'lobby'
                  : 'room'
            }
            onNavigate={setAppMode}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOpenAccount={() => setUsernameModalOpen(true)}
            onBackHome={() => {
              setMpSubView('quick');
              setAppMode('home');
            }}
            isConnecting={isConnecting}
            serverWaking={serverWaking}
            serverUrl={serverUrl}
            onConnect={connect}
            roomCode={roomCode}
            onRoomCodeChange={setRoomCode}
            onCreateRoom={createRoom}
            onJoinRoom={joinRoom}
            pendingLobbyAction={
              pendingUiAction === 'create' || pendingUiAction === 'join' ? pendingUiAction : null
            }
            joinedRoom={joinedRoom ?? ''}
            players={players}
            you={you}
            isRoomHost={isRoomHost}
            onLeaveRoom={leavePrivateLobbyRoom}
            onStartGame={startGame}
            pendingStart={pendingUiAction === 'start'}
            onCopyInviteLink={copyInviteLink}
            onCopyRoomCode={copyRoomCodeToClipboard}
            myRating={
              authProfile?.glicko_rating != null ? Math.round(Number(authProfile.glicko_rating)) : null
            }
            myUsername={authProfile?.username ?? null}
            roomChatFeed={roomReactions}
            onSendRoomChat={sendRoomChat}
            winTarget={60}
            roomRecoveryState={roomRecoveryState}
            roomRecoveryMessage={roomRecoveryMessage}
            onRetryRoomRecovery={retryRoomRecovery}
            hostWinStreak={privateLobbyHostWinStreak}
            onOpenQuickMatch={() => setMpSubView('quick')}
            socket={socket}
          />
        )
      ) : null}

      {/* Game Screen */}
      {(isConnected || isRecoveringConnection) && joinedRoom && state && (
        <>
          {tournamentMatch ? (
            <TournamentMatchBanner
              round={tournamentMatch.round}
              opponentName={tournamentMatch.opponentUsername}
              opponentRating={tournamentMatch.opponentRating}
            />
          ) : null}
          <RotateOverlay />
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
            <div className="game-over-overlay hand-over-upgraded-overlay">
              <div className="game-over-card hand-over-upgraded-card hand-over--mp">
                {(() => {
                  const youPoints = handReveal.pointsAwarded.you;
                  const opponentPoints = handReveal.pointsAwarded.opponent;
                  const winner =
                    youPoints > opponentPoints ? 'you' : opponentPoints > youPoints ? 'opponent' : 'none';
                  const pointsAwarded = Math.max(youPoints, opponentPoints, 0);
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
                  const scoredTiles =
                    winner === 'you'
                      ? handReveal.opponentRemainingTiles
                      : winner === 'opponent'
                        ? handReveal.yourRemainingTiles
                        : [...handReveal.yourRemainingTiles, ...handReveal.opponentRemainingTiles];
                  const scoredPips = scoredTiles.reduce((sum, tile) => sum + tile.low + tile.high, 0);
                  const summarySentence =
                    youWentOut
                      ? `You cleared your hand. ${oppCount} remaining pips rounded to ${pointsAwarded} point${pointsAwarded === 1 ? '' : 's'}.`
                      : oppWentOut
                        ? `${opponentName} cleared their hand. ${yourCount} remaining pips rounded to ${pointsAwarded} point${pointsAwarded === 1 ? '' : 's'}.`
                        : `Hand ended blocked. ${scoredPips} remaining pips rounded to ${pointsAwarded} point${pointsAwarded === 1 ? '' : 's'}.`;

                  return (
                    <>
                      <div className="hand-over-premium-header">
                        <div className="hand-over-premium-title-group">
                          <span className="hand-over-premium-kicker">Hand Complete</span>
                          <h3 className="hand-over-premium-title">Hand Over</h3>
                        </div>
                        <div className="hand-over-premium-score-group">
                          <div className="hand-over-premium-score">+{pointsAwarded}</div>
                          <div className="hand-over-premium-score-label">POINT{pointsAwarded === 1 ? '' : 'S'} AWARDED</div>
                        </div>
                      </div>

                      <p className="hand-over-premium-sentence">
                        {summarySentence}
                      </p>

                      <div className="hand-over-premium-metadata">
                        <div className="hand-over-premium-meta-block">
                          <span className="hand-over-premium-meta-label">WINNER</span>
                          <span className="hand-over-premium-meta-value">{winner === 'you' ? 'You' : winner === 'opponent' ? opponentName : 'Tie'}</span>
                        </div>
                        <div className="hand-over-premium-meta-divider" />
                        <div className="hand-over-premium-meta-block">
                          <span className="hand-over-premium-meta-label">{winner === 'you' ? 'OPP. PIPS' : winner === 'opponent' ? 'YOUR PIPS' : 'TOTAL PIPS'}</span>
                          <span className="hand-over-premium-meta-value">{winner === 'you' ? scoredPips : winner === 'opponent' ? scoredPips : scoredPips}</span>
                        </div>
                        <div className="hand-over-premium-meta-divider" />
                        <div className="hand-over-premium-meta-block">
                          <div className="hand-over-premium-meta-user-group">
                            <span className="hand-over-premium-meta-handle">@{winner === 'you' ? opponentName.toUpperCase() : 'YOU'}</span>
                            <div className="hand-over-premium-tile-preview">
                              {scoredTiles.slice(0, 2).map((tile, idx) => (
                                <DominoTile key={idx} tile={tile} size={40} />
                              ))}
                              {scoredTiles.length > 2 && (
                                <div className="hand-over-tile-more">+{scoredTiles.length - 2}</div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                <div className="hand-over-premium-footer">
                  <span className="hand-over-premium-next-label">Next hand starting...</span>
                  <div className="hand-over-premium-progress-track">
                    <div
                      className="hand-over-premium-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(1, handRevealAutoProgress)) * 100}%` }}
                    />
                  </div>
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
                display: isHandActive ? 'flex' : 'none',
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
                  left: 'calc(100% + 12px)',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  height: '45px',
                  lineHeight: 1,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 999,
                  padding: '0 18px',
                  fontSize: '1.4rem',
                  color: 'rgba(232,245,240,0.85)',
                  fontWeight: 600,
                }}
              >
                <span style={{ fontSize: '1.6rem' }}>{openEndsSum}</span>
                <span style={{ fontSize: '1.0rem', opacity: 0.7, letterSpacing: '0.02em', textTransform: 'uppercase' }}>open</span>
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
            <MatchNblBoardFrame>
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
                board={boardForDisplay}
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
            </MatchNblBoardFrame>
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
                  </>
                  )}

      <Suspense fallback={null}>
        <GameReviewer
          open={analyzerOpen}
          onClose={() => setAnalyzerOpen(false)}
          analysis={currentAnalysis}
          title="Game Review"
        />
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
          isProfileEdit={usernameModalOpen}
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
              setUsernameModalOpen(false);
              setOnboardingDismissed(false);
              setAuthModalOpen(true);
            }
          }}
          signingOut={signingOut}
        />
      </Suspense>
      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={() => setShowLeaveConfirm(false)}
          onLeave={() => {
            setShowLeaveConfirm(false);
            disconnect('user leave game');
          }}
        />
      )}
    </div>
  );
}
