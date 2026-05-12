import React, { useState } from "react";
import type { FritzTier } from "./fritzConfig";
import type { BotDealSize } from "./botEngine";
import { DominoTile, GlobalNav } from "../components";
import "./PlayVsFritz.css";

/* ---- High-Fidelity Home Icons ---- */
const IconStar = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 3.7L14.4 8.6L19.8 9.4L15.9 13.2L16.8 18.6L12 16.1L7.2 18.6L8.1 13.2L4.2 9.4L9.6 8.6L12 3.7Z" fill={color} />
  </svg>
);

const IconLightning = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M13 3L5 14H12L11 21L19 10H12L13 3Z" fill={color} />
  </svg>
);

const IconRobotNav = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" stroke={color} strokeWidth="1.7" />
    <circle cx="9" cy="12.5" r="1.6" fill={color} />
    <circle cx="15" cy="12.5" r="1.6" fill={color} />
    <path d="M9.5 16h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 7.5V5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="4.2" r="1.2" fill={color} />
  </svg>
);

const IconLeaf = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8a13 13 0 0 1-13 13L8 20z" />
    <path d="M9 20l-5 3" />
    <path d="M11 20l2 2" />
  </svg>
);

const IconBars = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconCrown = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
  </svg>
);

const IconShield = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </svg>
);

const IconDominoSummary = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="5" y="2" width="14" height="20" rx="2" stroke={color} strokeWidth="2" />
    <line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth="2" />
    <circle cx="9" cy="7" r="1.2" fill={color} />
    <circle cx="15" cy="7" r="1.2" fill={color} />
    <circle cx="12" cy="17" r="1.2" fill={color} />
  </svg>
);

const IconSummaryBars = ({ color = "currentColor" }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round">
    <line x1="6"  y1="20" x2="6"  y2="14"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="18" y1="20" x2="18" y2="10"/>
  </svg>
);

/* ---- Data ---- */
const TIER_COLORS: Record<FritzTier, string> = {
  rookie: "#19D8A2",   // Neon Green
  standard: "#3FA7FF", // Electric Blue
  elite: "#F5A524",    // Gold
  master: "#9B6CFF",   // Purple
};

const DIFFICULTIES: Array<{
  id: FritzTier;
  label: string;
  elo: number;
  desc: string;
  Icon: React.FC;
}> = [
  { id: "rookie", label: "Rookie", elo: 600, desc: "Learning the game. Good for beginners.", Icon: IconLeaf },
  { id: "standard", label: "Standard", elo: 1000, desc: "Solid fundamentals. A real challenge.", Icon: IconBars },
  { id: "elite", label: "Elite", elo: 1800, desc: "Maximum strength. Unforgiving.", Icon: IconCrown },
  { id: "master", label: "Master", elo: 2400, desc: "Sampled endgame search. No mercy.", Icon: IconShield },
];

const DEAL_SIZES: Array<{ id: BotDealSize; label: string; sublabel: string; high: number; low: number }> = [
  { id: 7, label: "7 Tiles", sublabel: "Classic 7-tile format", high: 6, low: 1 },
  { id: 14, label: "14 Tiles", sublabel: "Extended 14-tile format", high: 6, low: 6 },
];

interface PlayVsFritzProps {
  onBack: () => void;
  onStart: (params: { difficulty: FritzTier; dealSize: BotDealSize }) => void;
}

