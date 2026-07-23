import { useHomeCommandCenter } from '../home/useHomeCommandCenter';
import type { AppRoutesTournamentProps } from '../appRouteTypes';
import type { CSSProperties } from 'react';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import { getHomeDailyCardState, getHomeDailyResultCopy } from '../home/homeDailyCardPresentation';
import { HomeStreakStrip } from '../home/components/HomeStreakStrip';
import './RacehorseHomeArt.css';
import { isSpectatorModeEnabled } from '../config/spectatorModeFeature.ts';

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
  | 'guidedMatchRecorder'
  | 'guidedMatchAnnotator'
  | 'friends'
  | 'stats'
  | 'ratingHistory'
  | 'singlePlayerHub'
  | 'journey'
  | 'tournament'
  | 'leaderboard'
  | 'profile'
  | 'feed'
  | 'live';

const coreTabs: { label: string; color: string; icon: 'robot' | 'users' | 'cap' | 'trophy' | 'medal'; mode: AppMode }[] = [
  { label: 'Multiplayer', color: '#3FA7FF', icon: 'users', mode: 'multiplayer' },
  { label: 'Single Player', color: '#9B6CFF', icon: 'robot', mode: 'singlePlayerHub' },
  { label: 'Tournament', color: '#F5A524', icon: 'trophy', mode: 'tournament' },
  { label: 'Social', color: '#B8C7DA', icon: 'medal', mode: 'feed' },
  { label: 'Learn', color: '#19D8A2', icon: 'cap', mode: 'learn' },
];

export function getHomeTabs(spectatorEnabled = isSpectatorModeEnabled()) {
  return spectatorEnabled
    ? [{ label: 'Live Now', color: '#58A6FF', icon: 'users' as const, mode: 'live' as const }, ...coreTabs]
    : coreTabs;
}

