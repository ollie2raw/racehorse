import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import type { AppMode } from '../types';
import '../screens/RacehorseHomeArt.css';
import '../screens/SinglePlayerModes.css';
import './learn.css';
import {
  freezeV2Lesson,
  loadV2AuthoringSession,
  loadV2FrozenLesson,
  type LessonV2AuthoringSession,
} from './lessonV2';
import artCoachPng from '../assets/singlePlayerHub/fritzwave.png';

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

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

type LearnModeCard = {
  id: string;
  unlocked: boolean;
  containerClass: string;
  sectionRounded: string;
  title: string;
  titleColor: string;
  desc: string;
  badges?: string[];
  variant?: 'tier-elite' | 'tier-standard' | 'tier-master';
  chevronColor?: string;
  artSrc?: string;
};

const LEARN_MODE_CARDS: LearnModeCard[] = [
  {
    id: 'guided',
    unlocked: true,
    containerClass: 'daily-fritz-card-container',
    sectionRounded: 'rounded-[20px] rounded-tl-[5px]',
    title: 'Guided Match',
    titleColor: '#E7B64A',
    desc: 'One coached game. Oliver narrates every move.',
    badges: ['60 TURNS', 'COACHING EVERY MOVE', 'FIXED LESSON'],
    variant: 'tier-elite',
    chevronColor: '#FFD76A',
    artSrc: artCoachPng,
  },
  {
    id: 'library',
    unlocked: false,
    containerClass: 'learn-library-card-container',
    sectionRounded: 'rounded-[20px] rounded-tr-[5px]',
    title: 'Lesson Library',
    titleColor: '#34D399',
    desc: 'Short focused lessons on strategy and scoring.',
    artSrc: artCoachPng,
  },
  {
    id: 'drills',
    unlocked: false,
    containerClass: 'learn-drills-card-container',
    sectionRounded: 'rounded-[20px]',
    title: 'Position Drills',
    titleColor: '#22D3EE',
    desc: 'Find the best move from real board positions.',
    artSrc: artCoachPng,
  },
  {
    id: 'replay',
    unlocked: false,
    containerClass: 'learn-replay-card-container',
    sectionRounded: 'rounded-[20px] rounded-br-[5px]',
    title: 'Replay Analysis',
    titleColor: '#A78BFA',
    desc: "Review your past games with Oliver's commentary.",
    artSrc: artCoachPng,
  },
];

interface LearnHomeProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartGuidedGame?: () => void;
  onStartGuidedAuthoring?: () => void;
  onFreezeLesson?: () => void;
  isAdmin?: boolean;
  showAdminView?: boolean;
  onStartGuidedV2Game?: () => void;
  onStartAuthoringV2?: () => void;
}

