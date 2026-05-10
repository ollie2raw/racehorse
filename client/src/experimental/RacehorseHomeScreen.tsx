import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { DominoTile, BrandLogo } from '../components';
import type { Tile } from '../types';
import { useAuth } from '../auth/useAuth';
import { fetchFriends } from '../friends/friendsApi';
import { getTodayDailyFritz } from '../dailyFritz/api';
import { getTodayDailyPuzzleLadder } from '../dailyPuzzle/api';
import { supabase } from '../lib/supabase';
import './RacehorseHomeArt.css';

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
  | 'league'
  | 'learn'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'tournament';

const WEEK_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** Returns a local YYYY-MM-DD string (avoids UTC-shift bugs from toISOString). */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Builds the 7-day week strip from actual Supabase play dates.
 * Days not in `playedDates` show as empty — no fake checkmarks.
 */
function computeStreakDays(playedDates: Set<string>) {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const todayIdx = dow === 0 ? 6 : dow - 1; // 0=Mon … 6=Sun

  return WEEK_LABELS.map((label, i) => {
    if (i > todayIdx) return { label, state: 'future' as const };
    if (i === todayIdx) return { label, state: 'today' as const };

    // Past day this week — check if actually played
    const d = new Date(today);
    d.setDate(today.getDate() - (todayIdx - i));
    return {
      label,
      state: playedDates.has(localDateStr(d)) ? ('done' as const) : ('future' as const),
    };
  });
}

const tabs: { label: string; color: string; icon: 'robot' | 'users' | 'ghost' | 'cap' | 'trophy'; mode: AppMode }[] = [
  { label: 'Play vs Fritz', color: '#C8922A', icon: 'robot', mode: 'botSetup' },
  { label: 'Multiplayer', color: '#4A8FD4', icon: 'users', mode: 'multiplayer' },
  { label: 'Ghost Mode', color: '#8B5CF6', icon: 'ghost', mode: 'ghostSetup' },
  { label: 'Learn', color: '#10B981', icon: 'cap', mode: 'learn' },
  { label: 'Tournament', color: '#F59E0B', icon: 'trophy', mode: 'tournament' },
];

function TabIcon({ icon, color, size = 22 }: { icon: (typeof tabs)[number]['icon']; color: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
  } as const;

  if (icon === 'robot') {
    return (
      <svg {...common}>
        {/* Head */}
        <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" stroke={color} strokeWidth="1.7" />
        {/* Eyes */}
        <circle cx="9" cy="12.5" r="1.6" fill={color} />
        <circle cx="15" cy="12.5" r="1.6" fill={color} />
        {/* Mouth */}
        <path d="M9.5 16h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        {/* Antenna stem */}
        <path d="M12 7.5V5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
        {/* Antenna tip */}
        <circle cx="12" cy="4.2" r="1.2" fill={color} />
      </svg>
    );
  }

  if (icon === 'users') {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="2.4" stroke={color} strokeWidth="1.8" />
        <circle cx="15.5" cy="10" r="2.1" stroke={color} strokeWidth="1.8" />
        <path d="M4.7 18c1-2.4 3-3.8 5.9-3.8 2.4 0 4.1.9 5.2 2.8" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
        <path d="M14.7 14.8c1.8 0 3.3.8 4.3 2.4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === 'ghost') {
    return (
      <svg {...common}>
        <path
          d="M7 18v-7c0-3 2.2-5 5-5s5 2 5 5v7l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5z"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="10" cy="11" r="0.9" fill={color} />
        <circle cx="14" cy="11" r="0.9" fill={color} />
      </svg>
    );
  }

  if (icon === 'cap') {
    return (
      <svg {...common}>
        <path d="M3.5 9.5L12 5.5L20.5 9.5L12 13.5L3.5 9.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7 11.5v3.1L12 17l5-2.4v-3.1" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path
        d="M8 7h8v2.5c0 3-1.7 5.2-4 5.2s-4-2.2-4-5.2V7zM6 7h2M16 7h2M9.3 14.7v1.6c0 1.4 1.2 2.7 2.7 2.7s2.7-1.3 2.7-2.7v-1.6M8.8 19h6.4"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusRow({ status, text }: { status: 'completed' | 'started' | 'none'; text?: string }) {
  if (status === 'completed') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#22C55E]/65">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 8.5L6.1 11.6L13 4.7" stroke="#22C55E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-medium text-[#3BE26F]">Complete</span>
        {text && <><span className="text-[#777287]">·</span><span className="text-[#B7B2C0]">{text}</span></>}
      </div>
    );
  }
  if (status === 'started') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#C8922A]/65">
          <div className="h-2 w-2 rounded-full bg-[#E8BF66]" />
        </span>
        <span className="font-medium text-[#E8BF66]">In Progress</span>
        {text && <><span className="text-[#777287]">·</span><span className="text-[#B7B2C0]">{text}</span></>}
      </div>
    );
  }
  return (
    <div className="mt-6 flex items-center gap-3 text-[15px]">
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20">
        <div className="h-2 w-2 rounded-full bg-white/25" />
      </span>
      <span className="text-[#6A6778]">Not played yet today</span>
    </div>
  );
}

