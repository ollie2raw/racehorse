import type { ReactNode } from 'react';
import { GlobalNav } from '../../components';
import type { AppMode } from '../../types';
import '../../screens/RacehorseHomeArt.css';
import './learnAcademy.css';
import { LearnProgressTrack } from './LearnProgressTrack';
import type { HowToPlayModule } from '../howToPlay/howToPlayModules';
import { LearnActionButton } from './LearnActionButton';

type LearnShellProps = {
  page: number;
  modules: HowToPlayModule[];
  onGoTo: (index: number) => void;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onNavigate?: (mode: AppMode) => void;
  isFirst: boolean;
  coach: ReactNode;
  stage: ReactNode;
};

export function LearnShell({
  page,
  modules,
  onGoTo,
  onBack,
  onPrev,
  onNext,
  onNavigate,
  isFirst,
  coach,
  stage,
}: LearnShellProps) {
  const module = modules[page];

  return (
    <div className="learn-academy-host">
      <div className="pvf-root pvf-root--setup learn-academy tier-elite">
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
          <div className="home-bg__domino home-bg__domino--tl" />
          <div className="home-bg__domino home-bg__domino--tr" />
          <div className="home-bg__line home-bg__line--1" />
          <div className="home-bg__line home-bg__line--2" />
          <div className="home-bg__texture" />
        </div>
        <div className="learn-academy__bokeh" aria-hidden="true" />

        <GlobalNav
          currentMode="learn"
          activeColor="#34D399"
          onNavigate={(mode) => {
            if (mode === 'home') {
              onNavigate?.('home');
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="pvf-layout learn-academy__layout">
          <LearnProgressTrack page={page} modules={modules} onGoTo={onGoTo} />

          <div className="learn-academy__module-card">
            <div
              key={module.id}
              className={`learn-academy__module-inner learn-academy__module-inner--in${
                module.isFinal ? ' learn-academy__module-inner--final' : ''
              }`}
            >
              <div className="learn-academy__coach-col">{coach}</div>
              <div className="learn-academy__stage-col">{stage}</div>
            </div>
          </div>

          {!module.isFinal ? (
            <footer className="learn-academy__dock">
              <button type="button" className="pvf-back-btn" onClick={isFirst ? onBack : onPrev}>
                {isFirst ? '← Exit' : '← Back'}
              </button>
              <button type="button" className="pvf-start-btn learn-academy__start-btn" onClick={onNext}>
                <span>{isFirst ? 'Start' : 'Next'}</span>
                <span className="pvf-start-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            </footer>
          ) : (
            <footer className="learn-academy__dock learn-academy__dock--final">
              <button type="button" className="pvf-back-btn" onClick={onPrev}>
                ← Back
              </button>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}
