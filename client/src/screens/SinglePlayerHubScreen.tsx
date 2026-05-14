import React from "react";
import type { CSSProperties } from "react";
import "./RacehorseHomeArt.css";
import "./SinglePlayerModes.css";
import type { AppMode } from "../types";
import { GlobalNav } from "../components";
import { Button } from "../components/primitives";
import artFritzPng from "../assets/singlePlayerHub/fritzwave.png";
import artGhostPng from "../assets/singlePlayerHub/fritzGHOST.png";
import artLabPng from "../assets/singlePlayerHub/fritzNOBRAINER.png";

interface SinglePlayerHubScreenProps {
  onBack: () => void;
  onNavigate: (mode: AppMode) => void;
}

type CardConfig = {
  key: AppMode;
  containerClass: string;
  /** Vite-resolved URL — bundled with the client, not dependent on `/public` at runtime */
  artSrc: string;
  sectionRounded: string;
  title: string;
  titleColor: string;
  desc: string;
  stats: { icon: StatIconName; label: string; value: string }[];
  variant: "tier-elite" | "tier-standard" | "tier-master";
  chevronColor: string;
};

type StatIconName = "crown" | "bolt" | "clock" | "bars" | "puzzle";

function StatIcon({ icon }: { icon: StatIconName }) {
  switch (icon) {
    case "crown":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 8.5 8.5 13l3.5-7 3.5 7 5-4.5-1.8 9H5.3l-1.8-9Z" />
          <path d="M6 20h12" />
        </svg>
      );
    case "bolt":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m13 2-8 12h6l-1 8 9-13h-6l0-7Z" />
        </svg>
      );
    case "clock":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "bars":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 20V10" />
          <path d="M12 20V4" />
          <path d="M19 20v-7" />
        </svg>
      );
    case "puzzle":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3h6v4a2 2 0 1 0 0 4v4h-4a2 2 0 1 1-4 0H3V9h4a2 2 0 1 0 4 0V3Z" />
        </svg>
      );
    default:
      return null;
  }
}

const MODES: CardConfig[] = [
  {
    key: "botSetup" as AppMode,
    containerClass: "daily-fritz-card-container",
    sectionRounded: "rounded-[20px] rounded-tl-[5px]",
    title: "Play vs Fritz",
    titleColor: "#E7B64A",
    desc: "Challenge Fritz, a world-class AI opponent with adaptive difficulty.",
    stats: [
      { icon: "crown", label: "Top Rating", value: "1,742" },
      { icon: "bolt", label: "Best Streak", value: "12" },
    ],
    variant: "tier-elite",
    chevronColor: "#FFD76A",
    artSrc: artFritzPng,
  },
  {
    key: "ghostSetup" as AppMode,
    containerClass: "daily-puzzle-card-container",
    sectionRounded: "rounded-[20px] rounded-tr-[5px]",
    title: "Ghost Mode",
    titleColor: "#4FC3F7",
    desc: "Race against your past games. Can you beat your best?",
    stats: [
      { icon: "clock", label: "Best Time", value: "02:48" },
      { icon: "bars", label: "Games Played", value: "24" },
    ],
    variant: "tier-standard",
    chevronColor: "#4FC3F7",
    artSrc: artGhostPng,
  },
  {
    key: "noBrainer" as AppMode,
    containerClass: "sp-lab-mode-card-container",
    sectionRounded: "rounded-[20px] rounded-tr-[5px]",
    title: "No Brainer Lab",
    titleColor: "#C77DFF",
    desc: "Solve curated puzzles and expand your domino intuition.",
    stats: [
      { icon: "puzzle", label: "Puzzles Solved", value: "156" },
      { icon: "bolt", label: "Best Streak", value: "18" },
    ],
    variant: "tier-master",
    chevronColor: "#C77DFF",
    artSrc: artLabPng,
  },
];

const themeVars = {
  "--rh-bg": "#050911",
  "--rh-panel": "#09101A",
  "--rh-panel-2": "#0B121D",
  "--rh-brass": "#D7A64A",
  "--rh-blue": "#4A8FD4",
  "--rh-green": "#67D957",
  "--rh-violet": "#8B5CF6",
  "--rh-cyan": "#20D1C7",
  "--rh-orange": "#F2A63A",
  "--rh-text": "#F2EEE8",
  "--rh-muted": "#7A778A",
} as CSSProperties;

