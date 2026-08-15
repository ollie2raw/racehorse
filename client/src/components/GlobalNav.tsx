import React, { useState, useEffect, useMemo } from 'react';
import { BrandLogo } from './BrandLogo';
import { AppBottomTabBar } from './nav/AppBottomTabBar';
import { useAuth } from '../auth/useAuth';
import { fetchFriends } from '../friends/friendsApi';
import type { AppMode } from '../types';

/**
 * Each route mounts its own `<GlobalNav />`, so local state resets on navigation.
 * Keep last-known HUD values in module scope (per signed-in user) so rating / friends
 * do not flash placeholders while friends refetch or profile is briefly incomplete.
 */
const globalNavHudCache: {
  userId: string | null;
  ratingDisplay: string | null;
  friendCount: number | null;
} = {
  userId: null,
  ratingDisplay: null,
  friendCount: null,
};

interface GlobalNavProps {
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  currentMode?: AppMode;
  activeColor?: string; // Optional dynamic override
  /** Slightly shorter bar + padding for dense hub screens. */
  compactChrome?: boolean;
  /** Denser navy bar for mock-heavy screens; still uses the shared Racehorse atmosphere. */
  solidDarkChrome?: boolean;
}

const TABS: { label: string; mode: AppMode; activeModes: AppMode[] }[] = [
  { label: 'Multiplayer', mode: 'multiplayer', activeModes: ['multiplayer'] },
  { label: 'Single Player', mode: 'singlePlayerHub', activeModes: ['singlePlayerHub', 'journey', 'botSetup', 'ghostSetup', 'dailyFritz', 'daily'] },
  { label: 'Tournament', mode: 'tournament', activeModes: ['tournament'] },
  { label: 'Social', mode: 'feed', activeModes: ['feed', 'friends', 'leaderboard', 'profile', 'stats'] },
  { label: 'Learn', mode: 'learn', activeModes: ['learn', 'noBrainer'] },
];

const TAB_COLORS: Record<string, string> = {
  'Single Player': '#9B6CFF', // Purple
  'Multiplayer': '#3FA7FF',   // Blue
  'Learn': '#19D8A2',         // Green
  'Tournament': '#F5A524',    // Gold
  'Social': '#0ea5e9',        // Cyan
};