export default function LearnHome({
  onBack,
  onNavigate,
  onStartGuidedGame: _onStartGuidedGame,
  onStartGuidedAuthoring: _onStartGuidedAuthoring,
  onFreezeLesson: _onFreezeLesson,
  isAdmin,
  showAdminView = false,
  onStartGuidedV2Game,
  onStartAuthoringV2,
}: LearnHomeProps) {
  const [v2AuthoringSession, setV2AuthoringSession] = useState<LessonV2AuthoringSession | null>(null);
  const [_v2FrozenLesson, setV2FrozenLesson] = useState<ReturnType<typeof loadV2FrozenLesson>>(null);
  const [v2FreezeFlash, setV2FreezeFlash] = useState(false);

  useEffect(() => {
    setV2FrozenLesson(loadV2FrozenLesson());
    if (!isAdmin || !showAdminView) return;
    setV2AuthoringSession(loadV2AuthoringSession());
  }, [isAdmin, showAdminView]);

  const handleFreezeV2 = () => {
    const session = loadV2AuthoringSession();
    if (!session) return;
    const frozen = freezeV2Lesson(session);
    setV2AuthoringSession(session);
    setV2FrozenLesson(frozen);
    setV2FreezeFlash(true);
    setTimeout(() => setV2FreezeFlash(false), 2000);
  };

  if (!isAdmin || !showAdminView) {
    return (
      <div
        className="learn-hub-page relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] text-[var(--rh-text)] home-page-root"
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

        <div className="home-shell relative mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col">
          <GlobalNav
            currentMode="learn"
            activeColor="#34D399"
            onNavigate={(mode) => {
              if (mode === 'home') {
                onBack();
                return;
              }
              onNavigate?.(mode);
            }}
          />

          <main className="sp-solo-main learn-hub-main relative flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-5 pt-10 home-main">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]"
              aria-hidden="true"
            />

            <Button variant="ghost" className="absolute left-14 top-10 z-20 rh-back-button" onClick={onBack} type="button">
              ← Back to Home
            </Button>

            <div className="relative z-10 text-center">
              <h1
                className="text-[64px] font-black leading-[0.9] tracking-[-0.03em] text-[var(--rh-text)]"
                style={{ textShadow: '0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)' }}
              >
                Learn
              </h1>
              <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">
                Coach-led practice modes to sharpen your Racehorse strategy.
              </p>
            </div>

            <div className="relative z-10 mt-[42px] grid grid-cols-4 items-stretch gap-5 px-14">
              {LEARN_MODE_CARDS.map((mode) => {
                const isLocked = !mode.unlocked || (mode.id === 'guided' && !isAdmin);

                return (
                  <section
                    key={mode.id}
                    className={`sp-solo-mode-card learn-mode-card ${mode.containerClass} relative box-border flex flex-col overflow-hidden ${mode.sectionRounded}${isLocked ? ' sp-solo-mode-card--locked' : ' cursor-pointer'}`}
                    onClick={isLocked ? undefined : () => onStartGuidedV2Game?.()}
                    aria-disabled={isLocked || undefined}
                  >
                    {isLocked ? (
                      <div className="learn-mode-card__lock" aria-hidden="true">
                        <LockIcon />
                      </div>
                    ) : null}

                    {mode.artSrc ? (
                      <div className="sp-solo-mode-card__art-slot" aria-hidden>
                        <img
                          src={mode.artSrc}
                          alt=""
                          className="sp-solo-mode-card__art"
                          draggable={false}
                          aria-hidden
                        />
                      </div>
                    ) : null}

                    <div className="home-card-scrim" aria-hidden="true" />
                    <div className="home-card-content learn-mode-card__content">
                      <div className="learn-mode-card__body">
                        <div className="sp-solo-mode-card__text">
                          <h2
                            className="learn-mode-card__title"
                            style={{ color: isLocked ? 'rgba(255,255,255,0.42)' : mode.titleColor }}
                          >
                            {mode.title}
                          </h2>
                          <p className={`learn-mode-card__desc ${isLocked ? 'is-muted' : ''}`}>{mode.desc}</p>
                        </div>

                        {mode.badges && mode.badges.length > 0 ? (
                          <div className="learn-mode-card__badges">
                            {mode.badges.map((badge) => (
                              <span key={badge} className="learn-mode-card__badge">
                                {badge}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className={`learn-mode-card__footer${isLocked ? ' learn-mode-card__footer--locked' : ''}`}>
                        {isLocked ? (
                          <div className="learn-mode-card__soon">COMING SOON</div>
                        ) : (
                          <button
                            type="button"
                            className="pvf-start-btn learn-mode-card__play"
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation();
                              onStartGuidedV2Game?.();
                            }}
                            disabled={!onStartGuidedV2Game}
                          >
                            <span>Play</span>
                            <span className="pvf-start-arrow" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Build one fixed coached match cleanly."
      contentClassName="multiplayer-menu-card screen-shell"
    >
      <div className="learn-columns">
        <div className="learn-col">
          <h3 className="learn-col-heading">AUTHOR</h3>
          <button className="learn-start-guided-btn" onClick={onStartAuthoringV2}>
            Start V2 Authoring Session
          </button>
          <p className="learn-cta-sub">Build the event timeline for the new guided match system.</p>
        </div>
        <div className="learn-col">
          {isAdmin ? (
            <>
              <h3 className="learn-col-heading">PUBLISH</h3>
              <button
                className="learn-start-guided-btn"
                onClick={handleFreezeV2}
                disabled={!v2AuthoringSession}
                style={{
                  background: v2FreezeFlash
                    ? 'rgba(60,220,120,0.22)'
                    : 'rgba(60,180,120,0.14)',
                  border: v2FreezeFlash
                    ? '1.5px solid rgba(60,220,120,0.5)'
                    : '1.5px solid rgba(60,180,120,0.32)',
                  color: v2FreezeFlash
                    ? 'rgba(100,255,160,0.95)'
                    : 'rgba(120,230,170,0.88)',
                  opacity: v2AuthoringSession ? 1 : 0.6,
                }}
              >
                {v2FreezeFlash ? '✓ Lesson Frozen' : '❄️ Freeze Fixed Lesson'}
              </button>
              <p className="learn-cta-sub">Promotes the authored event timeline to the live guided lesson</p>
            </>
          ) : null}
        </div>
      </div>
    </LayoutScreen>
  );
}