const tabs = getHomeTabs();

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
  color = '#22C55E',
  accentColor = '#3BE26F',
}: {
  status: 'started' | 'none' | 'unknown';
  color?: string;
  accentColor?: string;
}) {
  if (status === 'started') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border" style={{ borderColor: `${color}a6` }}>
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
        </span>
        <span className="font-medium" style={{ color: accentColor }}>In Progress</span>
      </div>
    );
  }
  if (status === 'unknown') {
    return (
      <div className="mt-6 flex items-center gap-3 text-[15px]">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20">
          <div className="h-2 w-2 rounded-full bg-white/25" />
        </span>
        <span className="text-[#777287]">Status unavailable</span>
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
  tournament,
}: {
  setAppMode?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  tournament: AppRoutesTournamentProps['tournament'];
}) {
  const navigate = (mode: AppMode) => setAppMode?.(mode);
  const homeModel = useHomeCommandCenter(tournament);
  const fritz = homeModel.daily.fritz.data;
  const puzzle = homeModel.daily.puzzle.data;
  const displayFritzStatus = homeModel.daily.fritz.status === 'error'
    ? 'unknown'
    : fritz?.state === 'completed'
      ? 'completed'
      : fritz?.state === 'started'
        ? 'started'
        : 'none';
  const displayFritzOutcome = fritz?.outcome ?? null;
  const puzzleStatus = homeModel.daily.puzzle.status === 'error'
    ? 'unknown'
    : puzzle?.state === 'completed'
      ? 'completed'
      : puzzle?.state === 'started'
        ? 'started'
        : 'none';
  const puzzleScore = puzzle?.score ?? null;
  const currentStreakCount = homeModel.daily.summary.data?.currentStreakCount ?? 0;
  const fritzCompleted = getHomeDailyCardState(homeModel.daily.fritz.status, fritz?.state ?? null) === 'completed';
  const puzzleCompleted = getHomeDailyCardState(homeModel.daily.puzzle.status, puzzle?.state ?? null) === 'completed';
  const fritzResultCopy = getHomeDailyResultCopy('fritz', displayFritzOutcome);
  const puzzleResultCopy = getHomeDailyResultCopy('puzzle');
  const homeLoading = Object.values(homeModel.sourceStatus).some((status) => status === 'loading');

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

        <main className="relative flex-1 px-0 pb-5 pt-8 home-main">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]" />
          <div className="text-center">
            <h1 className="text-[64px] font-black leading-[0.9] tracking-[-0.05em] text-white" style={{ textShadow: '0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)' }}>Today&apos;s Race</h1>
            <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">Two ways to test your strategy. One daily tradition.</p>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-5 px-14">
            <section className={`daily-fritz-card-container relative overflow-hidden rounded-[20px] rounded-tl-[5px] px-7 py-8${fritzCompleted ? ' daily-card--completed' : ''}`} aria-label={fritzCompleted ? 'Daily Fritz completed results' : 'Daily Fritz'}>
              <div className="home-card-art home-card-art--fritz" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[268px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#E7B64A]">Daily Fritz</h2>
                  <p className="mt-3 text-[18px] text-[#C4C1CC] leading-relaxed">{fritzCompleted ? "Today's result" : 'Best of 3 series. Same deal for everyone.'}</p>
                  {fritzCompleted && (
                    <div className="home-daily-result-summary" aria-label="Daily Fritz result summary">
                      <span className="home-daily-result-badge" role="status">{fritzResultCopy.badge}</span>
                      {fritz?.rank != null && <span>Placement <strong>#{fritz.rank}</strong></span>}
                      {fritz?.streak != null && <span>Streak <strong>{fritz.streak}</strong></span>}
                      {fritzResultCopy.outcome && <span className="home-daily-result-outcome" aria-label={`Outcome: ${fritzResultCopy.outcome}`}>{fritzResultCopy.outcome}</span>}
                    </div>
                  )}
                  {!fritzCompleted && <div className="mt-2">
                    <StatusRow
                      status={displayFritzStatus === 'completed' ? 'none' : displayFritzStatus}
                      color="#E7B64A"
                      accentColor="#FFD76A"
                    />
                  </div>}
                  <Button
                    variant="tier-elite"
                    onClick={() => navigate('dailyFritz')}
                    className="mt-7"
                    style={{ width: 188, height: 50, justifyContent: 'space-between' }}
                  >
                    <span>{fritzCompleted ? 'View Results' : displayFritzStatus === 'started' ? 'Continue' : 'Play'}</span>
                    <span style={{ fontSize: 22, lineHeight: 1, color: '#FFD76A', opacity: 0.9 }}>›</span>
                  </Button>
                </div>
              </div>
            </section>

            <section className={`daily-puzzle-card-container relative overflow-hidden rounded-[20px] rounded-tr-[5px] px-7 py-8${puzzleCompleted ? ' daily-card--completed' : ''}`} aria-label={puzzleCompleted ? 'Daily Puzzle completed results' : 'Daily Puzzle'}>
              <div className="home-card-art home-card-art--puzzle" aria-hidden="true" />
              <div className="home-card-scrim" aria-hidden="true" />
              <div className="home-card-content relative flex h-[268px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#58A6FF]">Daily Puzzle</h2>
                  <p className="mt-3 text-[18px] text-[#C4C1CC] leading-relaxed">{puzzleCompleted ? "Today's result" : 'Three daily puzzles. Rising difficulty.'}</p>
                  {puzzleCompleted && (
                    <div className="home-daily-result-summary" aria-label="Daily Puzzle result summary">
                      <span className="home-daily-result-badge" role="status">{puzzleResultCopy.badge}</span>
                      {puzzleScore != null && <span>Score <strong>{puzzleScore}</strong></span>}
                      {currentStreakCount > 0 && <span>Streak <strong>{currentStreakCount}</strong></span>}
                    </div>
                  )}
                  {!puzzleCompleted && <div className="mt-2">
                    <StatusRow
                      status={puzzleStatus === 'completed' ? 'none' : puzzleStatus}
                      color="#58A6FF"
                      accentColor="#68B3FF"
                    />
                  </div>}
                  <Button
                    variant="tier-standard"
                    onClick={() => navigate('daily')}
                    className="mt-7"
                    style={{ width: 188, height: 50, justifyContent: 'space-between' }}
                  >
                    <span>{puzzleCompleted ? 'View Results' : puzzleStatus === 'started' ? 'Continue' : 'Play'}</span>
                    <span style={{ fontSize: 22, lineHeight: 1, color: '#68B3FF', opacity: 0.9 }}>›</span>
                  </Button>
                </div>
              </div>
            </section>
          </div>

          <HomeStreakStrip
            summary={homeModel.daily.summary}
            loading={homeLoading}
          />

          <section className="home-mode-tabs mx-14 mt-4 overflow-hidden rounded-[18px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(10,13,22,0.96)_0%,rgba(6,8,14,0.98)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_20px_rgba(0,0,0,0.22)]" aria-label="Game modes">
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
                  <div
                    className="rh-glow-underline rh-glow-underline--home-tab transition-all duration-200 group-hover:opacity-100"
                    style={{ ['--rh-glow-underline-color' as string]: tab.color } as CSSProperties}
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
