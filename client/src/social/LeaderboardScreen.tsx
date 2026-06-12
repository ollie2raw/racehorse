import { useEffect, useState, useCallback } from 'react';
import type { User } from '@supabase/supabase-js';
import {
  fetchFriendsLeaderboard,
  fetchGlobalLeaderboard,
  fetchWeeklyLeaderboard,
  fetchModeLeaderboard,
  type LeaderboardEntry,
  type GlobalLeaderboardEntry,
  type WeeklyLeaderboardEntry,
  type ModeLeaderboardEntry,
} from './socialApi';
import './leaderboard.css';

type Tab = 'global' | 'friends' | 'weekly' | 'mode';
type GameMode = 'online' | 'bot' | 'ghost';

interface LeaderboardScreenProps {
  user: User | null;
  onViewProfile: (username: string) => void;
  onClose: () => void;
}

const MEDAL_COLORS = ['#E7B64A', '#94A3B8', '#C97B3F'] as const;
const GAME_MODES: { id: GameMode; label: string }[] = [
  { id: 'online', label: 'Ranked' },
  { id: 'bot', label: 'vs Bot' },
  { id: 'ghost', label: 'Ghost' },
];

function ratingTier(rating: number, provisional: boolean): { label: string; color: string } {
  if (provisional) return { label: 'Prov', color: 'var(--text-dim)' };
  if (rating >= 1600) return { label: 'Master', color: 'var(--tier-master)' };
  if (rating >= 1300) return { label: 'Elite', color: 'var(--tier-elite)' };
  if (rating >= 1000) return { label: 'Standard', color: 'var(--tier-standard)' };
  return { label: 'Rookie', color: 'var(--tier-rookie)' };
}

