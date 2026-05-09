import { useState, useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { DominoTile, BrandLogo } from '../components';
import type { Tile } from '../types';
import { useAuth } from '../auth/useAuth';
import { fetchFriends } from '../friends/friendsApi';
import { getTodayDailyFritz } from '../dailyFritz/api';
import { getTodayDailyPuzzleLadder } from '../dailyPuzzle/api';

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
function computeStreakDays() {
  const dow = new Date().getDay(); // 0=Sun
  const todayIdx = dow === 0 ? 6 : dow - 1; // 0=Mon..6=Sun
  return WEEK_LABELS.map((label, i) => ({
    label,
    state: i < todayIdx ? ('done' as const) : i === todayIdx ? ('today' as const) : ('future' as const),
  }));
}

const tabs: { label: string; color: string; icon: 'horse' | 'users' | 'ghost' | 'cap' | 'trophy'; mode: AppMode }[] = [
  { label: 'Play vs Fritz', color: '#C8922A', icon: 'horse', mode: 'botSetup' },
  { label: 'Multiplayer', color: '#4A8FD4', icon: 'users', mode: 'multiplayer' },
  { label: 'Ghost Mode', color: '#8B5CF6', icon: 'ghost', mode: 'ghostSetup' },
  { label: 'Learn', color: '#10B981', icon: 'cap', mode: 'learn' },
  { label: 'Tournament', color: '#F59E0B', icon: 'trophy', mode: 'tournament' },
];

function KnightIcon({
  color,
  className = '',
  size = 24,
}: {
  color: string;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 21h8M12 21v-3M7 9c0-2.8 2.2-5 5-5s5 2.2 5 5c0 1.8-.9 3.3-2.2 4.3L16 14H8l1.2-.7C7.9 12.3 7 10.8 7 9zM9 17h6M9 14.5h6"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TabIcon({ icon, color }: { icon: (typeof tabs)[number]['icon']; color: string }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
  } as const;

  if (icon === 'horse') {
    return <KnightIcon color={color} size={22} />;
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

// ─── CUSTOM TILE COMPONENT FOR CINEMATIC MOCKUP ─────────────────

const pipLayouts: Record<number, [number, number][]> = {
  0: [],
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function HeroTile({
  tile,
  size,
  rotation = 0,
  flipped = false,
  tone = 'fritz',
  style,
}: {
  tile: Tile;
  size: number;
  rotation?: number;
  flipped?: boolean;
  tone?: 'fritz' | 'puzzle';
  style?: CSSProperties;
}) {
  const first = flipped ? tile.high : tile.low;
  const second = flipped ? tile.low : tile.high;

  // Cinematic palette matching the mockup:
  // Fritz: Charcoal/Black face with Brass pips
  // Puzzle: Navy/Black face with White pips
  const pipColor = tone === 'fritz' ? '#D7A64A' : '#FFFFFF';
  const borderColor = tone === 'fritz' ? 'rgba(215,166,74,0.35)' : 'rgba(255,255,255,0.2)';
  const dividerColor = tone === 'fritz' ? '#3B2C15' : 'rgba(255,255,255,0.1)';
  const faceGradient =
    tone === 'fritz'
      ? 'linear-gradient(145deg,#1A1B1F 0%,#050608 100%)'
      : 'linear-gradient(145deg,#0D1525 0%,#020408 100%)';
  const gloss =
    tone === 'fritz'
      ? 'linear-gradient(135deg,rgba(255,255,255,0.08)_0%,transparent 40%)'
      : 'linear-gradient(135deg,rgba(255,255,255,0.06)_0%,transparent 40%)';

  const pipSize = Math.max(6, Math.round(size * 0.18));
  const cellSize = size / 3;

  const renderHalf = (value: number, left: number) =>
    (pipLayouts[value] ?? []).map(([row, col], idx) => (
      <div
        key={`${left}-${value}-${row}-${col}-${idx}`}
        className="absolute rounded-full"
        style={{
          width: pipSize,
          height: pipSize,
          left: left + col * cellSize + cellSize / 2 - pipSize / 2,
          top: row * cellSize + cellSize / 2 - pipSize / 2 + 2,
          background: pipColor,
          boxShadow: tone === 'puzzle' ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
        }}
      />
    ));

  return (
    <div className="relative" style={style}>
      <div
        className="relative overflow-hidden rounded-[11px]"
        style={{
          width: size * 2 + 4,
          height: size + 4,
          transform: `rotate(${rotation}deg)`,
          background: faceGradient,
          border: `2px solid ${borderColor}`,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 10px 18px rgba(0,0,0,0.30)',
        }}
      >
        <div className="absolute inset-0" style={{ background: gloss }} />
        <div
          className="absolute left-1/2 top-[6px] bottom-[6px] w-[2px] -translate-x-1/2"
          style={{ background: dividerColor }}
        />
        {renderHalf(first, 0)}
        {renderHalf(second, size + 2)}
      </div>
    </div>
  );
}

function FritzIllustration() {
  return (
    <div className="relative h-[252px] w-[420px] overflow-hidden">
      {/* Background Fritz Robot Silhouette */}
      <div className="absolute right-0 top-0 h-full w-[200px] opacity-[0.12] mix-blend-screen pointer-events-none">
        <svg viewBox="0 0 200 252" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
           <path d="M180 126C180 180 144 230 100 230C56 230 20 180 20 126C20 72 56 30 100 30C144 30 180 72 180 126Z" fill="#D7A64A" />
           <circle cx="100" cy="126" r="30" stroke="#D7A64A" strokeWidth="2" strokeDasharray="4 4" />
           <path d="M100 10L100 50M100 242L100 202M10 126L50 126M190 126L150 126" stroke="#D7A64A" strokeOpacity="0.4" />
        </svg>
      </div>

      {/* AI Analysis Panel */}
      <div className="absolute right-12 top-8 w-[140px] rounded-lg border border-[#D7A64A]/20 bg-black/40 p-3 backdrop-blur-sm shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
        <div className="text-[9px] font-bold tracking-[0.15em] text-[#D7A64A]/60 uppercase mb-2">AI Analysis</div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] text-[#F2EEE8]/60">WIN PROB</div>
          <div className="text-[18px] font-black text-[#EDC468]">68%</div>
        </div>
        <div className="h-[24px] w-full border-b border-[#D7A64A]/10 relative overflow-hidden">
           <svg width="100%" height="100%" preserveAspectRatio="none">
             <path d="M0 24 L20 18 L40 20 L60 12 L80 15 L100 5 L120 10 L140 8" stroke="#EDC468" strokeWidth="1.5" fill="none" />
             <path d="M0 24 L20 18 L40 20 L60 12 L80 15 L100 5 L120 10 L140 8 L140 24 L0 24" fill="url(#fritzGraph)" opacity="0.1" />
             <defs>
               <linearGradient id="fritzGraph" x1="0" y1="0" x2="0" y2="1">
                 <stop offset="0%" stopColor="#EDC468" />
                 <stop offset="100%" stopColor="transparent" />
               </linearGradient>
             </defs>
           </svg>
        </div>
        <div className="mt-2 text-[9px] text-[#D7A64A]/40 font-mono tracking-tighter">BEST LINE DETECTED...</div>
      </div>

      {/* Seeded Match Tiles */}
      <div className="absolute left-[40px] top-[140px] [filter:drop-shadow(0_12px_24px_rgba(0,0,0,0.6))] rotate-[-5deg]">
        <div className="relative">
           {/* The T-bone layout */}
           <div className="absolute left-[62px] top-[-34px] rotate-[90deg]">
             <HeroTile tile={{ low: 4, high: 4 }} size={32} tone="fritz" />
           </div>
           <div className="absolute left-0 top-0">
             <HeroTile tile={{ low: 2, high: 4 }} size={32} tone="fritz" />
           </div>
           <div className="absolute left-[98px] top-0">
             <HeroTile tile={{ low: 4, high: 6 }} size={32} tone="fritz" />
           </div>
           <div className="absolute left-[46px] top-[80px] rotate-[15deg]">
             <HeroTile tile={{ low: 0, high: 2 }} size={32} tone="fritz" />
           </div>
        </div>
      </div>
    </div>
  );
}

function PuzzleIllustration() {
  return (
    <div className="relative h-[252px] w-[420px] overflow-hidden">
      {/* Background Logic Grid */}
      <div className="absolute inset-0 opacity-[0.05] pointer-events-none">
        <svg width="100%" height="100%">
          <defs>
            <pattern id="logicGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#3D8FE8" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#logicGrid)" />
        </svg>
      </div>

      {/* Logic Path Panel */}
      <div className="absolute right-12 top-8 w-[150px] rounded-lg border border-[#3D8FE8]/20 bg-black/40 p-3 backdrop-blur-sm shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
        <div className="text-[9px] font-bold tracking-[0.15em] text-[#3D8FE8]/60 uppercase mb-2">Logic Path</div>
        <div className="flex items-center gap-2 mb-3">
           <div className="flex h-1.5 w-1.5 rounded-full bg-[#3D8FE8]" />
           <div className="h-[1px] flex-1 bg-[#3D8FE8]/20" />
           <div className="flex h-1.5 w-1.5 rounded-full bg-[#3D8FE8]" />
           <div className="h-[1px] flex-1 bg-[#3D8FE8]/20" />
           <div className="flex h-1.5 w-1.5 rounded-full border border-[#3D8FE8] animate-pulse" />
        </div>
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] text-[#F2EEE8]/60 uppercase tracking-tighter">Exp. Score</div>
          <div className="text-[18px] font-black text-[#5BAAF8]">+18</div>
        </div>
      </div>

      {/* Puzzle Match Layout */}
      <div className="absolute left-[20px] top-[145px] [filter:drop-shadow(0_12px_24px_rgba(0,0,0,0.6))]">
        <div className="relative">
           {/* Complex Chain */}
           <div className="absolute left-0 top-0">
             <HeroTile tile={{ low: 5, high: 6 }} size={28} tone="puzzle" />
           </div>
           <div className="absolute left-[62px] top-0">
             <HeroTile tile={{ low: 6, high: 0 }} size={28} tone="puzzle" />
           </div>
           <div className="absolute left-[124px] top-0">
             <HeroTile tile={{ low: 0, high: 2 }} size={28} tone="puzzle" />
           </div>
           <div className="absolute left-[120px] top-[-60px] rotate-[90deg]">
             <HeroTile tile={{ low: 2, high: 2 }} size={28} tone="puzzle" />
           </div>

           {/* Best Move Arrow */}
           <svg className="absolute left-[195px] top-[15px] w-[50px] h-[30px]" viewBox="0 0 50 30">
              <path d="M0 15 H35 M30 5 L40 15 L30 25" stroke="#3D8FE8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="animate-pulse" />
           </svg>

           {/* Targeted Best Move Tile */}
           <div className="absolute left-[250px] top-[-10px] [filter:drop-shadow(0_0_12px_rgba(61,143,232,0.4))]">
             <HeroTile tile={{ low: 2, high: 4 }} size={32} tone="puzzle" style={{ border: '2px solid rgba(91,170,248,0.8)' }} />
             <div className="mt-2 text-center text-[10px] font-bold text-[#5BAAF8] uppercase tracking-widest">Best Move</div>
           </div>
        </div>
      </div>
    </div>
  );
}

export default function RacehorseHomeScreen({
  setAppMode,
  onOpenAuth,
}: {
  setAppMode?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
}) {
  const navigate = (mode: AppMode) => setAppMode?.(mode);

  const { user: authUser, profile: authProfile } = useAuth();

  const [friendCount, setFriendCount] = useState<number | null>(null);
  const [fritzStreak, setFritzStreak] = useState<number | null>(null);
  const [fritzStatus, setFritzStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [puzzleStatus, setPuzzleStatus] = useState<'completed' | 'started' | 'none'>('none');
  const [puzzleScore, setPuzzleScore] = useState<number | null>(null);

  useEffect(() => {
    if (!authUser?.id) { setFriendCount(null); return; }
    fetchFriends(authUser.id)
      .then(({ friends }) => setFriendCount(friends.length))
      .catch(() => setFriendCount(0));
  }, [authUser?.id]);

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

  const streakDays = computeStreakDays().map((d) =>
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
      className="relative min-h-screen overflow-hidden bg-[#020408] text-[var(--rh-text)]"
      style={themeVars}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#020408_0%,#040812_45%,#010205_100%)]" />
        
        {/* Cinematic atmospheric glows */}
        <div className="absolute right-[-10%] top-[-5%] h-[65vw] w-[65vw] rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.18)_0%,rgba(29,78,216,0.08)_35%,transparent_70%)] blur-[40px]" />
        <div className="absolute left-[-12%] top-[10%] h-[60vw] w-[60vw] rounded-full bg-[radial-gradient(circle,rgba(30,58,138,0.14)_0%,rgba(23,37,84,0.05)_40%,transparent_75%)] blur-[40px]" />
        <div className="absolute left-1/2 top-[-10%] h-[50vw] w-[50vw] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.1)_0%,rgba(37,99,235,0.03)_45%,transparent_75%)] blur-[50px]" />
        
        {/* Subtle grid or diagonal texture */}
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(132deg,transparent_0%,#3b82f6_46%,transparent_47%)]" />
        
        {/* Vertical light rays */}
        <div className="absolute left-[8%] top-0 h-full w-px bg-[linear-gradient(180deg,transparent,rgba(59,130,246,0.08),transparent)]" />
        <div className="absolute right-[12%] top-0 h-full w-px bg-[linear-gradient(180deg,transparent,rgba(59,130,246,0.08),transparent)]" />
        <div className="absolute left-[-3%] top-[12%] rotate-[-35deg] opacity-[0.11]">
          <svg width="196" height="154" viewBox="0 0 196 154" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="8" width="84" height="126" rx="12" fill="#08111F" stroke="#173453" />
            <line x1="50" y1="18" x2="50" y2="124" stroke="#173453" />
            <circle cx="29" cy="33" r="6" fill="#27374C" />
            <circle cx="71" cy="33" r="6" fill="#27374C" />
            <circle cx="29" cy="70" r="6" fill="#27374C" />
            <g transform="translate(94 22)">
              <rect x="0" y="0" width="84" height="126" rx="12" fill="#08111F" stroke="#173453" />
              <line x1="42" y1="10" x2="42" y2="116" stroke="#173453" />
              <circle cx="21" cy="33" r="6" fill="#27374C" />
              <circle cx="63" cy="70" r="6" fill="#27374C" />
              <circle cx="21" cy="107" r="6" fill="#27374C" />
            </g>
          </svg>
        </div>
        <div className="absolute right-[-2%] top-[10%] rotate-[24deg] opacity-[0.10]">
          <svg width="170" height="142" viewBox="0 0 170 142" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="10" y="8" width="64" height="118" rx="12" fill="#08111F" stroke="#173453" />
            <line x1="42" y1="18" x2="42" y2="116" stroke="#173453" />
            <circle cx="26" cy="32" r="5" fill="#23456F" />
            <circle cx="58" cy="64" r="5" fill="#23456F" />
            <circle cx="26" cy="96" r="5" fill="#23456F" />
            <g transform="translate(80 0)">
              <rect x="10" y="8" width="64" height="118" rx="12" fill="#08111F" stroke="#173453" />
              <line x1="42" y1="18" x2="42" y2="116" stroke="#173453" />
              <circle cx="26" cy="32" r="5" fill="#23456F" />
              <circle cx="58" cy="32" r="5" fill="#23456F" />
              <circle cx="26" cy="96" r="5" fill="#23456F" />
            </g>
          </svg>
        </div>
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1580px] flex-col">
        <nav className="relative flex h-[78px] shrink-0 items-center justify-between border-b border-white/[0.055] bg-[linear-gradient(180deg,rgba(4,7,12,0.985)_0%,rgba(4,7,12,0.94)_62%,rgba(4,7,12,0.80)_100%)] px-9 backdrop-blur-md">
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[28px] bg-[linear-gradient(180deg,transparent_0%,rgba(7,10,17,0.28)_100%)]" />
          <div className="flex items-center">
            <BrandLogo iconSize={44} />
          </div>

          <div className="flex items-center">
            <div className="flex items-center gap-3 px-6 py-2.5">
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
              className="flex items-center gap-3 px-6 py-2.5 cursor-pointer transition-opacity hover:opacity-80"
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
            <div className="h-8 w-px bg-white/10" />
            <div className="flex items-center gap-3 px-6 py-2.5">
              <img 
                src="/daystreak.png" 
                alt="Streak" 
                style={{ width: 22, height: 22, objectFit: 'contain' }}
              />
              <div className="leading-tight">
                <div className="text-[20px] font-bold text-[#F0EDE8]">{fritzStreak !== null ? fritzStreak : '…'}</div>
                <div className="text-[12px] text-[#8A879B]">Day Streak</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => authUser ? navigate('stats') : onOpenAuth?.()}
            className="flex items-center gap-4 cursor-pointer transition-opacity hover:opacity-80"
          >
            <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full border border-[#C8922A]/60 bg-[radial-gradient(circle_at_45%_30%,#8A5A2B_0%,#4A2D18_44%,#140F0D_100%)] shadow-[0_0_14px_rgba(200,146,42,0.12)] select-none">
              <span className="text-[17px] font-bold tracking-tight text-[#E1BE82]">{initials}</span>
            </div>
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
        </nav>

        <main className="relative flex-1 px-0 pb-5 pt-10">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]" />
          <div className="text-center">
            <div className="text-[14px] uppercase tracking-[0.32em] text-[#35A5FF] opacity-80">{todayLabel}</div>
            <h1 className="mt-4 text-[72px] font-black leading-[0.9] tracking-[-0.05em] text-[#F3F0E8]">Today&apos;s Challenge</h1>
            <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">Two ways to test your strategy. One daily tradition.</p>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-5 px-14">
            <section className="relative overflow-hidden rounded-[20px] rounded-tl-[5px] border border-[rgba(255,255,255,0.05)] bg-[linear-gradient(180deg,rgba(10,12,18,0.98)_0%,rgba(6,8,12,0.99)_100%)] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),inset_0_-40px_80px_rgba(0,0,0,0.45),0_30px_60px_rgba(0,0,0,0.6)]">
              <div className="absolute inset-0 rounded-[20px] rounded-tl-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.015)]" />
              <div className="pointer-events-none absolute left-0 top-0 h-[34px] w-[34px] bg-[linear-gradient(180deg,rgba(10,12,18,0.98)_0%,rgba(8,10,14,0.99)_100%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_55%,rgba(200,146,42,0.15)_0%,rgba(200,146,42,0.03)_45%,transparent_70%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,214,126,0.03)_0%,transparent_24%)]" />
              <div className="pointer-events-none absolute -left-[44px] -top-[44px] h-[170px] w-[170px] rounded-full bg-[radial-gradient(circle,rgba(233,180,77,0.22)_0%,rgba(233,180,77,0.08)_30%,transparent_70%)] blur-[15px]" />
              <div className="pointer-events-none absolute left-[8px] top-[8px] h-[2px] w-[118px] bg-[linear-gradient(90deg,rgba(233,180,77,0.95),rgba(233,180,77,0.4),transparent)]" />
              <div className="pointer-events-none absolute left-[8px] top-[8px] h-[118px] w-[2px] bg-[linear-gradient(180deg,rgba(233,180,77,0.7),rgba(233,180,77,0.2),transparent)]" />
              <div className="pointer-events-none absolute bottom-[8px] left-[86px] h-[2px] w-[92px] bg-[linear-gradient(90deg,transparent,rgba(233,180,77,0.2),rgba(233,180,77,0.6),transparent)]" />
              <div className="relative flex h-[252px] items-center">
                <div className="pointer-events-none absolute -left-[8px] top-1/2 -translate-y-1/2">
                  <FritzIllustration />
                </div>
                <div className="ml-[196px] flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#EDC468]">Daily Fritz</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">One seeded match. Same deal for everyone.</p>
                  <StatusRow
                    status={fritzStatus}
                    text={fritzStatus === 'completed' && fritzStreak ? `${fritzStreak} Day Streak` : undefined}
                  />
                  <button onClick={() => navigate('dailyFritz')} className="mt-7 flex h-[48px] w-[180px] items-center justify-center gap-4 rounded-[12px] border border-[#C8922A]/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0))] text-[16px] font-semibold text-[#F2EEE7] shadow-[0_0_12px_rgba(200,146,42,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:brightness-110 active:scale-[0.98]">
                    <span>{fritzStatus === 'completed' ? 'View Result' : fritzStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span className="text-[24px] leading-none text-[#E8B840]">›</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="relative overflow-hidden rounded-[20px] rounded-tr-[5px] border border-[rgba(88,142,219,0.2)] bg-[linear-gradient(180deg,rgba(9,12,20,0.98)_0%,rgba(5,7,12,0.99)_100%)] px-7 py-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.035),inset_0_-40px_80px_rgba(0,0,0,0.45),0_30px_60px_rgba(0,0,0,0.6)]">
              <div className="absolute inset-0 rounded-[20px] rounded-tr-[5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.015)]" />
              <div className="pointer-events-none absolute right-0 top-0 h-[34px] w-[34px] bg-[linear-gradient(180deg,rgba(9,12,20,0.98)_0%,rgba(6,8,13,0.99)_100%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_100%_50%,rgba(74,143,212,0.15)_0%,rgba(74,143,212,0.035)_45%,transparent_70%)]" />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_60%,rgba(94,160,244,0.03)_100%)]" />
              <div className="pointer-events-none absolute -right-[44px] -top-[44px] h-[180px] w-[180px] rounded-full bg-[radial-gradient(circle,rgba(74,162,255,0.22)_0%,rgba(74,162,255,0.1)_30%,transparent_70%)] blur-[15px]" />
              <div className="pointer-events-none absolute right-[8px] top-[8px] h-[2px] w-[128px] bg-[linear-gradient(90deg,transparent,rgba(74,162,255,0.4),rgba(74,162,255,0.98))]" />
              <div className="pointer-events-none absolute right-[8px] top-[8px] h-[126px] w-[2px] bg-[linear-gradient(180deg,rgba(74,162,255,0.75),rgba(74,162,255,0.25),transparent)]" />
              <div className="pointer-events-none absolute bottom-[8px] right-[92px] h-[2px] w-[104px] bg-[linear-gradient(90deg,transparent,rgba(74,162,255,0.25),rgba(74,162,255,0.6),transparent)]" />
              <div className="relative flex h-[252px] items-center">
                <div className="flex flex-1 flex-col justify-center">
                  <h2 className="text-[44px] font-bold tracking-[-0.055em] text-[#5A9EEF]">Daily Puzzle</h2>
                  <p className="mt-3 text-[17px] text-[#AAA6B4] leading-relaxed">Find the best scoring play.</p>
                  <StatusRow
                    status={puzzleStatus}
                    text={puzzleStatus === 'completed' && puzzleScore != null ? `Score: ${puzzleScore}` : undefined}
                  />
                  <button onClick={() => navigate('daily')} className="mt-7 flex h-[48px] w-[180px] items-center justify-center gap-4 rounded-[12px] border border-[#3D8FE8]/65 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0))] text-[16px] font-semibold text-[#F2EEE7] shadow-[0_0_12px_rgba(74,143,212,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all hover:brightness-110 active:scale-[0.98]">
                    <span>{puzzleStatus === 'completed' ? 'Review Puzzle' : puzzleStatus === 'started' ? 'Continue' : 'Play Today'}</span>
                    <span className="text-[24px] leading-none text-[#5BAAF8]">›</span>
                  </button>
                </div>
                <div className="pointer-events-none absolute right-[-2px] top-1/2 -translate-y-1/2">
                  <PuzzleIllustration />
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

          <section className="mx-14 mt-4 overflow-hidden rounded-[16px] border border-white/[0.055] bg-[linear-gradient(180deg,rgba(7,9,16,0.90)_0%,rgba(6,8,14,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.024)]">
            <div className="flex">
              {tabs.map((tab) => (
                <button
                  key={tab.label}
                  onClick={() => navigate(tab.mode)}
                  className="relative flex h-[64px] flex-1 items-center justify-center gap-3 border-r border-white/[0.08] last:border-r-0 cursor-pointer transition-opacity hover:opacity-90 active:opacity-75"
                  type="button"
                  style={{ ['--tab-color' as string]: tab.color } as CSSProperties}
                >
                  {tab.mode === 'botSetup' ? <div className="absolute inset-y-0 left-0 right-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.008),rgba(255,255,255,0))]" /> : null}
                  <span
                    className="relative z-10"
                    style={{ color: tab.color }}
                  >
                    <TabIcon icon={tab.icon} color={tab.color} />
                  </span>
                  <span
                    className="relative z-10 text-[16px] font-medium"
                    style={{ color: tab.color }}
                  >
                    {tab.label}
                  </span>
                  <div
                    className="absolute bottom-[2px] left-[20%] h-[3px] w-[60%] rounded-full"
                    style={{
                      backgroundColor: tab.color,
                      opacity: tab.mode === 'botSetup' ? 1 : 0.4,
                      boxShadow: tab.mode === 'botSetup' 
                        ? `0 0 14px ${tab.color}, 0 0 4px white` 
                        : `0 0 8px ${tab.color}`,
                      transition: 'all 240ms ease',
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
