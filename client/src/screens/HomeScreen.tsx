import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { DominoTile, BrandLogo, GlobalNav } from '../components';
import { Button } from '../components/primitives';
import type { Tile } from '../types';
import { useAuth } from '../auth/useAuth';
import { fetchFriends } from '../friends/friendsApi';
import { getTodayDailyFritz } from '../dailyFritz/api';
import { getTodayDailyPuzzleLadder } from '../dailyPuzzle/api';
import {
  getHomeDailySummary,
  type HomeDailySummaryResponse,
  type HomeDailySummaryWeekDay,
} from '../features/daily/homeDailySummaryApi';
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
  | 'learn'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'tournament'
  | 'leaderboard'
  | 'profile';

type DailyStripVisualState = 'done' | 'today' | 'future' | 'missed';

function getDayVisualState(day: HomeDailySummaryWeekDay): DailyStripVisualState {
  if (day.complete) return 'done';
  if (day.isToday) return 'today';
  if (day.isFuture) return 'future';
  return 'missed';
}

const tabs: { label: string; color: string; icon: 'robot' | 'users' | 'cap' | 'trophy' | 'medal'; mode: AppMode }[] = [
  { label: 'Single Player', color: '#9B6CFF', icon: 'robot', mode: 'singlePlayerHub' },
  { label: 'Multiplayer', color: '#3FA7FF', icon: 'users', mode: 'multiplayer' },
  { label: 'Learn', color: '#19D8A2', icon: 'cap', mode: 'learn' },
  { label: 'Tournament', color: '#F5A524', icon: 'trophy', mode: 'tournament' },
  { label: 'Leaderboard', color: '#B8C7DA', icon: 'medal', mode: 'stats' },
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

  if (icon === 'cap') {
    return (
      <svg {...common}>
        <path d="M3.5 9.5L12 5.5L20.5 9.5L12 13.5L3.5 9.5Z" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M7 11.5v3.1L12 17l5-2.4v-3.1" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    );
  }

  if (icon === 'trophy') {
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

  return (
    <svg {...common}>
      <path d="M12 15C15.3137 15 18 12.3137 18 9C18 5.68629 15.3137 3 12 3C8.68629 3 6 5.68629 6 9C6 12.3137 8.68629 15 12 15Z" stroke={color} strokeWidth="1.8"/>
      <path d="M8.21 13.89L7 21L12 19L17 21L15.79 13.88" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function StatusRow({
  status,
  text,
  color = '#22C55E',
  accentColor = '#3BE26F',
  textColor,
}: {
  status: 'completed' | 'started' | 'none';
  text?: string;
  color?: string;
  accentColor?: string;
  textColor?: string;
}) {
  if (status === 'completed') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: `${color}a6` }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 8.5L6.1 11.6L13 4.7" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="font-medium" style={{ color: accentColor }}>Complete</span>
        {text && <><span className="text-[#777287]">·</span><span style={{ color: textColor ?? '#B7B2C0' }}>{text}</span></>}
      </div>
    );
  }
  if (status === 'started') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: `${color}a6` }}>
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
        </span>
        <span className="font-medium" style={{ color: accentColor }}>In Progress</span>
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

  const [fritzStreak, setFritzStreak] = useState<number | null>(null);
  const [fritzStatus, setFritzStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [fritzOutcome, setFritzOutcome] = useState<'win' | 'loss' | null>(null);
  const [puzzleStatus, setPuzzleStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [puzzleScore, setPuzzleScore] = useState<number | null>(null);
  const [homeDailySummary, setHomeDailySummary] = useState<HomeDailySummaryResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHomeDailySummary()
      .then((data) => {
        if (!cancelled) setHomeDailySummary(data);
      })
      .catch(() => {
        if (!cancelled) setHomeDailySummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, fritzStatus, puzzleStatus]);

  useEffect(() => {
    getTodayDailyFritz()
      .then((data) => {
        setFritzStreak(data.streak ?? 0);
        const s = data.attempt_status;
        setFritzStatus(s === 'completed' ? 'completed' : s === 'started' ? 'started' : 'none');
        const won = data.set_result?.setWinner === 'player' || data.set_result?.won === true;
        const lost = data.set_result?.setWinner === 'fritz' || (data.set_result?.won === false && s === 'completed');
        setFritzOutcome(s === 'completed' ? (won ? 'win' : lost ? 'loss' : null) : null);
      })
      .catch(() => { setFritzStreak(0); setFritzStatus('none'); setFritzOutcome(null); });
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

  const streakDays = homeDailySummary?.week ?? [];
  const weeklyCompletedCount = homeDailySummary?.weeklyCompletedCount ?? 0;
  const currentStreakCount = homeDailySummary?.currentStreakCount ?? 0;
  const todayComplete = homeDailySummary?.todayComplete ?? false;
  const weeklyGoalComplete = weeklyCompletedCount >= 7;
  const streakTitle = currentStreakCount > 0 ? `${currentStreakCount} Day Streak` : 'Start your streak';
  const streakSubtitle = weeklyGoalComplete
    ? 'Weekly goal complete.'
    : todayComplete
      ? 'Nice — today is complete.'
      : currentStreakCount > 0
        ? 'Play Fritz or Puzzle today to keep it going.'
        : 'Play Fritz or Puzzle today.';

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
        <GlobalNav
          onNavigate={navigate}
          onOpenAuth={onOpenAuth}
          onOpenAccount={onOpenAccount}
        />

        <main className="relative flex-1 px-0 pb-5 pt-10 home-main">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]" />
          <div className="text-center">
            <h1 className="text-[64px] font-black leading-[0.9] tracking-[-0.05em] text-white" style={{ textShadow: '0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)' }}>Today&apos;s Challenge</h1>
            <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">Two ways to test your strategy. One daily tradition.</p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-5 px-14">
            <section className="daily-fritz-card-container relative overflow-hidden rounded-[20px] rounded-tl-[5px] px-7 py-8">
              <div className="home-card-art home-card-art--fritz" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[268px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#E7B64A]">Daily Fritz</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">Best of 3 series. Same deal for everyone.</p>
                  <StatusRow
                    status={fritzStatus}
                    text={fritzStatus === 'completed' ? (fritzOutcome === 'win' ? 'Win' : fritzOutcome === 'loss' ? 'Loss' : undefined) : undefined}
                    color="#E7B64A"
                    accentColor="#FFD76A"
                    textColor={fritzOutcome === 'win' ? '#7EE24E' : fritzOutcome === 'loss' ? '#F87171' : undefined}
                  />
                  <Button
                    variant="tier-elite"
                    onClick={() => navigate('dailyFritz')}
                    className="mt-7"
                    style={{ width: 188, height: 50, justifyContent: 'space-between' }}
                  >
                    <span>{fritzStatus === 'completed' ? 'View Result' : fritzStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span style={{ fontSize: 22, lineHeight: 1, color: '#FFD76A', opacity: 0.9 }}>›</span>
                  </Button>
                </div>
              </div>
            </section>

            <section className="daily-puzzle-card-container relative overflow-hidden rounded-[20px] rounded-tr-[5px] px-7 py-8">
              <div className="home-card-art home-card-art--puzzle" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[268px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#58A6FF]">Daily Puzzle</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">Three daily puzzles. Rising difficulty.</p>
                  <StatusRow
                    status={puzzleStatus}
                    text={puzzleStatus === 'completed' && puzzleScore != null ? `Score: ${puzzleScore}` : undefined}
                    color="#58A6FF"
                    accentColor="#68B3FF"
                  />
                  <Button
                    variant="tier-standard"
                    onClick={() => navigate('daily')}
                    className="mt-7"
                    style={{ width: 188, height: 50, justifyContent: 'space-between' }}
                  >
                    <span>{puzzleStatus === 'completed' ? 'Review Puzzle' : puzzleStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span style={{ fontSize: 22, lineHeight: 1, color: '#68B3FF', opacity: 0.9 }}>›</span>
                  </Button>
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
                <div className="text-[18px] font-semibold text-[#7EE24E]">{streakTitle}</div>
                <div className="mt-1 text-[13px] text-[#9D98A9]">{streakSubtitle}</div>
              </div>
            </div>

            <div className="flex flex-1 items-center justify-center gap-8">
              {streakDays.map((day) => (
                <div key={day.label} className="flex flex-col items-center">
                  <div className="mb-2.5 text-[12px] text-[#B6B1BF]">{day.label}</div>
                  {getDayVisualState(day) === 'done' ? (
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#345B26] bg-[#1C3518] shadow-[0_0_16px_rgba(126,226,78,0.15)]">
                      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 8.5L6.1 11.6L13 4.7" stroke="#7EE24E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : getDayVisualState(day) === 'today' ? (
                    <div className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-[#9B6CFF]">
                      <div className="h-[9px] w-[9px] rounded-full bg-[#A77CFF]" />
                    </div>
                  ) : getDayVisualState(day) === 'future' ? (
                    <div className="h-[38px] w-[38px] rounded-full border border-[#32394A]" />
                  ) : (
                    <div className="h-[38px] w-[38px] rounded-full border border-[#262D3A] opacity-70" />
                  )}
                </div>
              ))}
            </div>

            <div className="ml-7 flex min-w-[280px] items-center gap-7 border-l border-white/10 pl-8">
              <div>
                <div className="text-[13px] text-[#B6B1BF]">Weekly Goal</div>
                <div className="mt-1.5 text-[16px]">
                  <span className="font-semibold text-[#7EE24E]">{weeklyCompletedCount}</span>
                  <span className="text-[#B6B1BF]"> / 7 Days</span>
                </div>
              </div>
              <div className="h-[7px] w-[160px] rounded-full bg-[#1B2432]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#7EE24E,#89D830)] shadow-[0_0_10px_rgba(126,226,78,0.22)]"
                  style={{ width: `${Math.round(Math.min(weeklyCompletedCount / 7, 1) * 100)}%` }}
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
