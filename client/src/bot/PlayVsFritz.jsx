import { useState } from "react";
import "./PlayVsFritz.css";

/* ── Difficulty Icons ── */
const IconRookie = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2z"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);
const IconStandard = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <line x1="6"  y1="20" x2="6"  y2="13"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="18" y1="20" x2="18" y2="9"/>
  </svg>
);
const IconElite = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7l4 10h10l4-10-6 6-3-6-3 6-6-6z"/>
  </svg>
);
const IconMaster = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7h7.6l-6 4.6 2.3 7.4L12 17l-6.3 4 2.3-7.4L2 9h7.6z"/>
  </svg>
);

/* ── Badge icons ── */
const IconStar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2l2.4 7h7.6l-6 4.6 2.3 7.4L12 17l-6.3 4 2.3-7.4L2 9h7.6z"/>
  </svg>
);
const IconBolt = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2L4.5 13.5H11L10 22l9-12h-6.5z"/>
  </svg>
);
const IconRobot = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="12" rx="3"/>
    <circle cx="9"  cy="14" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none"/>
    <path d="M9 8V6M15 8V6"/>
  </svg>
);

/* ── Summary icons ── */
const IconBot = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="12" rx="3.5"/>
    <circle cx="9"  cy="14" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="14" r="1.3" fill="currentColor" stroke="none"/>
    <path d="M9 8V6M15 8V6"/>
  </svg>
);
const IconDomino = () => (
  <svg viewBox="0 0 40 28" fill="currentColor" width="36" height="26">
    <rect x="0" y="0" width="18" height="28" rx="3" opacity="0.85"/>
    <circle cx="5.5" cy="7.5" r="2" fill="#0a0e1a" opacity="0.6"/>
    <circle cx="12.5" cy="7.5" r="2" fill="#0a0e1a" opacity="0.6"/>
    <circle cx="5.5" cy="14" r="2" fill="#0a0e1a" opacity="0.6"/>
    <circle cx="12.5" cy="14" r="2" fill="#0a0e1a" opacity="0.6"/>
    <circle cx="5.5" cy="20.5" r="2" fill="#0a0e1a" opacity="0.6"/>
    <circle cx="12.5" cy="20.5" r="2" fill="#0a0e1a" opacity="0.6"/>
    <rect x="0" y="13" width="18" height="1" fill="#0a0e1a" opacity="0.2"/>
    <rect x="22" y="0" width="18" height="28" rx="3" opacity="0.38"/>
    <circle cx="27.5" cy="9"  r="2" fill="#0a0e1a" opacity="0.45"/>
    <circle cx="34.5" cy="9"  r="2" fill="#0a0e1a" opacity="0.45"/>
    <circle cx="31"   cy="19" r="2" fill="#0a0e1a" opacity="0.45"/>
    <rect x="22" y="13" width="18" height="1" fill="#0a0e1a" opacity="0.18"/>
  </svg>
);
const IconBarChart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" strokeLinecap="round">
    <line x1="6"  y1="20" x2="6"  y2="13"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="18" y1="20" x2="18" y2="9"/>
  </svg>
);

/* ── Deal card domino icon ── */
const DominoIcon = () => (
  <svg viewBox="0 0 40 28" fill="currentColor" width="44" height="30">
    <rect x="0" y="0" width="18" height="28" rx="3" opacity="0.8"/>
    <circle cx="5.5" cy="7.5" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <circle cx="12.5" cy="7.5" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <circle cx="5.5" cy="14" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <circle cx="12.5" cy="14" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <circle cx="5.5" cy="20.5" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <circle cx="12.5" cy="20.5" r="2.2" fill="#0a0e1a" opacity="0.55"/>
    <rect x="0" y="13" width="18" height="1.2" fill="#0a0e1a" opacity="0.2"/>
    <rect x="22" y="0" width="18" height="28" rx="3" opacity="0.38"/>
    <circle cx="27.5" cy="9"  r="2.2" fill="#0a0e1a" opacity="0.4"/>
    <circle cx="34.5" cy="9"  r="2.2" fill="#0a0e1a" opacity="0.4"/>
    <circle cx="31"   cy="19" r="2.2" fill="#0a0e1a" opacity="0.4"/>
    <rect x="22" y="13" width="18" height="1.2" fill="#0a0e1a" opacity="0.15"/>
  </svg>
);

/* ── Data ── */
const DIFFICULTIES = [
  { id: "rookie",   label: "Rookie",   elo: 600,  desc: "Learning the game. Good for beginners.",    Icon: IconRookie   },
  { id: "standard", label: "Standard", elo: 1000, desc: "Solid fundamentals. A real challenge.",     Icon: IconStandard },
  { id: "elite",    label: "Elite",    elo: 1800, desc: "Maximum strength. Unforgiving.",             Icon: IconElite    },
  { id: "master",   label: "Master",   elo: 2400, desc: "Sampled endgame search. No mercy.",         Icon: IconMaster   },
];
const DEAL_SIZES = [
  { id: "7",  label: "7 Tiles",  sublabel: "Classic 7-tile format"   },
  { id: "14", label: "14 Tiles", sublabel: "Extended 14-tile format" },
];
const ELO_COLORS = { rookie:"#4CAF50", standard:"#3FA7FF", elite:"#E7B64A", master:"#9B6CFF" };
const BADGES = [
  { Icon: IconStar,  title: "Rated Practice", sub: "Matches affect your practice rating." },
  { Icon: IconBolt,  title: "Instant Match",  sub: "Jump in and play right away."         },
  { Icon: IconRobot, title: "Bot Opponent",   sub: "Consistent. Fair. Always improving."  },
];

