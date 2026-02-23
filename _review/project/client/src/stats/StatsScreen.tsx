import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { UserProfile } from "../auth/useAuth";
import { fetchUserStats, type StatsSummary } from "./statsApi";

interface StatsScreenProps {
  open: boolean;
  user: User | null;
  profile: UserProfile | null;
  onClose: () => void;
}

const EMPTY_STATS: StatsSummary = {
  gamesPlayed: 0,
  wins: 0,
  losses: 0,
  botWins: 0,
  botLosses: 0,
};

export default function StatsScreen({ open, user, profile, onClose }: StatsScreenProps) {
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !user) return;

    let active = true;
    setLoading(true);
    setError(null);

    fetchUserStats(user).then((result) => {
      if (!active) return;
      setLoading(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStats(result.data ?? EMPTY_STATS);
    });

    return () => {
      active = false;
    };
  }, [open, user]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Profile stats"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1900,
        display: "grid",
        placeItems: "center",
        background: "rgba(6, 10, 18, 0.62)",
        backdropFilter: "blur(4px)",
        pointerEvents: open ? "auto" : "none",
        opacity: open ? 1 : 0,
        visibility: open ? "visible" : "hidden",
        transform: open ? "scale(1)" : "scale(0.97)",
        transition: "opacity 180ms ease, transform 180ms ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          zIndex: 1901,
          pointerEvents: "auto",
          width: "min(520px, calc(100vw - 24px))",
          borderRadius: "16px",
          border: "1px solid rgba(236,252,245,0.2)",
          background: "linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))",
          boxShadow: "0 24px 64px rgba(0,0,0,0.42)",
          padding: "18px",
          color: "rgba(235,245,242,0.96)",
          display: "grid",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ margin: 0 }}>Profile / Stats</h3>
          <button className="mode-inline-btn" onClick={onClose}>Close</button>
        </div>

        <p style={{ margin: 0, color: "rgba(223,236,244,0.86)" }}>
          {profile?.username ? `@${profile.username}` : "Guest"}
        </p>

        {loading && <p style={{ margin: 0, color: "rgba(223,236,244,0.86)" }}>Loading stats...</p>}
        {error && <p className="auth-inline-error">{error}</p>}

        {!loading && !error && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "10px",
              minHeight: "180px",
            }}
          >
            {[
              ["Games", stats.gamesPlayed],
              ["Wins", stats.wins],
              ["Losses", stats.losses],
              ["Bot Wins", stats.botWins],
              ["Bot Losses", stats.botLosses],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                style={{
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "rgba(12,20,34,0.68)",
                  padding: "10px",
                  display: "grid",
                  gap: "4px",
                }}
              >
                <span style={{ fontSize: "0.86rem", color: "rgba(191,213,223,0.86)" }}>{label}</span>
                <strong style={{ fontSize: "1.2rem" }}>{value}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