export default function RacehorseHomeScreen({
  setAppMode,
  onOpenAuth,
  onOpenAccount,
}: {
  setAppMode?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}) {
  const navigate = (mode: AppMode) => setAppMode?.(mode);

  const { user: authUser, profile: authProfile } = useAuth();

  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [fritzStreak, setFritzStreak] = useState<number | null>(null);
  const [fritzStatus, setFritzStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [puzzleStatus, setPuzzleStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [puzzleScore, setPuzzleScore] = useState<number | null>(null);
  const [weekPlayDates, setWeekPlayDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!authUser?.id) { setFriendCount(null); return; }
    fetchFriends(authUser.id)
      .then(({ friends }) => setFriendCount(friends.length))
      .catch(() => setFriendCount(0));
  }, [authUser?.id]);

  // Fetch which days of THIS week the user actually completed Daily Fritz.
  // Queries Supabase directly — no backend changes needed.
  useEffect(() => {
    if (!authUser?.id || !supabase) { setWeekPlayDates(new Set()); return; }

    // Monday of the current week (local time)
    const today = new Date();
    const dow = today.getDay();
    const daysFromMon = dow === 0 ? 6 : dow - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysFromMon);
    const mondayStr = localDateStr(monday);

    supabase
      .from('daily_fritz_attempts')
      .select('run_date')
      .eq('user_id', authUser.id)
      .eq('status', 'completed')
      .gte('run_date', mondayStr)
      .then(({ data, error }) => {
        if (error || !data) return;
        setWeekPlayDates(new Set(data.map((r: { run_date: string }) => r.run_date)));
      });
  }, [authUser?.id, fritzStatus]); // re-fetch when fritzStatus changes (just finished a game)

  useEffect(() => {
    getTodayDailyFritz()
      .then((data) => {
        setFritzStreak(data.streak ?? 0);
        const s = data.attempt_status;
        setFritzStatus(s === 'completed' ? 'completed' : s === 'started' ? 'started' : 'none');
      })
      .catch(() => { setFritzStreak(0); setFritzStatus('none'); });
  }, []);

  useEffect(() => {
    getTodayDailyPuzzleLadder()
      .then((data) => {
        const s = data.attemptStatus;
        setPuzzleStatus(s === 'completed' ? 'completed' : s === 'started' ? 'started' : 'none');
        if (s === 'completed' && data.attempt?.totalScore != null) {
          setPuzzleScore(data.attempt.totalScore);
        }
      })
      .catch(() => setPuzzleStatus('none'));
  }, []);

  const username = authProfile?.username ?? null;
  const rating = authProfile?.glicko_rating != null
    ? Math.round(Number(authProfile.glicko_rating)).toLocaleString()
    : authUser ? '800' : '—';

  const initials = useMemo(() => {
    if (!username) return authUser ? '?' : '→';
    const parts = username.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const init = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
    return init || username.slice(0, 2).toUpperCase();
  }, [username, authUser]);

  const displayName = username ?? (authUser ? 'Loading…' : 'Sign In');

  const todayLabel = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).toUpperCase();

  // Build the real week strip from Supabase data.
  // If user just completed today, mark today as done too.
  const streakDays = computeStreakDays(weekPlayDates).map((d) =>
    d.state === 'today' && fritzStatus === 'completed' ? { ...d, state: 'done' as const } : d,
  );

  const themeVars = {
    '--rh-bg': '#050911',
    '--rh-panel': '#09101A',
    '--rh-panel-2': '#0B121D',
    '--rh-brass': '#D7A64A',
    '--rh-blue': '#4A8FD4',
    '--rh-green': '#67D957',
    '--rh-violet': '#8B5CF6',
    '--rh-cyan': '#20D1C7',
    '--rh-orange': '#F2A63A',
    '--rh-text': '#F2EEE8',
    '--rh-muted': '#7A778A',
  } as CSSProperties;

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#040b17] text-[var(--rh-text)] home-page-root"
      style={themeVars}
    >
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1580px] flex-col home-shell">
        <nav className="relative flex h-[78px] shrink-0 items-center justify-between px-9 home-nav">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[28px] bg-[linear-gradient(180deg,transparent_0%,rgba(7,10,17,0.18)_100%)]" />
          <div className="flex items-center">
            <BrandLogo iconSize={44} />
          </div>

          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[13px] font-medium uppercase tracking-[0.28em] text-[#52AFFF] opacity-85">
            {todayLabel}
          </div>

          <div className="flex items-center">
            {/* Rating */}
            <div className="flex items-center gap-3 px-5 py-2.5">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#F2C35E" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 3.7L14.4 8.6L19.8 9.4L15.9 13.2L16.8 18.6L12 16.1L7.2 18.6L8.1 13.2L4.2 9.4L9.6 8.6L12 3.7Z" />
              </svg>
              <div className="leading-tight">
                <div className="text-[20px] font-bold text-[#F0EDE8]">{rating}</div>
                <div className="text-[12px] text-[#8A879B]">Rating</div>
              </div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <button
              type="button"
              onClick={() => navigate('friends')}
              className="flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-opacity hover:opacity-80"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="9" cy="8.7" r="2.2" fill="#4A8FD4" />
                <circle cx="15.4" cy="9.5" r="1.9" fill="#4A8FD4" />
                <path d="M4.5 17.6C5.4 15.4 7.2 14.1 9.8 14.1C12 14.1 13.7 14.9 14.7 16.8" stroke="#4A8FD4" strokeWidth="1.7" strokeLinecap="round" />
                <path d="M14.7 14.8C16.3 14.8 17.7 15.5 18.8 16.9" stroke="#4A8FD4" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              <div className="leading-tight text-left">
                <div className="text-[20px] font-bold text-[#F0EDE8]">{friendCount !== null ? friendCount : authUser ? '…' : '—'}</div>
                <div className="text-[12px] text-[#8A879B]">Friends</div>
              </div>
            </button>

            <div className="mx-4 h-8 w-px bg-white/10" />

            <div className="flex items-center gap-4">
              {/* Big "O" / Avatar -> Stats */}
              <button
                type="button"
                onClick={() => navigate('stats')}
                className="flex h-[54px] w-[54px] items-center justify-center rounded-full border border-[#C8922A]/60 bg-[radial-gradient(circle_at_45%_30%,#8A5A2B_0%,#4A2D18_44%,#140F0D_100%)] shadow-[0_0_14px_rgba(200,146,42,0.12)] select-none cursor-pointer transition-opacity hover:opacity-80 active:scale-95"
                aria-label="View Stats"
              >
                <span className="text-[17px] font-bold tracking-tight text-[#E1BE82]">{initials}</span>
              </button>

              {/* Username / Details -> Account/Auth */}
              <button
                type="button"
                onClick={() => (authUser ? onOpenAccount?.() : onOpenAuth?.())}
                className="flex items-center gap-4 cursor-pointer transition-opacity hover:opacity-80"
              >
                <div className="leading-tight text-left">
                  <div className="text-[16px] font-semibold text-[#F0EDE8]">{displayName}</div>
                  {authUser && authProfile?.ranked_games_played != null && (
                    <div className="mt-1 text-[13px] text-[#8A879B]">{authProfile.ranked_games_played} ranked games</div>
                  )}
                  {!authUser && (
                    <div className="mt-1 text-[13px] text-[#5BAAF8]">Sign in to track progress</div>
                  )}
                </div>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 7.5L10 12.5L15 7.5" stroke="#E7E1D5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </nav>

        <main className="relative flex-1 px-0 pb-5 pt-10 home-main">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]" />
          <div className="text-center">
            <h1 className="text-[72px] font-black leading-[0.9] tracking-[-0.05em] text-white" style={{ textShadow: '0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)' }}>Today&apos;s Challenge</h1>
            <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">Two ways to test your strategy. One daily tradition.</p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-5 px-14">
            <section className="daily-fritz-card-container relative overflow-hidden rounded-[20px] rounded-tl-[5px] px-7 py-7">
              <div className="home-card-art home-card-art--fritz" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[252px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#EDC468]">Daily Fritz</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">One seeded match. Same deal for everyone.</p>
                  <StatusRow
                    status={fritzStatus}
                    text={fritzStatus === 'completed' && fritzStreak ? `${fritzStreak} Day Streak` : undefined}
                  />
                  <button onClick={() => navigate('dailyFritz')} className="mt-7 flex h-[50px] w-[188px] items-center justify-between px-5 rounded-[12px] border border-[#C8922A]/68 bg-[linear-gradient(180deg,rgba(200,146,42,0.12)_0%,rgba(200,146,42,0.04)_100%)] text-[16px] font-semibold text-[#F2EEE7] shadow-[0_0_20px_rgba(200,146,42,0.18),inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(200,146,42,0.10)] transition-all hover:shadow-[0_0_30px_rgba(200,146,42,0.30),inset_0_1px_0_rgba(255,255,255,0.12)] hover:border-[#C8922A]/85 active:scale-[0.97]">
                    <span>{fritzStatus === 'completed' ? 'View Result' : fritzStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span className="text-[22px] leading-none text-[#E8B840] opacity-90">›</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="daily-puzzle-card-container relative overflow-hidden rounded-[20px] rounded-tr-[5px] px-7 py-7">
              <div className="home-card-art home-card-art--puzzle" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[252px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#5A9EEF]">Daily Puzzle</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">Find the best scoring play.</p>
                  <StatusRow
                    status={puzzleStatus}
                    text={puzzleStatus === 'completed' && puzzleScore != null ? `Score: ${puzzleScore}` : undefined}
                  />
                  <button onClick={() => navigate('daily')} className="mt-7 flex h-[50px] w-[188px] items-center justify-between px-5 rounded-[12px] border border-[#3D8FE8]/68 bg-[linear-gradient(180deg,rgba(74,143,212,0.12)_0%,rgba(74,143,212,0.04)_100%)] text-[16px] font-semibold text-[#F2EEE7] shadow-[0_0_20px_rgba(74,143,212,0.18),inset_0_1px_0_rgba(255,255,255,0.08),inset_0_0_0_1px_rgba(74,143,212,0.10)] transition-all hover:shadow-[0_0_30px_rgba(74,143,212,0.30),inset_0_1px_0_rgba(255,255,255,0.12)] hover:border-[#3D8FE8]/85 active:scale-[0.97]">
                    <span>{puzzleStatus === 'completed' ? 'Review Puzzle' : puzzleStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span className="text-[22px] leading-none text-[#5BAAF8] opacity-90">›</span>
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section className="mx-14 mt-4 flex items-center rounded-[18px] border border-white/[0.055] bg-[rgba(7,9,16,0.88)] px-7 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.028),0_8px_20px_rgba(0,0,0,0.22)]">
            <div className="flex min-w-[236px] items-center gap-4">
              <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full border border-[#24541F] bg-[#132012] shadow-[0_0_20px_rgba(78,218,74,0.12)]">
                <img 
                  src="/daystreak.png" 
                  alt="Streak Icon" 
                  style={{ width: 28, height: 28, objectFit: 'contain' }}
                />
              </div>
              <div>
                <div className="text-[18px] font-semibold text-[#7EE24E]">{fritzStreak !== null ? `${fritzStreak} Day Streak` : '…'}</div>
                <div className="mt-1 text-[13px] text-[#9D98A9]">
                  {fritzStatus === 'completed' ? 'Keep it going!' : fritzStreak ? 'Play today to extend it!' : 'Play today to start!'}
                </div>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center gap-8">
              {streakDays.map((day) => (
                <div key={day.label} className="flex flex-col items-center">
                  <div className="mb-2.5 text-[12px] text-[#B6B1BF]">{day.label}</div>
                  {day.state === 'done' ? (
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#345B26] bg-[#1C3518] shadow-[0_0_16px_rgba(126,226,78,0.15)]">
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 8.5L6.1 11.6L13 4.7" stroke="#7EE24E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : day.state === 'today' ? (
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#C8922A]">
                      <div className="h-[9px] w-[9px] rounded-full bg-[#E8BF66]" />
                    </div>
                  ) : (
                    <div className="h-[38px] w-[38px] rounded-full border border-[#32394A]" />
                  )}
                </div>
              ))}
            </div>

            <div className="ml-7 flex min-w-[280px] items-center gap-7 border-l border-white/10 pl-8">
              <div>
                <div className="text-[13px] text-[#B6B1BF]">Weekly Goal</div>
                <div className="mt-1.5 text-[16px]">
                  <span className="font-semibold text-[#7EE24E]">{Math.min(fritzStreak ?? 0, 7)}</span>
                  <span className="text-[#B6B1BF]"> / 7 Days</span>
                </div>
              </div>
              <div className="h-[7px] w-[160px] rounded-full bg-[#1B2432]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#7EE24E,#89D830)] shadow-[0_0_10px_rgba(126,226,78,0.22)]"
                  style={{ width: `${Math.round(Math.min((fritzStreak ?? 0) / 7, 1) * 100)}%` }}
                />
              </div>
            </div>
          </section>

          <section className="mx-14 mt-4 overflow-hidden rounded-[18px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(10,13,22,0.96)_0%,rgba(6,8,14,0.98)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_20px_rgba(0,0,0,0.22)]">
            <div className="flex">
              {tabs.map((tab) => (
                <button
                  key={tab.label}
                  onClick={() => navigate(tab.mode)}
                  className="group relative flex h-[76px] flex-1 items-center justify-center gap-[13px] border-r border-white/[0.05] last:border-r-0 cursor-pointer transition-all hover:bg-white/[0.025] active:bg-white/[0.04]"
                  type="button"
                  style={{ ['--tab-color' as string]: tab.color } as CSSProperties}
                >
                  {/* subtle top-to-bottom sheen on each cell */}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.015)_0%,rgba(255,255,255,0)_48%)]" />
                  <span className="relative z-10 flex-shrink-0" style={{ color: tab.color }}>
                    <TabIcon icon={tab.icon} color={tab.color} size={26} />
                  </span>
                  <span
                    className="relative z-10 text-[17px] font-semibold tracking-[-0.01em]"
                    style={{ color: tab.color }}
                  >
                    {tab.label}
                  </span>
                  {/* glow bar — 4px, 50% width, centered, soft bloom */}
                  <div
                    className="absolute bottom-0 left-1/2 h-[4px] w-[50%] -translate-x-1/2 rounded-full transition-all duration-200 group-hover:opacity-100"
                    style={{
                      backgroundColor: tab.color,
                      opacity: 0.92,
                      boxShadow: `0 0 10px ${tab.color}, 0 0 24px ${tab.color}66`,
                    }}
                  />
                </button>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
