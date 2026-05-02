import { type ReactNode } from 'react';

interface TrackPlayer {
  label: string;
  score: number;
  tone: 'you' | 'opp';
}

interface ScoreBoardProps {
  players: [TrackPlayer, TrackPlayer];
  target?: number;
  compact?: boolean;
}

function clampScore(value: number, target: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > target) return target;
  return Math.floor(value);
}

export function ScoreBoard({ players, target = 60, compact = false }: ScoreBoardProps) {
  const laneLength = Math.floor(target / 2);
  // 30..1
  const topMainLane = Array.from({ length: laneLength }, (_, i) => laneLength - i);
  // 31..60
  const bottomMainLane = Array.from({ length: laneLength }, (_, i) => laneLength + 1 + i);

  const renderLane = (
    values: number[],
    pegValue: number | null,
    player: TrackPlayer,
    lane: 'outer' | 'inner',
  ) => {
    const nodes: ReactNode[] = [];
    values.forEach((n, idx) => {
      nodes.push(
        <div
          key={`${player.label}-${lane}-hole-${n}`}
          className={`score-hole ${pegValue === n ? `is-peg ${player.tone}` : ''} ${n % 5 === 0 ? 'is-mark' : ''} ${n % 15 === 0 ? 'is-major' : ''}`}
          title={`${player.label}: ${n}`}
        />,
      );
      if (idx < values.length - 1 && (idx + 1) % 5 === 0) {
        nodes.push(
          <div key={`${player.label}-${lane}-gap-${n}`} className="score-gap" aria-hidden="true" />,
        );
      }
    });
    return nodes;
  };

  return (
    <div className={`score-track-board ${compact ? 'is-compact' : ''}`}>
      {players.map((player, playerIndex) => {
        const pegAt = clampScore(player.score, target);
        const isMirrored = playerIndex === 1;
        const topSoloPeg = pegAt === 0;
        const bottomSoloPeg = pegAt >= target;
        const topMainPeg = pegAt >= 1 && pegAt <= laneLength ? pegAt : null;
        const bottomMainPeg = pegAt > laneLength && pegAt < target ? pegAt : null;
        return (
          <div
            className={`score-track-lane ${isMirrored ? 'score-track-lane--mirrored' : ''}`}
            key={player.label}
          >
            {!compact && (
              <div className="score-track-meta">
                <span className="score-track-name">{player.label}</span>
                <span className="score-track-value">{player.score}</span>
              </div>
            )}
            <div className="score-track-lane-grid">
              <div className="score-track-holes score-track-holes--outer">
                {renderLane(topMainLane, topMainPeg, player, 'outer')}
                <div className="score-gap score-gap-solo" aria-hidden="true" />
                <div
                  className={`score-hole score-hole-solo ${topSoloPeg ? `is-peg ${player.tone}` : ''}`}
                  title={`${player.label}: start`}
                />
              </div>
              <div className="score-track-holes score-track-holes--inner">
                {renderLane(bottomMainLane, bottomMainPeg, player, 'inner')}
                <div className="score-gap score-gap-solo" aria-hidden="true" />
                <div
                  className={`score-hole score-hole-solo ${bottomSoloPeg ? `is-peg ${player.tone}` : ''}`}
                  title={`${player.label}: finish`}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
