import type { CSSProperties, KeyboardEvent, Ref } from 'react';
import './match-score-header.css';

export interface MatchScoreHeaderPlayer {
  label: string;
  sublabel?: string;
  score: number;
  tileCount: number;
  isActive?: boolean;
  scoreHit?: boolean;
}

export interface MatchScoreHeaderProps {
  target: number;
  you: MatchScoreHeaderPlayer;
  opponent: MatchScoreHeaderPlayer;
  onOpenDetail?: () => void;
  opponentAnchorRef?: Ref<HTMLDivElement>;
  boneyardAnchorRef?: Ref<HTMLDivElement>;
}

const HOLES_PER_GROUP = 5;

function holesPerRow(target: number): number {
  return Math.max(1, Math.floor(target / 2));
}

function groupCountForTarget(target: number): number {
  return Math.ceil(holesPerRow(target) / HOLES_PER_GROUP);
}

function getSnakePegPosition(score: number, target: number): { row: number; hole: number } {
  const perRow = holesPerRow(target);
  const idx = Math.max(0, Math.min(score, Math.max(0, target - 1)));

  if (idx < perRow) {
    return { row: 0, hole: idx };
  }
  return { row: 1, hole: perRow - 1 - (idx - perRow) };
}

interface PlayerLabelProps {
  player: MatchScoreHeaderPlayer;
  variant: 'opp' | 'you';
  labelRef?: Ref<HTMLDivElement>;
}

function PlayerLabel({ player, variant, labelRef }: PlayerLabelProps) {
  return (
    <div
      ref={labelRef}
      className={`wl-score-header__player-line wl-score-header__player-line--${variant}${player.scoreHit ? ' score-hit' : ''}`}
      title={player.sublabel ? `${player.label} · ${player.sublabel}` : player.label}
    >
      <span className="wl-score-header__player-name">{player.label.trim().toUpperCase()}</span>
      {player.sublabel ? <span className="wl-score-header__player-sublabel">{player.sublabel}</span> : null}
      <span className="wl-score-header__player-tiles">{player.tileCount}</span>
    </div>
  );
}

interface HoleGroupProps {
  groupIndex: number;
  row: number;
  perRow: number;
  pegPos: { row: number; hole: number };
  variant: 'opp' | 'you';
  isTurn: boolean;
}

function HoleGroup({ groupIndex, row, perRow, pegPos, variant, isTurn }: HoleGroupProps) {
  const start = groupIndex * HOLES_PER_GROUP;

  return (
    <div className="wl-hole-group" data-group={groupIndex + 1}>
      {Array.from({ length: HOLES_PER_GROUP }, (_, offset) => {
        const holeIndex = start + offset;
        if (holeIndex >= perRow) return null;

        const isActive = pegPos.row === row && pegPos.hole === holeIndex;
        const isMark = (holeIndex + 1) % HOLES_PER_GROUP === 0;

        return (
          <div
            key={holeIndex}
            className={`wl-cribbage-hole${isMark ? ' is-mark' : ''}${isActive ? ' is-active' : ''}`}
          >
            {isActive ? (
              <span className={`wl-cribbage-peg wl-cribbage-peg--${variant}${isTurn ? ' is-turn' : ''}`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface TrackRowProps {
  player: MatchScoreHeaderPlayer;
  row: number;
  target: number;
  variant: 'opp' | 'you';
  groups: number;
}

function TrackRow({ player, row, target, variant, groups }: TrackRowProps) {
  const perRow = holesPerRow(target);
  const pegPos = getSnakePegPosition(player.score, target);
  const isTurn = Boolean(player.isActive);

  return (
    <div className={`wl-score-track-row wl-score-track-row--${variant}`}>
      {Array.from({ length: groups }, (_, groupIndex) => (
        <HoleGroup
          key={groupIndex}
          groupIndex={groupIndex}
          row={row}
          perRow={perRow}
          pegPos={pegPos}
          variant={variant}
          isTurn={isTurn}
        />
      ))}
    </div>
  );
}

export function MatchScoreHeader({
  target,
  you,
  opponent,
  onOpenDetail,
  opponentAnchorRef,
  boneyardAnchorRef,
}: MatchScoreHeaderProps) {
  const groups = groupCountForTarget(target);

  const rootProps = onOpenDetail
    ? {
        role: 'button' as const,
        tabIndex: 0,
        onClick: onOpenDetail,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenDetail();
          }
        },
        'aria-label': 'Open score track detail',
      }
    : {};

  return (
    <header className={`wl-score-header${onOpenDetail ? ' is-interactive' : ''}`} data-ui="score-header" {...rootProps}>
      <div className="wl-score-header__inner">
        <div className="wl-score-header__labels">
          <div className="wl-score-header__label-block">
            <PlayerLabel player={opponent} variant="opp" labelRef={opponentAnchorRef} />
          </div>
          <div className="wl-score-header__label-block">
            <PlayerLabel player={you} variant="you" />
          </div>
        </div>

        <div
          className="wl-score-tracks"
          aria-hidden="true"
          style={{ gridTemplateColumns: `repeat(${groups}, minmax(0, 1fr))` } as CSSProperties}
        >
          <TrackRow player={opponent} row={0} target={target} variant="opp" groups={groups} />
          <TrackRow player={opponent} row={1} target={target} variant="opp" groups={groups} />
          <TrackRow player={you} row={0} target={target} variant="you" groups={groups} />
          <TrackRow player={you} row={1} target={target} variant="you" groups={groups} />
        </div>

        {boneyardAnchorRef ? (
          <span ref={boneyardAnchorRef} className="wl-score-header__boneyard-anchor" aria-hidden="true" />
        ) : null}
      </div>
    </header>
  );
}
