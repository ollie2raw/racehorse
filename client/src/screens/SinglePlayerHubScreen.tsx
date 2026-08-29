import React, { useCallback, useMemo } from "react";
import type { CSSProperties } from "react";
import "./RacehorseHomeArt.css";
import "./SinglePlayerModes.css";
import type { AppMode } from "../types";
import { GlobalNav } from "../components";
import { Button } from "../components/primitives";
import { useSinglePlayerHubStats, type HubStatRow } from "./useSinglePlayerHubStats";
import { useDeferredAsset } from "../ui/useDeferredAsset";

interface SinglePlayerHubScreenProps {
  userId?: string | null;
  onBack: () => void;
  onNavigate: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

type CardConfig = {
  key: AppMode;
  containerClass: string;
  sectionRounded: string;
  title: string;
  titleColor: string;
  desc: string;
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
    desc: "Fritz doesn't go easy. Find out if you're good enough.",
    variant: "tier-elite",
    chevronColor: "#FFD76A",
  },
  {
    key: "ghostSetup" as AppMode,
    containerClass: "daily-puzzle-card-container",
    sectionRounded: "rounded-[20px] rounded-tr-[5px]",
    title: "Ghost Mode",
    titleColor: "#4FC3F7",
    desc: "Race against a model of your own game. Can you beat yourself?",
    variant: "tier-standard",
    chevronColor: "#4FC3F7",
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

function statsForMode(
  modeKey: AppMode,
  hubStats: ReturnType<typeof useSinglePlayerHubStats>,
): HubStatRow[] {
  if (modeKey === "botSetup") return hubStats.fritz;
  if (modeKey === "ghostSetup") return hubStats.ghost;
  return [];
}

export default function SinglePlayerHubScreen({
  userId = null,
  onBack,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: SinglePlayerHubScreenProps) {
  const hubStats = useSinglePlayerHubStats(userId);
  const loadFritzArt = useCallback(
    () => import("../assets/singlePlayerHub/fritzwave1.webp"),
    [],
  );
  const loadGhostArt = useCallback(
    () => import("../assets/singlePlayerHub/fritzghost2.webp"),
    [],
  );
  const artFritzSrc = useDeferredAsset("single-player-fritz-art", loadFritzArt);
  const artGhostSrc = useDeferredAsset("single-player-ghost-art", loadGhostArt);
  const modeArtByKey = useMemo(
    () => ({
      botSetup: artFritzSrc,
      ghostSetup: artGhostSrc,
    }),
    [artFritzSrc, artGhostSrc],
  );

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
        <GlobalNav
          currentMode="singlePlayerHub"
          activeColor="#E7B64A"
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onSignOut={onSignOut}
        />

        <main className="sp-solo-main relative flex min-h-0 flex-1 flex-col overflow-y-auto px-0 pb-[calc(16px+var(--rh-bottom-tab-offset))] pt-4 home-main desk:overflow-hidden desk:pb-5 desk:pt-10">
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
            <p className="mt-5 text-[20px] font-normal text-[#727083] opacity-90">
              Sharpen your skills. Master the game at your own pace.
            </p>
          </div>

          <div className="relative z-10 mt-[42px] flex flex-col gap-5 px-14">
            <div className="sp-solo-grid sp-solo-grid--pair items-stretch gap-5">
            {MODES.map((mode) => (
              <section
                key={mode.key}
                className={`sp-solo-mode-card ${mode.containerClass} relative box-border flex cursor-pointer flex-col overflow-hidden px-7 py-8 ${mode.sectionRounded}`}
                onClick={() => onNavigate(mode.key)}
              >
                <div className="sp-solo-mode-card__art-slot" aria-hidden>
                  {modeArtByKey[mode.key as keyof typeof modeArtByKey] ? (
                    <img
                      src={modeArtByKey[mode.key as keyof typeof modeArtByKey] ?? undefined}
                      alt=""
                      className="sp-solo-mode-card__art"
                      draggable={false}
                      decoding="async"
                      loading="lazy"
                      aria-hidden
                    />
                  ) : null}
                </div>
                <div className="home-card-scrim" aria-hidden="true" />
                <div className="home-card-content relative grid h-[268px] grid-rows-[1fr_auto] gap-7">
                  <div className="flex min-h-0 flex-col justify-center">
                    <div className="sp-solo-mode-card__text">
                      <h2 className="text-[44px] font-bold tracking-[-0.055em]" style={{ color: mode.titleColor }}>
                        {mode.title}
                      </h2>
                      <p className="mt-3 text-[16px] leading-relaxed text-[#AAA6B4]">{mode.desc}</p>
                    </div>
                    <div className="sp-solo-stats mt-6 flex flex-wrap items-center gap-x-10 gap-y-3">
                      {statsForMode(mode.key, hubStats).map((stat) => (
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
                  </div>
                  <Button
                    variant={mode.variant}
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onNavigate(mode.key);
                    }}
                    className="self-start"
                    style={{ width: 188, height: 50, justifyContent: "space-between" }}
                    type="button"
                  >
                    <span>Play</span>
                    <span
                      style={{ fontSize: 22, lineHeight: 1, color: mode.chevronColor, opacity: 0.9 }}
                      aria-hidden="true"
                    >
                      ›
                    </span>
                  </Button>
                </div>
              </section>
            ))}
            </div>
          </div>

          <div className="relative z-10 mt-[112px] mb-[70px] flex items-center justify-center gap-2.5 opacity-40">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="mb-0.5">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-[11px] font-black tracking-[0.25em] text-[#727083] uppercase">
              More modes coming soon
            </span>
          </div>
        </main>
      </div>
    </div>
  );
}
