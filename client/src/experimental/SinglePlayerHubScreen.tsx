import React from "react";
import "./SinglePlayerModes.css";
import type { AppMode } from '../types';

interface SinglePlayerHubScreenProps {
  onNavigate: (mode: AppMode) => void;
}

export default function SinglePlayerHubScreen({ onNavigate }: SinglePlayerHubScreenProps) {
  return (
    <div className="sp-page">
      <div className="sp-background-glow" />

      <div className="sp-container">
        <button className="sp-back-btn" onClick={() => onNavigate('home')}>
          ← BACK TO HOME
        </button>

        <div className="sp-header">
          <p className="sp-kicker">• SINGLE PLAYER</p>

          <h1>Single Player</h1>

          <p className="sp-subtitle">
            Sharpen your skills. Master the game at your own pace.
          </p>
        </div>

        <div className="sp-grid">
          {/* PLAY VS FRITZ */}
          <div className="sp-card gold">
            <div className="sp-card-image">
              <img src="/fritz2.png" alt="Play vs Fritz" />
            </div>

            <div className="sp-card-overlay" />

            <div className="sp-card-content">
              <h2>Play vs Fritz</h2>

              <p>
                Challenge Fritz, a world-class AI opponent with adaptive
                difficulty.
              </p>

              <div className="sp-stats">
                <div className="sp-stat-box">
                  <span className="sp-stat-label">TOP RATING</span>
                  <span className="sp-stat-value">1,742</span>
                </div>

                <div className="sp-stat-box">
                  <span className="sp-stat-label">BEST STREAK</span>
                  <span className="sp-stat-value">12</span>
                </div>
              </div>

              <button className="sp-play-btn" onClick={() => onNavigate('botSetup')}>
                Play Now
                <span>›</span>
              </button>
            </div>
          </div>

          {/* GHOST MODE */}
          <div className="sp-card blue">
            <div className="sp-card-image">
              <img src="/fritzGHOST.png" alt="Ghost Mode" />
            </div>

            <div className="sp-card-overlay" />

            <div className="sp-card-content">
              <h2>Ghost Mode</h2>

              <p>
                Race against your past games. Can you beat your best?
              </p>

              <div className="sp-stats">
                <div className="sp-stat-box">
                  <span className="sp-stat-label">BEST TIME</span>
                  <span className="sp-stat-value">02:48</span>
                </div>

                <div className="sp-stat-box">
                  <span className="sp-stat-label">GAMES PLAYED</span>
                  <span className="sp-stat-value">24</span>
                </div>
              </div>

              <button className="sp-play-btn" onClick={() => onNavigate('ghost')}>
                Play Now
                <span>›</span>
              </button>
            </div>
          </div>

          {/* NO BRAINER LAB */}
          <div className="sp-card purple">
            <div className="sp-card-image">
              <img
                src="/fritzNOBRAINER.png"
                alt="No Brainer Lab"
              />
            </div>

            <div className="sp-card-overlay" />

            <div className="sp-card-content">
              <h2>No Brainer Lab</h2>

              <p>
                Solve curated puzzles and expand your dominoes intuition.
              </p>

              <div className="sp-stats">
                <div className="sp-stat-box">
                  <span className="sp-stat-label">PUZZLES SOLVED</span>
                  <span className="sp-stat-value">156</span>
                </div>

                <div className="sp-stat-box">
                  <span className="sp-stat-label">BEST STREAK</span>
                  <span className="sp-stat-value">18</span>
                </div>
              </div>

              <button className="sp-play-btn" onClick={() => onNavigate('practice')}>
                Play Now
                <span>›</span>
              </button>
            </div>
          </div>
        </div>

        {/* FUTURE MODES */}
        <p className="sp-coming-soon-note">🔒 More modes coming soon.</p>
      </div>
    </div>
  );
}