function initials(username: string): string {
  const parts = username.replace(/[^a-zA-Z0-9]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

function TrendArrow({ winsThisWeek }: { winsThisWeek: number }) {
  if (winsThisWeek >= 5) return <span className="rh-lb-trend rh-lb-trend--up" title={`${winsThisWeek} wins this week`}>↑</span>;
  if (winsThisWeek > 0) return <span className="rh-lb-trend rh-lb-trend--mid" title={`${winsThisWeek} wins this week`}>→</span>;
  return <span className="rh-lb-trend rh-lb-trend--down" title="No wins this week">↓</span>;
}

interface GenericRow {
  rank: number;
  username: string;
  is_self: boolean;
  glicko_rating: number;
  provisional: boolean;
  secondary: string;
  win_rate?: number;
  wins_this_week?: number;
}

function RankedRow({
  row,
  showWinRate,
  showTrend,
  onViewProfile,
}: {
  row: GenericRow;
  showWinRate: boolean;
  showTrend: boolean;
  onViewProfile: (u: string) => void;
}) {
  const tier = ratingTier(row.glicko_rating, row.provisional);
  const medalColor = row.rank <= 3 ? MEDAL_COLORS[row.rank - 1] : null;
  return (
    <button
      className={`rh-lb-row${row.is_self ? ' rh-lb-row--self' : ''}`}
      style={medalColor ? { borderLeftColor: medalColor } : undefined}
      onClick={() => onViewProfile(row.username)}
    >
      <span className="rh-lb-rank" style={medalColor ? { color: medalColor } : undefined}>
        #{row.rank}
      </span>
      <span className="rh-lb-avatar" aria-hidden>
        {initials(row.username)}
      </span>
      <span className="rh-lb-username">
        {row.username}
        {row.is_self && <span className="rh-lb-you"> YOU</span>}
      </span>
      <span className="rh-lb-tier" style={{ color: tier.color }}>{tier.label}</span>
      <span className="rh-lb-rating">{Math.round(row.glicko_rating).toLocaleString()}</span>
      {showWinRate && (
        <span className="rh-lb-winrate">
          {row.win_rate !== undefined ? `${row.win_rate.toFixed(1)}%` : '—'}
        </span>
      )}
      {showTrend && row.wins_this_week !== undefined && (
        <TrendArrow winsThisWeek={row.wins_this_week} />
      )}
      {!showWinRate && !showTrend && (
        <span className="rh-lb-games">{row.secondary}</span>
      )}
    </button>
  );
}

export default function LeaderboardScreen({ user, onViewProfile, onClose }: LeaderboardScreenProps) {
  const [tab, setTab] = useState<Tab>('global');
  const [gameMode, setGameMode] = useState<GameMode>('online');

  const [globalData, setGlobalData] = useState<{ leaderboard: GlobalLeaderboardEntry[]; self: GlobalLeaderboardEntry | null } | null>(null);
  const [friendsData, setFriendsData] = useState<LeaderboardEntry[] | null>(null);
  const [weeklyData, setWeeklyData] = useState<{ leaderboard: WeeklyLeaderboardEntry[]; self: WeeklyLeaderboardEntry | null } | null>(null);
  const [modeData, setModeData] = useState<Partial<Record<GameMode, { leaderboard: ModeLeaderboardEntry[]; self: ModeLeaderboardEntry | null }>>>({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    if (tab === 'global' && globalData) return;
    if (tab === 'friends' && friendsData) return;
    if (tab === 'weekly' && weeklyData) return;
    if (tab === 'mode' && modeData[gameMode]) return;

    setLoading(true);
    setError(null);

    if (tab === 'global') {
      const r = await fetchGlobalLeaderboard();
      setLoading(false);
      if (r.error) { setError(r.error); return; }
      setGlobalData({ leaderboard: r.leaderboard, self: r.self });
    } else if (tab === 'friends') {
      const r = await fetchFriendsLeaderboard();
      setLoading(false);
      if (r.error) { setError(r.error); return; }
      setFriendsData(r.leaderboard);
    } else if (tab === 'weekly') {
      const r = await fetchWeeklyLeaderboard();
      setLoading(false);
      if (r.error) { setError(r.error); return; }
      setWeeklyData({ leaderboard: r.leaderboard, self: r.self });
    } else {
      const r = await fetchModeLeaderboard(gameMode);
      setLoading(false);
      if (r.error) { setError(r.error); return; }
      setModeData((prev) => ({ ...prev, [gameMode]: { leaderboard: r.leaderboard, self: r.self } }));
    }
  }, [user, tab, gameMode, globalData, friendsData, weeklyData, modeData]);

  useEffect(() => { void load(); }, [load]);

  const rows: GenericRow[] = (() => {
    if (tab === 'global') {
      return (globalData?.leaderboard ?? []).map((e) => ({
        rank: e.global_rank,
        username: e.username,
        is_self: e.is_self,
        glicko_rating: e.glicko_rating,
        provisional: e.provisional,
        secondary: `${e.ranked_games_played} games`,
      }));
    }
    if (tab === 'friends') {
      return (friendsData ?? []).map((e) => ({
        rank: e.rank_in_friends,
        username: e.username,
        is_self: e.is_self,
        glicko_rating: e.glicko_rating,
        provisional: e.provisional,
        secondary: `${e.ranked_games_played} games`,
        win_rate: e.win_rate,
      }));
    }
    if (tab === 'weekly') {
      return (weeklyData?.leaderboard ?? []).map((e) => ({
        rank: e.rank,
        username: e.username,
        is_self: e.is_self,
        glicko_rating: e.glicko_rating,
        provisional: e.provisional,
        secondary: `${e.wins_this_week}W this week`,
        wins_this_week: e.wins_this_week,
      }));
    }
    return (modeData[gameMode]?.leaderboard ?? []).map((e) => ({
      rank: e.rank,
      username: e.username,
      is_self: e.is_self,
      glicko_rating: e.glicko_rating,
      provisional: e.provisional,
      secondary: `${e.wins}W (90d)`,
    }));
  })();

  const selfRow: GenericRow | undefined = rows.find((r) => r.is_self);

  return (
    <div className="rh-lb-screen">
      <div className="rh-lb-header">
        <button className="rh-lb-back" onClick={onClose} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="rh-lb-title-block">
          <h1 className="rh-lb-title">Leaderboard</h1>
          <p className="rh-lb-subtitle">Beta — standings may lag briefly after matches</p>
        </div>
        <div className="rh-lb-tabs">
          {(['global', 'friends', 'weekly', 'mode'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`rh-lb-tab${tab === t ? ' rh-lb-tab--active' : ''}`}
              onClick={() => { setTab(t); setError(null); }}
            >
              {t === 'global' ? 'Global' : t === 'friends' ? 'Friends' : t === 'weekly' ? 'Weekly' : 'By Mode'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'mode' && (
        <div className="rh-lb-mode-bar">
          {GAME_MODES.map((m) => (
            <button
              key={m.id}
              className={`rh-lb-mode-btn${gameMode === m.id ? ' rh-lb-mode-btn--active' : ''}`}
              onClick={() => { setGameMode(m.id); setError(null); }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="rh-lb-content">
        {loading && <div className="rh-lb-state"><span className="rh-lb-state-text">Loading…</span></div>}
        {!loading && error && <div className="rh-lb-state"><span className="rh-lb-state-text rh-lb-error">{error}</span></div>}
        {!loading && !error && rows.length === 0 && (
          <div className="rh-lb-state">
            <span className="rh-lb-state-text">
              {tab === 'friends' ? 'Add friends to see your friends leaderboard.' :
               tab === 'weekly' ? 'No ranked games this week yet.' :
               tab === 'mode' ? 'No games in this mode yet.' :
               'No ranked players yet.'}
            </span>
          </div>
        )}
        {!loading && !error && rows.length > 0 && (
          <div className="rh-lb-list">
            {rows.map((row) => (
              <RankedRow
                key={row.username}
                row={row}
                showWinRate={tab === 'friends'}
                showTrend={tab === 'weekly'}
                onViewProfile={onViewProfile}
              />
            ))}
          </div>
        )}
      </div>

      {selfRow && (
        <div className="rh-lb-self-pin">
          <div className="rh-lb-self-pin-inner">
            <span className="rh-lb-rank" style={{ color: 'var(--tier-standard)' }}>#{selfRow.rank}</span>
            <span className="rh-lb-avatar" aria-hidden>{initials(selfRow.username)}</span>
            <span className="rh-lb-username">{selfRow.username} <span className="rh-lb-you">YOU</span></span>
            <span className="rh-lb-tier" style={{ color: ratingTier(selfRow.glicko_rating, selfRow.provisional).color }}>
              {ratingTier(selfRow.glicko_rating, selfRow.provisional).label}
            </span>
            <span className="rh-lb-rating">{Math.round(selfRow.glicko_rating).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
