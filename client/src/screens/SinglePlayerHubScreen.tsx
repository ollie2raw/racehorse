import React from "react";
import "./SinglePlayerModes.css";
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';

interface SinglePlayerHubScreenProps {
  onBack: () => void;
  onNavigate: (mode: AppMode) => void;
}

type CardConfig = {
  key: AppMode;
  cardClass: string;
  imgSrc: string;
  imgAlt: string;
  title: string;
  desc: string;
  stats: { label: string; value: string }[];
  variant: 'tier-elite' | 'tier-standard' | 'tier-master';
};

const MODES: CardConfig[] = [
  {
    key: 'botSetup' as AppMode,
    cardClass: 'sp-card-fritz',
    imgSrc: '/fritz2.png',
    imgAlt: 'Fritz AI',
    title: 'Play vs Fritz',
    desc: 'Challenge Fritz, a world-class AI opponent with adaptive difficulty.',
    stats: [
      { label: 'Top Rating', value: '1,742' },
      { label: 'Best Streak', value: '12' },
    ],
    variant: 'tier-elite',
  },
  {
    key: 'ghostSetup' as AppMode,
    cardClass: 'sp-card-ghost',
    imgSrc: '/fritzGHOST.png',
    imgAlt: 'Ghost Mode',
    title: 'Ghost Mode',
    desc: 'Race against your past games. Can you beat your best?',
    stats: [
      { label: 'Best Time', value: '02:48' },
      { label: 'Games Played', value: '24' },
    ],
    variant: 'tier-standard',
  },
  {
    key: 'noBrainer' as AppMode,
    cardClass: 'sp-card-lab',
    imgSrc: '/fritzNOBRAINER.png',
    imgAlt: 'No Brainer Lab',
    title: 'No Brainer Lab',
    desc: 'Solve curated puzzles and expand your domino intuition.',
    stats: [
      { label: 'Puzzles Solved', value: '156' },
      { label: 'Best Streak', value: '18' },
    ],
    variant: 'tier-master',
  },
];

export default function SinglePlayerHubScreen({ onBack, onNavigate }: SinglePlayerHubScreenProps) {
  return (
    <div className="sp-page">
      <GlobalNav currentMode="bot" onNavigate={onNavigate} />

      <div className="sp-container">
        <Button variant="ghost" className="sp-back-btn" onClick={onBack}>
          ← Back to Home
        </Button>

        <div className="sp-hero">
          <h1 className="sp-hero-title">Single Player</h1>
          <p className="sp-subtitle">Sharpen your skills. Master the game at your own pace.</p>
        </div>

        <div className="sp-grid">
          {MODES.map((mode) => (
            <div
              key={mode.key}
              className={`sp-card ${mode.cardClass}`}
              onClick={() => onNavigate(mode.key)}
            >
              <div className="sp-card-image">
                <img src={mode.imgSrc} alt={mode.imgAlt} className="sp-card-img" />
              </div>
              <div className="sp-card-content">
                <div className="sp-card-text">
                  <h2 className="sp-card-title">{mode.title}</h2>
                  <p className="sp-card-desc">{mode.desc}</p>
                </div>
                <div className="sp-stats">
                  {mode.stats.map((stat) => (
                    <div key={stat.label} className="sp-stat-item">
                      <span className="sp-stat-label">{stat.label.toUpperCase()}</span>
                      <span className="sp-stat-value">{stat.value}</span>
                    </div>
                  ))}
                </div>
                <Button
                  variant={mode.variant}
                  size="lg"
                  className="sp-play-btn"
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onNavigate(mode.key);
                  }}
                >
                  Play Now ›
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="sp-more-modes">
          <p className="sp-more-title">More Modes</p>
          <p className="sp-more-subtitle">New challenges coming soon.</p>
          <div className="sp-locked-grid">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="sp-locked-card">
                <div className="sp-lock-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <span className="sp-locked-label">Coming Soon</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