export default function PlayVsFritz({ onBack, onStart }: PlayVsFritzProps) {
  const [difficulty, setDifficulty] = useState<FritzTier>("elite");
  const [dealSize, setDealSize] = useState<BotDealSize>(7);
  const selectedDiff = DIFFICULTIES.find((d) => d.id === difficulty) || DIFFICULTIES[2];
  const dynamicColor = TIER_COLORS[difficulty];

  return (
    <div className="pvf-root" style={{ "--pvf-dynamic-color": dynamicColor } as React.CSSProperties}>
      <GlobalNav 
        currentMode="botSetup"
        onNavigate={(mode) => mode === 'home' ? onBack() : undefined} 
        activeColor={dynamicColor}
      />
      
      <div className="pvf-layout">
        {/* ===== HEADER ===== */}
        <button className="pvf-back-btn" onClick={onBack}>
          <span>←</span> Back to Single Player
        </button>

        <div className="pvf-header">
          <div className="pvf-label">SINGLE PLAYER</div>
          <h1 className="pvf-title">Play vs Fritz</h1>
          <p className="pvf-subtitle">Choose your tier and format, then start a match against Fritz.</p>
        </div>

        {/* ===== LEFT COLUMN (Fritz Card) ===== */}
        <div className="pvf-opponent-card">
          <div className="pvf-robot-scene">
            <img src="/fritz2.png" className="pvf-robot-img" alt="Fritz Robot" />
          </div>
          
          <div className="pvf-opponent-info">
            <div className="pvf-opponent-eyebrow">YOUR OPPONENT</div>
            <h2 className="pvf-opponent-name" style={{ color: dynamicColor }}>Fritz</h2>
            <p className="pvf-opponent-desc">
              Fritz is a world-class AI built to sharpen your strategy.
            </p>
          </div>

          <div className="pvf-badges">
            <div className="pvf-badge">
              <div className="pvf-badge-icon-wrap"><IconStar color="var(--pvf-dynamic-color)" /></div>
              <div className="pvf-badge-content">
                <div className="pvf-badge-title">Rated Practice</div>
                <div className="pvf-badge-sub">Matches affect your practice rating.</div>
              </div>
            </div>

            <div className="pvf-badge">
              <div className="pvf-badge-icon-wrap"><IconLightning color="var(--pvf-dynamic-color)" /></div>
              <div className="pvf-badge-content">
                <div className="pvf-badge-title">Instant Match</div>
                <div className="pvf-badge-sub">Jump in and play right away.</div>
              </div>
            </div>

            <div className="pvf-badge">
              <div className="pvf-badge-icon-wrap"><IconRobotNav color="var(--pvf-dynamic-color)" /></div>
              <div className="pvf-badge-content">
                <div className="pvf-badge-title">Bot Opponent</div>
                <div className="pvf-badge-sub">Consistent. Fair. Always improving.</div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN (Config Panel) ===== */}
        <div className="pvf-right">
          {/* Section 1: Difficulty */}
          <div className="pvf-section">
            <div className="pvf-section-label">1. CHOOSE DIFFICULTY</div>
            <div className="pvf-difficulty-grid">
              {DIFFICULTIES.map(({ id, label, elo, desc, Icon: IconComp }) => (
                <div
                  key={id}
                  data-tier={id}
                  className={`pvf-tier-card${difficulty === id ? " pvf-tier-card--selected" : ""}`}
                  onClick={() => setDifficulty(id)}
                  style={{ 
                    borderColor: difficulty === id ? dynamicColor : undefined,
                    boxShadow: difficulty === id ? `0 0 20px ${dynamicColor}22` : undefined
                  }}
                >
                  {difficulty === id && (
                    <div className="pvf-tier-check" style={{ background: dynamicColor }}>✓</div>
                  )}
                  <div className="pvf-tier-icon">
                    <IconComp />
                  </div>
                  <div className="pvf-tier-name">{label}</div>
                  <div className="pvf-tier-elo" style={{ color: TIER_COLORS[id] }}>{elo}</div>
                  <div className="pvf-tier-desc">{desc}</div>
                </div>
              ))}
            </div>

            <div className="pvf-slider-row">
              <div className="pvf-slider-track" />
              <div className="pvf-slider-marks">
                {DIFFICULTIES.map(({ id, elo }) => (
                  <div
                    key={id}
                    className={`pvf-slider-mark${difficulty === id ? " pvf-slider-mark--active" : ""}`}
                  >
                    <div className="pvf-slider-dot" style={{ background: difficulty === id ? dynamicColor : undefined, boxShadow: difficulty === id ? `0 0 0 2px #040b17, 0 0 0 4px ${dynamicColor}` : undefined }} />
                    <div className="pvf-slider-label" style={{ color: difficulty === id ? dynamicColor : undefined }}>{elo}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Format */}
          <div className="pvf-section-gap">
            <div className="pvf-section-label">2. CHOOSE DEAL SIZE / FORMAT</div>
            <div className="pvf-deal-grid">
              {DEAL_SIZES.map(({ id, label, sublabel, high, low }) => (
                <div
                  key={id}
                  className={`pvf-deal-card${dealSize === id ? " pvf-deal-card--selected" : ""}`}
                  onClick={() => setDealSize(id)}
                  style={{ 
                    borderColor: dealSize === id ? dynamicColor : undefined,
                    boxShadow: dealSize === id ? `inset 0 0 20px ${dynamicColor}11` : undefined
                  }}
                >
                  {dealSize === id && (
                    <div className="pvf-deal-check" style={{ background: dynamicColor }}>✓</div>
                  )}
                  <div className="pvf-deal-icon">
                    <DominoTile tile={{ high, low }} size={32} />
                  </div>
                  <div className="pvf-deal-content">
                    <div className="pvf-deal-label">{label}</div>
                    <div className="pvf-deal-sub">{sublabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Summary & Start */}
          <div className="pvf-section-gap">
            <div className="pvf-section-label">3. MATCH SUMMARY</div>
            <div className="pvf-summary-container">
              <div className="pvf-summary-item">
                <div className="pvf-summary-icon pvf-summary-icon--bot" style={{ color: dynamicColor, borderColor: `${dynamicColor}44`, background: `${dynamicColor}11` }}>
                  <IconRobotNav />
                </div>
                <div>
                  <div className="pvf-summary-value">Fritz {selectedDiff.label}</div>
                  <div className="pvf-summary-key">Difficulty</div>
                </div>
              </div>
              <div className="pvf-summary-divider" />
              <div className="pvf-summary-item">
                <div className="pvf-summary-icon pvf-summary-icon--tile">
                  <IconDominoSummary />
                </div>
                <div>
                  <div className="pvf-summary-value">{dealSize}-Tile Format</div>
                  <div className="pvf-summary-key">Deal Size</div>
                </div>
              </div>
              <div className="pvf-summary-divider" />
              <div className="pvf-summary-item">
                <div className="pvf-summary-icon pvf-summary-icon--rated">
                  <IconSummaryBars />
                </div>
                <div>
                  <div className="pvf-summary-value">Practice Match</div>
                  <div className="pvf-summary-key">Rated</div>
                </div>
              </div>
            </div>

            <button
              className="pvf-start-btn"
              onClick={() => onStart({ difficulty, dealSize })}
              style={{ 
                background: `linear-gradient(180deg, ${dynamicColor} 0%, ${dynamicColor}CC 100%)`,
                boxShadow: `0 0 32px ${dynamicColor}33, inset 0 1px 0 rgba(255,255,255,0.4)`
              }}
            >
              <span>Start Match</span>
              <span className="pvf-start-arrow">›</span>
            </button>

            <a className="pvf-view-tiers" href="#" onClick={(e) => e.preventDefault()}>
              View tier details ›
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
