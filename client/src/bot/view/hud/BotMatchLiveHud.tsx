import type { RefObject } from 'react';
import { AnimatedScore } from '../../../components';
import TileRack from '../../../components/TileRack.tsx';
import type { BotMatchState } from '../../botEngine.ts';
import { formatGhostName } from '../utils/botMatchViewFormatters.tsx';

type BotMatchLiveHudProps = {
  opponentLabel: string;
  ghostSubLabel: string | null;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  match: BotMatchState;
  botTurn: boolean;
  onOpenScoreTrack: () => void;
};

export function BotMatchLiveHudLeft({
  opponentLabel,
  ghostSubLabel,
  opponentPillRef,
  match,
  botTurn,
  onOpenScoreTrack,
}: BotMatchLiveHudProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        className={`wl-player-pill wl-player-pill-btn score-card${botTurn ? ' is-active-turn' : ''}`}
        ref={opponentPillRef}
        onClick={onOpenScoreTrack}
        aria-label="Open score track"
      >
        <div className="wl-player-card-content">
          <div className="wl-player-card-text">
            {ghostSubLabel ? (
              <span className="wl-player-subtitle">{formatGhostName(ghostSubLabel)}</span>
            ) : null}
            <span className="wl-player-label">{opponentLabel}</span>
          </div>
          <AnimatedScore value={match.players.bot.score} className="wl-player-score" />
        </div>
      </button>
      <TileRack count={match.players.bot.hand.length} isActive={botTurn} variant="default" />
    </div>
  );
}

export function BotMatchLiveHudRight({
  match,
  botTurn,
  onOpenScoreTrack,
}: Pick<BotMatchLiveHudProps, 'match' | 'botTurn' | 'onOpenScoreTrack'>) {
  return (
    <button
      type="button"
      className={`wl-player-pill wl-player-pill-btn score-card is-you${!botTurn ? ' is-active-turn' : ''}`}
      onClick={onOpenScoreTrack}
      aria-label="Open score track"
    >
      <div className="wl-player-card-content">
        <div className="wl-player-card-text">
          <span className="wl-player-label">You</span>
        </div>
        <AnimatedScore value={match.players.you.score} className="wl-player-score" />
      </div>
    </button>
  );
}