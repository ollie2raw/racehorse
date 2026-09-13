import { GlobalNav } from "../components";
import { Button, GlassCard } from "../components/primitives";
import type { AppMode } from "../types";
import "./RacehorseHomeArt.css";

interface JourneyComingSoonScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

/** Journey is gated to admin-only while it's reworked — see project memory
    "journey-mode-gated-admin-only". Everyone else lands here instead of the
    real trail. */
export default function JourneyComingSoonScreen({
  onBack,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: JourneyComingSoonScreenProps) {
  return (
    <div className="relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] home-page-root">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
        <div className="home-bg__texture" />
      </div>

      <div className="home-shell relative mx-auto flex min-h-0 w-full flex-1 flex-col">
        <GlobalNav currentMode="journey" activeColor="#C77DFF" onNavigate={onNavigate} onOpenAuth={onOpenAuth} onSignOut={onSignOut} />

        <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <GlassCard className="max-w-[480px] px-10 py-12">
            <p className="text-[11px] font-black uppercase tracking-[0.25em]" style={{ color: "#C77DFF" }}>
              Journey
            </p>
            <h1 className="mt-3 text-[32px] font-bold tracking-[-0.03em] text-[rgba(255,255,255,0.95)]">
              Coming Soon
            </h1>
            <p className="mt-4 text-[16px] leading-relaxed text-[rgba(255,255,255,0.6)]">
              Journey is being reworked into something worth the name. It will be back
              when it is ready.
            </p>
            <Button variant="secondary" className="mt-8" onClick={onBack} type="button">
              ← Back to Single Player
            </Button>
          </GlassCard>
        </main>
      </div>
    </div>
  );
}
