import React, { useState } from "react";
import type { FritzTier } from "./fritzConfig";
import type { BotDealSize } from "./botEngine";
import { FRITZ_DIFFICULTY_FAIRNESS_NOTE } from "./fritzTrustCopy";
import type { AppMode } from "../types";
import { DominoTile, GlobalNav } from "../components";
import { resolveDefaultPvfFritzTier, writeStoredPvfFritzTier } from "./pvfTierPreference";
import pvfHeroImg from "../assets/bot/playfritz2png.png";
import "./PlayVsFritz.css";

/* ---- High-Fidelity Home Icons ---- */
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

const IconRookie = ({ size = 26 }: { size?: number }) => (
  <img 
    src="/rookieICON.png?v=2" 
    alt="Rookie Icon" 
    style={{ width: size, height: size, objectFit: 'contain' }} 
  />
);

const IconBars = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconCrown = ({ color = "currentColor", size = 30 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" fill={color} />
  </svg>
);

const IconGoat = ({ size = 26 }: { size?: number }) => (
  <img 
    src="/GOATicon.png" 
    alt="Master Icon" 
    style={{ width: size, height: size, objectFit: 'contain' }} 
  />
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

const IconDomino7 = ({ color: _color = "rgba(255,255,255,0.85)", size = 32 }: { color?: string; size?: number }) => (
  <svg width={size * 0.75} height={size} viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="2" width="16" height="28" rx="2" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    <line x1="4" y1="16" x2="20" y2="16" stroke="rgba(255,255,255,0.9)" strokeWidth="2" />
    {/* Top: 3 pips diagonal */}
    <circle cx="8" cy="6" r="1.5" fill="rgba(255,255,255,0.9)" />
    <circle cx="12" cy="9" r="1.5" fill="rgba(255,255,255,0.9)" />
    <circle cx="16" cy="12" r="1.5" fill="rgba(255,255,255,0.9)" />
    {/* Bottom: 4 pips corners */}
    <circle cx="8" cy="20" r="1.5" fill="rgba(255,255,255,0.9)" />
    <circle cx="16" cy="20" r="1.5" fill="rgba(255,255,255,0.9)" />
    <circle cx="8" cy="26" r="1.5" fill="rgba(255,255,255,0.9)" />
    <circle cx="16" cy="26" r="1.5" fill="rgba(255,255,255,0.9)" />
  </svg>
);

const IconDomino14 = ({ color = "rgba(255,255,255,0.85)", size = 32 }: { color?: string; size?: number }) => (
  <svg width={size * 0.95} height={size} viewBox="0 0 30 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Left tile: double-1 — one pip centered in each half */}
    <rect x="1" y="1" width="12" height="30" rx="2.5" stroke={color} strokeWidth="1.5" />
    <line x1="1" y1="16" x2="13" y2="16" stroke={color} strokeWidth="1" />
    <circle cx="7" cy="9.5" r="1.5" fill={color} />
    <circle cx="7" cy="23.5" r="1.5" fill={color} />

    {/* Right tile: double-2 — diagonal pips in each half */}
    <rect x="17" y="1" width="12" height="30" rx="2.5" stroke={color} strokeWidth="1.5" />
    <line x1="17" y1="16" x2="29" y2="16" stroke={color} strokeWidth="1" />
    <circle cx="20.5" cy="7" r="1.5" fill={color} />
    <circle cx="25.5" cy="11" r="1.5" fill={color} />
    <circle cx="20.5" cy="21" r="1.5" fill={color} />
    <circle cx="25.5" cy="25" r="1.5" fill={color} />
  </svg>
);

/* ---- Data ---- */
const TIER_COLORS: Record<FritzTier, string> = {
  rookie: "#4ADE80",   // Rookie Green
  standard: "#3B82F6", // Standard Blue
  elite: "#E7B64A",    // Elite Gold
  master: "#A855F7",   // Master Purple
};

const DIFFICULTIES: Array<{
  id: FritzTier;
  label: string;
  roleLabel: string;
  approxStrength: string;
  desc: string;
  Icon: React.FC<any>;
}> = [
  {
    id: "rookie",
    label: "Rookie",
    roleLabel: "Learning",
    approxStrength: "~800",
    desc: "Forgiving learning opponent.",
    Icon: IconRookie,
  },
  {
    id: "standard",
    label: "Standard",
    roleLabel: "Balanced",
    approxStrength: "~1200",
    desc: "Balanced casual opponent.",
    Icon: IconBars,
  },
  {
    id: "elite",
    label: "Elite",
    roleLabel: "Competitive",
    approxStrength: "~1700",
    desc: "Strong competitive opponent.",
    Icon: IconCrown,
  },
  {
    id: "master",
    label: "Master",
    roleLabel: "Expert",
    approxStrength: "~2200",
    desc: "Brutal expert challenge.",
    Icon: IconGoat,
  },
];

const DEAL_SIZES: Array<{ id: BotDealSize; label: string; sublabel: string; Icon: React.FC<any> }> = [
  { id: 7, label: "7 Tiles", sublabel: "Classic 7-tile format", Icon: IconDomino7 },
  { id: 14, label: "14 Tiles", sublabel: "Extended 14-tile format", Icon: IconDomino14 },
];

interface PlayVsFritzProps {
  onBack: () => void;
  onStart: (params: { difficulty: FritzTier; dealSize: BotDealSize }) => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

export default function PlayVsFritz({ 
  onBack, 
  onStart, 
  onNavigate, 
  onOpenAuth, 
  onOpenAccount 
}: PlayVsFritzProps) {
  const [difficulty, setDifficulty] = useState<FritzTier>(() => resolveDefaultPvfFritzTier());
  const [dealSize, setDealSize] = useState<BotDealSize>(7);
  const selectedDiff = DIFFICULTIES.find((d) => d.id === difficulty) ?? DIFFICULTIES[1];
  const dynamicColor = TIER_COLORS[difficulty];

  const selectDifficulty = (tier: FritzTier): void => {
    setDifficulty(tier);
    writeStoredPvfFritzTier(tier);
  };

  return (
    <div className={`pvf-root pvf-root--setup tier-${difficulty}`} style={{ "--pvf-dynamic-color": dynamicColor } as React.CSSProperties}>
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>
      <GlobalNav 
        currentMode="botSetup"
        onNavigate={onNavigate || ((mode) => mode === 'home' ? onBack() : undefined)} 
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor={dynamicColor}
      />
      
      <div className="pvf-layout">
        {/* ===== LEFT COLUMN (Title + Fritz Card) ===== */}
        <div className="pvf-left-col">
          <button className="pvf-back-btn rh-back-button" onClick={onBack}>
            <span>←</span> Back to Single Player
          </button>

          <div className="pvf-header">
            <div className="pvf-label">SINGLE PLAYER</div>
            <h1 className="pvf-title">Play vs Fritz</h1>
            <p className="pvf-subtitle">Choose your tier and format, then start a match against Fritz.</p>
          </div>

          <div className="pvf-opponent-card">
            {/* 1. Background Image */}
            <img src={pvfHeroImg} className="pvf-card-bg-img" alt="Fritz Robot" />
            
            {/* 2. Gradient Overlay */}
            <div className="pvf-card-overlay" />

            {/* 3. Content Layer */}
            <div className="pvf-card-content">
              {/* Top: Header */}
              <div className="pvf-card-header">
                <div className="pvf-card-eyebrow">YOUR OPPONENT</div>
                <h2 className="pvf-card-name">Fritz</h2>
                <p className="pvf-card-description">
                  Fritz is a world-class dominoes bot built to challenge and sharpen your strategy.
                  Pick a difficulty, choose your format, and test your skills.
                </p>
                <p className="pvf-card-description pvf-card-description--muted">{FRITZ_DIFFICULTY_FAIRNESS_NOTE}</p>
              </div>

              {/* Bottom: Badges Row */}
              <div className="pvf-card-badges">
                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <selectedDiff.Icon color="var(--pvf-dynamic-color)" size={14} />
                    <span className="pvf-card-badge-title">Rated Practice</span>
                  </div>
                  <div className="pvf-card-badge-desc">Matches affect practice rating.</div>
                </div>

                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <IconLightning color="var(--pvf-dynamic-color)" />
                    <span className="pvf-card-badge-title">Instant Match</span>
                  </div>
                  <div className="pvf-card-badge-desc">Jump in and play right away.</div>
                </div>

                <div className="pvf-card-badge">
                  <div className="pvf-card-badge-header">
                    <IconRobotNav color="var(--pvf-dynamic-color)" />
                    <span className="pvf-card-badge-title">Bot Opponent</span>
                  </div>
                  <div className="pvf-card-badge-desc">Consistent. Fair. Improving.</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ===== RIGHT COLUMN (Control Panel) ===== */}
        <div className="pvf-control-panel">
          {/* Section 1: Difficulty */}
          <div className="pvf-section">
            <div className="fritz-section-label">1. CHOOSE DIFFICULTY</div>
            <div className="pvf-difficulty-grid">
              {DIFFICULTIES.map(({ id, label, roleLabel, approxStrength, desc, Icon: IconComp }) => (
                <div
                  key={id}
                  data-tier={id}
                  className={`pvf-tier-card${difficulty === id ? " pvf-tier-card--selected" : ""}`}
                  onClick={() => selectDifficulty(id)}
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
                  <div className="pvf-tier-elo" style={{ color: TIER_COLORS[id] }}>{roleLabel}</div>
                  <div className="pvf-tier-approx">Approx. strength {approxStrength}</div>
                  <div className="pvf-tier-desc">{desc}</div>
                </div>
              ))}
            </div>

            <div className="pvf-slider-row">
              <div className="pvf-slider-track" />
              <div className="pvf-slider-marks">
                {DIFFICULTIES.map(({ id, roleLabel }) => (
                  <div
                    key={id}
                    className={`pvf-slider-mark${difficulty === id ? " pvf-slider-mark--active" : ""}`}
                    onClick={() => selectDifficulty(id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        selectDifficulty(id);
                      }
                    }}
                  >
                    <div className="pvf-slider-dot" style={{ background: difficulty === id ? dynamicColor : undefined, boxShadow: difficulty === id ? `0 0 0 2px #040b17, 0 0 0 4px ${dynamicColor}` : undefined }} />
                    <div className="pvf-slider-label" style={{ color: difficulty === id ? dynamicColor : undefined }}>{roleLabel}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Format */}
          <div className="pvf-section-gap">
            <div className="fritz-section-label">2. CHOOSE DEAL SIZE / FORMAT</div>
            <div className="pvf-deal-grid">
              {DEAL_SIZES.map(({ id, label, sublabel, Icon: IconComp }) => (
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
                    <IconComp size={24} />
                  </div>
                  <div className="pvf-deal-content">
                    <div className="pvf-deal-label" style={{ color: dealSize === id ? dynamicColor : '#fff' }}>{label}</div>
                    <div className="pvf-deal-sub">{sublabel}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: Summary & Start */}
          <div className="pvf-section-gap">
            <div className="fritz-section-label">3. MATCH SUMMARY</div>
            <div className="fritz-summary-strip fritz-summary-strip--mb-lg">
              <div className="fritz-summary-item">
                <div className="fritz-summary-icon pvf-summary-icon--bot" style={{ color: dynamicColor }}>
                  <IconRobotNav />
                </div>
                <div>
                  <div className="fritz-summary-value">{selectedDiff.label} · {selectedDiff.roleLabel}</div>
                  <div className="fritz-summary-key">Difficulty</div>
                </div>
              </div>
              <div className="fritz-summary-divider" aria-hidden />
              <div className="fritz-summary-item">
                <div className="fritz-summary-icon fritz-summary-icon--tile">
                  {dealSize === 7 ? (
                    <IconDomino7 size={20} />
                  ) : (
                    <IconDomino14 size={20} />
                  )}
                </div>
                <div>
                  <div className="fritz-summary-value">{dealSize}-Tile Format</div>
                  <div className="fritz-summary-key">Deal Size</div>
                </div>
              </div>
              <div className="fritz-summary-divider" aria-hidden />
              <div className="fritz-summary-item">
                <div className="fritz-summary-icon pvf-summary-icon--rated" style={{ color: dynamicColor }}>
                  <IconSummaryBars />
                </div>
                <div>
                  <div className="fritz-summary-value">Practice Match</div>
                  <div className="fritz-summary-key">Rated</div>
                </div>
              </div>
            </div>

            <button
              className="pvf-start-btn"
              onClick={() => {
                writeStoredPvfFritzTier(difficulty);
                onStart({ difficulty, dealSize });
              }}
              style={{ 
                background: `linear-gradient(180deg, ${dynamicColor} 0%, ${dynamicColor}CC 100%)`,
                boxShadow: `0 0 32px ${dynamicColor}33, inset 0 1px 0 rgba(255,255,255,0.4)`
              }}
            >
              <span>Start Match</span>
              <span className="pvf-start-arrow">›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
