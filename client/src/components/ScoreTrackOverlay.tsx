import { useEffect, type ReactNode } from "react";

interface TrackPlayer {
  label: string;
  score: number;
  tone: "you" | "opp";
}

interface ScoreTrackOverlayProps {
  open: boolean;
  onClose: () => void;
  players: [TrackPlayer, TrackPlayer];
  target?: number;
}

function clampScore(value: number, target: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > target) return target;
  return Math.floor(value);
}

export function ScoreTrackOverlay({ open, onClose, players, target = 60 }: ScoreTrackOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const laneLength = Math.floor(target / 2);
  const outerLane = Array.from({ length: laneLength + 1 }, (_, i) => i);
  const innerLane = Array.from({ length: laneLength }, (_, i) => target - 1 - i);
  const renderLane = (
    values: number[],
    pegValue: number | null,
    player: TrackPlayer,
    lane: "outer" | "inner"
  ) => {
    const nodes: ReactNode[] = [];
    values.forEach((n, idx) => {
      nodes.push(
        <div
          key={`${player.label}-${lane}-hole-${n}`}
          className={`score-hole ${pegValue === n ? `is-peg ${player.tone}` : ""} ${n % 5 === 0 ? "is-mark" : ""}`}
          title={`${player.label}: ${n}`}
        />
      );
      if ((idx + 1) % 5 === 0 && idx < values.length - 1) {
        nodes.push(
          <div
            key={`${player.label}-${lane}-gap-${n}`}
            className="score-gap"
            aria-hidden="true"
          />
        );
      }
    });
    return nodes;
  };

  return (
    <div className="score-track-overlay" role="dialog" aria-modal="true" aria-label="Score track">
      <button className="score-track-backdrop" onClick={onClose} aria-label="Close score track" />
      <div className="score-track-card">
        <div className="score-track-header">
          <h3>Score Track</h3>
          <button className="score-track-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <div className="score-track-board">
          {players.map((player) => {
            const pegAt = clampScore(player.score, target);
            const outerPeg = pegAt <= laneLength ? pegAt : null;
            const innerPeg = pegAt > laneLength ? pegAt : null;
            return (
              <div className="score-track-lane" key={player.label}>
                <div className="score-track-meta">
                  <span className="score-track-name">{player.label}</span>
                  <span className="score-track-value">{player.score}</span>
                </div>
                <div className="score-track-lane-grid">
                  <div className="score-track-holes">
                    {renderLane(outerLane, outerPeg, player, "outer")}
                  </div>
                  <div className="score-track-holes">
                    {renderLane(innerLane, innerPeg, player, "inner")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