export function GlobalNav({
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  currentMode,
  activeColor,
  compactChrome,
  solidDarkChrome,
}: GlobalNavProps) {
  const { user: authUser, profile: authProfile } = useAuth();
  const authUserId = authUser?.id ?? null;
  const [friendCountOwnerId, setFriendCountOwnerId] = useState<string | null>(null);
  const [friendCountFetched, setFriendCountFetched] = useState<number | null>(null);
  if (authUserId !== friendCountOwnerId) {
    setFriendCountOwnerId(authUserId);
    setFriendCountFetched(null);
  }

  useEffect(() => {
    if (!authUser) {
      globalNavHudCache.userId = null;
      globalNavHudCache.ratingDisplay = null;
      globalNavHudCache.friendCount = null;
      return;
    }
    if (authUser.id !== globalNavHudCache.userId) {
      globalNavHudCache.friendCount = null;
    }
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.id) return;
    if (authProfile?.glicko_rating == null) return;
    globalNavHudCache.userId = authUser.id;
    globalNavHudCache.ratingDisplay = Math.round(Number(authProfile.glicko_rating)).toLocaleString();
  }, [authUser?.id, authProfile?.glicko_rating]);

  useEffect(() => {
    if (!authUser?.id) return;
    fetchFriends(authUser.id)
      .then(({ friends }) => {
        const n = friends.length;
        globalNavHudCache.userId = authUser.id;
        globalNavHudCache.friendCount = n;
        setFriendCountFetched(n);
      })
      .catch(() => {
        globalNavHudCache.userId = authUser.id;
        globalNavHudCache.friendCount = 0;
        setFriendCountFetched(0);
      });
  }, [authUser?.id]);

  const rating =
    authProfile?.glicko_rating != null
      ? Math.round(Number(authProfile.glicko_rating)).toLocaleString()
      : !authUser
        ? '—'
        : globalNavHudCache.userId === authUser.id && globalNavHudCache.ratingDisplay != null
          ? globalNavHudCache.ratingDisplay
          : '…';

  const friendCountDisplay =
    friendCountFetched !== null
      ? friendCountFetched
      : authUser && globalNavHudCache.userId === authUser.id && globalNavHudCache.friendCount !== null
        ? globalNavHudCache.friendCount
        : null;

  const initials = useMemo(() => {
    const username = authProfile?.username;
    if (!username) return authUser ? '?' : '→';
    const parts = username.replace(/[^a-zA-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    const init = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
    return init || username.slice(0, 2).toUpperCase();
  }, [authProfile?.username, authUser]);

  const displayName = authProfile?.username ?? (authUser ? 'Loading…' : 'Sign In');

  const todayLabel = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }).toUpperCase();

  const isHome = currentMode === 'home' || !currentMode;

  return (
    <>
    <nav 
      className={`relative shrink-0 w-full z-50 ${compactChrome ? 'h-[66px]' : 'h-[78px]'}`}
      style={{
        boxSizing: 'border-box',
        overflow: 'visible',
        background: solidDarkChrome
          ? 'linear-gradient(180deg, rgba(0, 1, 4, 0.9), rgba(0, 1, 4, 0.76))'
          : 'linear-gradient(180deg, rgba(0, 1, 4, 0.72), rgba(0, 1, 4, 0.46))',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        boxShadow: solidDarkChrome
          ? 'inset 0 -1px 0 rgba(255, 255, 255, 0.05)'
          : 'inset 0 -1px 0 rgba(255, 255, 255, 0.035)',
        fontFamily: "'Outfit', system-ui, sans-serif",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[-26px] h-[40px]"
        style={{
          background: 'linear-gradient(180deg, rgba(2, 4, 10, 0.22) 0%, rgba(2, 4, 10, 0.08) 48%, rgba(2, 4, 10, 0) 100%)',
        }}
      />
      <div className={`relative flex h-full items-center justify-between max-w-[1440px] mx-auto w-full ${compactChrome ? 'px-7' : 'px-9'}`}>
        {/* Left: Brand & Identity */}
        <button
          type="button"
          aria-label="Racehorse home"
          className="rh-nav-brand flex min-w-[280px] cursor-pointer items-center border-0 bg-transparent p-0 text-inherit"
          onClick={() => onNavigate?.('home')}
        >
          <BrandLogo
            iconSize={compactChrome ? 40 : 44}
            showWordmark={false}
            borderColor={
              solidDarkChrome
                ? '#ffffff'
                : activeColor
                  ? `color-mix(in srgb, ${activeColor} 60%, transparent)`
                  : undefined
            }
          />
          <div 
            className="uppercase text-white"
            style={{ 
              marginLeft: '14px',
              fontSize: '22px',
              fontWeight: 900,
              letterSpacing: '0.05em',
              fontFamily: "'Montserrat', sans-serif"
            }}
          >
            RACEHORSE
          </div>
        </button>

        {/* Center Content Logic (The Switch) */}
        <div className={`rh-nav-center-desktop absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center ${compactChrome ? 'gap-6' : 'gap-8'}`}>
          {isHome ? (
            <div 
              className="uppercase"
              style={{ 
                fontSize: '13px', 
                fontWeight: 800, 
                letterSpacing: '0.2em', 
                color: 'var(--text-muted)'
              }}
            >
              {todayLabel}
            </div>
          ) : (
            <div className={`flex items-center ${compactChrome ? 'gap-6' : 'gap-8'}`}>
              {TABS.map((tab) => {
                const isActive = tab.activeModes.includes(currentMode as AppMode);
                const accentColor = (isActive && activeColor) || TAB_COLORS[tab.label] || 'var(--tier-elite)';
                const textColor = isActive
                  ? (tab.label === 'Social' && activeColor ? 'var(--text-primary)' : accentColor)
                  : 'var(--text-muted)';

                return (
                  <button
                    key={tab.label}
                    onClick={() => onNavigate?.(tab.mode)}
                    className="relative py-2 transition-all"
                    style={{
                      fontSize: compactChrome ? '16px' : '17px',
                      fontWeight: 600,
                      color: textColor,
                      opacity: isActive ? 1 : 0.7,
                    }}
                  >
                    {tab.label}
                    {isActive && (
                      <div
                        className={`rh-glow-underline rh-glow-underline--global-nav${compactChrome ? ' is-compact' : ''}`}
                        style={{ ['--rh-glow-underline-color' as string]: accentColor } as React.CSSProperties}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Player Statistics */}
        <div className="rh-nav-stats flex items-center min-w-[280px] justify-end">
          {/* Rating */}
          <div className="flex items-center gap-3 px-5 py-2.5">
            <svg width="20" height="20" viewBox="0 0 24 24" fill={activeColor ?? 'var(--tier-elite)'} xmlns="http://www.w3.org/2000/svg">
              <path d="M12 3.7L14.4 8.6L19.8 9.4L15.9 13.2L16.8 18.6L12 16.1L7.2 18.6L8.1 13.2L4.2 9.4L9.6 8.6L12 3.7Z" />
            </svg>
            <div className="leading-tight">
              <div 
                style={{ fontSize: '18px', fontWeight: 700, color: 'white' }}
              >
                {rating}
              </div>
              <div 
                style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}
              >
                Rating
              </div>
            </div>
          </div>

          <div className="mx-1 h-[28px] w-px bg-white/5" />

          {/* Friends Count */}
          <button
            type="button"
            onClick={() => onNavigate?.('friends')}
            className="flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-opacity hover:opacity-80"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 11C11.2091 11 13 9.20914 13 7C13 4.79086 11.2091 3 9 3C6.79086 3 5 4.79086 5 7C5 9.20914 6.79086 11 9 11Z" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="leading-tight text-left">
              <div 
                style={{ fontSize: '18px', fontWeight: 700, color: 'white' }}
              >
                {friendCountDisplay !== null ? friendCountDisplay : authUser ? '…' : '—'}
              </div>
              <div 
                style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}
              >
                Friends
              </div>
            </div>
          </button>

          <div className="mx-1 h-[28px] w-px bg-white/5" />

          <div className="flex items-center gap-4 pl-5">
            {/* Avatar */}
            <button
              type="button"
              onClick={() => onNavigate?.('stats')}
              className="flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#C8922A]/60 bg-[radial-gradient(circle_at_45%_30%,#8A5A2B_0%,#4A2D18_44%,#140F0D_100%)] shadow-[0_0_14px_rgba(200,146,42,0.12)] select-none cursor-pointer transition-opacity hover:opacity-80 active:scale-95 overflow-hidden flex-shrink-0"
              aria-label="View Stats"
            >
              <span 
                style={{ fontSize: '15px', fontWeight: 700, color: 'var(--tier-elite)', letterSpacing: '-0.02em' }}
              >
                {initials}
              </span>
            </button>

            {/* Username */}
            <button
              type="button"
              onClick={() => (authUser ? onOpenAccount?.() : onOpenAuth?.())}
              className="flex items-center gap-3 cursor-pointer transition-opacity hover:opacity-80"
            >
              <div 
                style={{ fontSize: '15px', fontWeight: 600, color: 'white' }}
              >
                {displayName}
              </div>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="var(--text-secondary)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </nav>
    <AppBottomTabBar
      currentMode={currentMode}
      activeColor={activeColor}
      onNavigate={onNavigate}
    />
    </>
  );
}
