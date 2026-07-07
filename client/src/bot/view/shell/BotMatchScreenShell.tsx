import type { ReactNode, RefObject } from 'react';

type BotMatchScreenShellProps = {
  rootRef: RefObject<HTMLDivElement | null>;
  mode: 'bot' | 'ghost' | 'daily-fritz';
  isDailyFritzMode: boolean;
  dailyFritzBoardHasPlay: boolean;
  isLessonLayoutMode: boolean;
  children: ReactNode;
};

export function BotMatchLessonBackground() {
  return (
    <div className="home-bg" aria-hidden="true">
      <div className="home-bg__halo" />
      <div className="home-bg__domino home-bg__domino--tl" />
      <div className="home-bg__domino home-bg__domino--tr" />
      <div className="home-bg__line home-bg__line--1" />
      <div className="home-bg__line home-bg__line--2" />
      <div className="home-bg__line home-bg__line--3" />
      <div className="home-bg__texture" />
    </div>
  );
}

export function BotMatchScreenShell({
  rootRef,
  mode,
  isDailyFritzMode,
  dailyFritzBoardHasPlay,
  isLessonLayoutMode,
  children,
}: BotMatchScreenShellProps) {
  return (
    <div
      ref={rootRef}
      className={`screen game-screen walnut-live theme-green bot-match-screen rh-match-live bot-match-mode-${mode} ${isDailyFritzMode && dailyFritzBoardHasPlay ? 'df-board-has-play' : ''} ${isLessonLayoutMode ? 'learn-lesson-screen learn-pvf-root pvf-root tier-rookie claude-mode-screen-shell' : ''}`}
    >
      {isLessonLayoutMode && <BotMatchLessonBackground />}
      {children}
    </div>
  );
}