export default function SinglePlayerHubScreen({ onBack, onNavigate }: SinglePlayerHubScreenProps) {
  return (
    <div
      className="relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] text-[var(--rh-text)] home-page-root"
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
        <GlobalNav currentMode="singlePlayerHub" activeColor="#E7B64A" onNavigate={onNavigate} />

        <main className="sp-solo-main relative flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-5 pt-10 home-main">
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]"
            aria-hidden="true"
          />

          <Button
            variant="ghost"
            className="absolute left-14 top-10 z-20 rh-back-button"
            onClick={onBack}
            type="button"
          >
            ← Back to Home
          </Button>

          <div className="relative z-10 text-center">
            <h1
              className="text-[64px] font-black leading-[0.9] tracking-[-0.05em] text-[var(--rh-text)]"
              style={{ textShadow: "0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)" }}
            >
              Single Player
            </h1>
            <p className="mt-3 text-[20px] font-normal text-[#727083] opacity-90">
              Sharpen your skills. Master the game at your own pace.
            </p>
          </div>

          <div className="relative z-10 mt-8 grid grid-cols-3 items-stretch gap-5 px-14">
            {MODES.map((mode) => (
              <section
                key={mode.key}
                className={`sp-solo-mode-card ${mode.containerClass} relative box-border flex cursor-pointer flex-col overflow-hidden px-7 py-8 ${mode.sectionRounded}`}
                onClick={() => onNavigate(mode.key)}
              >
                <div className="sp-solo-mode-card__art-slot" aria-hidden>
                  <img
                    src={mode.artSrc}
                    alt=""
                    className="sp-solo-mode-card__art"
                    draggable={false}
                    aria-hidden
                  />
                </div>
                <div className="home-card-scrim" aria-hidden="true" />
                <div className="home-card-content relative flex h-[268px] items-center">
                  <div className="flex flex-1 flex-col justify-center">
                    <h2 className="text-[44px] font-bold tracking-[-0.055em]" style={{ color: mode.titleColor }}>
                      {mode.title}
                    </h2>
                    <p className="mt-3 text-[17px] leading-relaxed text-[#AAA6B4]">{mode.desc}</p>
                    <div className="sp-solo-stats mt-6 flex flex-wrap items-center gap-x-10 gap-y-3">
                      {mode.stats.map((stat) => (
                        <div key={stat.label} className="flex min-w-0 items-start gap-2">
                          <span className="sp-solo-stat-icon mt-0.5" style={{ color: mode.titleColor }}>
                            <StatIcon icon={stat.icon} />
                          </span>
                          <span className="flex flex-col gap-0.5">
                            <span className="sp-solo-stat-label">{stat.label.toUpperCase()}</span>
                            <span className="sp-solo-stat-value">{stat.value}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant={mode.variant}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onNavigate(mode.key);
                      }}
                      className="mt-7"
                      style={{ width: 188, height: 50, justifyContent: "space-between" }}
                      type="button"
                    >
                      <span>Play Today</span>
                      <span
                        style={{ fontSize: 22, lineHeight: 1, color: mode.chevronColor, opacity: 0.9 }}
                        aria-hidden="true"
                      >
                        ›
                      </span>
                    </Button>
                  </div>
                </div>
              </section>
            ))}
          </div>

          <div className="relative z-10 mt-12 shrink-0 px-14">
            <div className="text-left">
              <p className="text-[18px] font-semibold text-white">More Modes</p>
              <p className="mt-1 text-[13px] text-[#9D98A9]">New challenges coming soon.</p>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="sp-solo-locked-tile flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-[14px] px-3 py-3"
                >
                  <div className="sp-solo-locked-tile__icon flex h-8 w-8 items-center justify-center rounded-full">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <span className="text-[13px] font-semibold text-[#B6B1BF]">Coming Soon</span>
                  <span className="text-center text-[11px] leading-tight text-[#727083]">New mode in development</span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