/* ── Component ── */
export default function PlayVsFritz({ onBack, onStart }) {
  const [difficulty, setDifficulty] = useState("elite");
  const [dealSize,   setDealSize]   = useState("7");
  const selectedDiff = DIFFICULTIES.find(d => d.id === difficulty);

  return (
    <div className="pvf-root">

      {/* GlobalNav is rendered by the parent — do not render here */}

      <div className="pvf-layout">

        {/* back link — grid-area: back */}
        <span className="pvf-back-btn" onClick={onBack}>← Back to Single Player</span>

        {/* page header — grid-area: header */}
        <div className="pvf-header">
          <div className="pvf-label">Single Player</div>
          <h1 className="pvf-title">Play vs Fritz</h1>
          <p className="pvf-subtitle">Choose your tier and format, then start a match against Fritz.</p>
        </div>

        {/* ===== LEFT: Fritz hero card — grid-area: card ===== */}
        <div className="pvf-opponent-card">

          {/* large robot image */}
          <div className="pvf-robot-scene">
            <img src="/fritz2.png" alt="Fritz AI opponent" className="pvf-robot-img"/>
            <div className="pvf-robot-fade"/>
          </div>

          {/* name + desc */}
          <div className="pvf-opponent-info">
            <div className="pvf-opponent-eyebrow">Your Opponent</div>
            <div className="pvf-opponent-name">Fritz</div>
            <p className="pvf-opponent-desc">
              Fritz is a world-class dominoes AI built to challenge and sharpen your strategy.
              Pick a difficulty, choose your format, and test your skills.
            </p>
          </div>

          {/* badges */}
          <div className="pvf-badges">
            {BADGES.map(({ Icon, title, sub }) => (
              <div key={title} className="pvf-badge">
                <div className="pvf-badge-icon-wrap"><Icon /></div>
                <div className="pvf-badge-title">{title}</div>
                <div className="pvf-badge-sub">{sub}</div>
              </div>
            ))}
          </div>

        </div>

        {/* ===== RIGHT: config panel — grid-area: panel ===== */}
        <div className="pvf-right">

          {/* 1. Difficulty */}
          <div className="pvf-section-label">1. Choose Difficulty</div>
          <div className="pvf-difficulty-grid">
            {DIFFICULTIES.map(({ id, label, elo, desc, Icon }) => (
              <div
                key={id}
                data-tier={id}
                className={`pvf-tier-card${difficulty === id ? " pvf-tier-card--selected" : ""}`}
                onClick={() => setDifficulty(id)}
              >
                {difficulty === id && <div className="pvf-tier-check">✓</div>}
                <div className="pvf-tier-icon"><Icon /></div>
                <div className="pvf-tier-name">{label}</div>
                <div className="pvf-tier-elo" style={{ color: ELO_COLORS[id] }}>{elo}</div>
                <div className="pvf-tier-desc">{desc}</div>
              </div>
            ))}
          </div>

          {/* slider */}
          <div className="pvf-slider-row">
            <div className="pvf-slider-track"/>
            <div className="pvf-slider-marks">
              {DIFFICULTIES.map(({ id, elo }) => (
                <div key={id} className={`pvf-slider-mark${difficulty === id ? " pvf-slider-mark--active" : ""}`}>
                  <div className="pvf-slider-dot"/>
                  <div className="pvf-slider-label">{elo}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="pvf-section-divider"/>

          {/* 2. Deal size */}
          <div className="pvf-section-label">2. Choose Deal Size / Format</div>
          <div className="pvf-deal-grid">
            {DEAL_SIZES.map(({ id, label, sublabel }) => (
              <div
                key={id}
                className={`pvf-deal-card${dealSize === id ? " pvf-deal-card--selected" : ""}`}
                onClick={() => setDealSize(id)}
              >
                {dealSize === id && <div className="pvf-deal-check">✓</div>}
                <div className="pvf-deal-icon"><DominoIcon /></div>
                <div>
                  <div className="pvf-deal-label">{label}</div>
                  <div className="pvf-deal-sub">{sublabel}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="pvf-section-divider"/>

          {/* 3. Match summary */}
          <div className="pvf-section-label">3. Match Summary</div>
          <div className="pvf-summary">
            <div className="pvf-summary-item">
              <div className="pvf-summary-icon pvf-summary-icon--bot"><IconBot /></div>
              <div>
                <div className="pvf-summary-value">Fritz {selectedDiff.label}</div>
                <div className="pvf-summary-key">Difficulty</div>
              </div>
            </div>
            <div className="pvf-summary-divider"/>
            <div className="pvf-summary-item">
              <div className="pvf-summary-icon pvf-summary-icon--tile"><IconDomino /></div>
              <div>
                <div className="pvf-summary-value">{dealSize}-Tile Format</div>
                <div className="pvf-summary-key">Deal Size</div>
              </div>
            </div>
            <div className="pvf-summary-divider"/>
            <div className="pvf-summary-item">
              <div className="pvf-summary-icon pvf-summary-icon--rated"><IconBarChart /></div>
              <div>
                <div className="pvf-summary-value">Practice Match</div>
                <div className="pvf-summary-key">Rated</div>
              </div>
            </div>
          </div>

          {/* CTA */}
          <button className="pvf-start-btn" onClick={() => onStart?.({ difficulty, dealSize })}>
            Start Match <span className="pvf-start-arrow">›</span>
          </button>
          <a className="pvf-view-tiers" href="#" onClick={e => e.preventDefault()}>
            View tier details ›
          </a>

        </div>
      </div>
    </div>
  );
}
