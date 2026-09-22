import { DominoTile } from '../components';
import type { ReviewDecisionHandContext } from './reviewDecisionHandContext';

type Props = {
  readonly handContext: ReviewDecisionHandContext;
};

/**
 * Compact “Your hand” strip for the selected Game Review decision.
 * Renders actor-visible pre-move tiles only (no opponent private hand).
 */
export function GameReviewerHandContext({ handContext }: Props) {
  if (handContext.tiles.length === 0) return null;

  return (
    <div className="gr-your-hand" data-testid="gr-your-hand" aria-label="Your hand">
      <span className="gr-your-hand-label">Your hand</span>
      <ul className="gr-your-hand-tiles" role="list">
        {handContext.tiles.map((entry, idx) => {
          const [low, high] = entry.tile;
          const roleLabel =
            entry.role === 'played' ? 'Played' : entry.role === 'playable' ? 'Playable' : undefined;
          return (
            <li
              key={`${low}-${high}-${idx}`}
              className={`gr-your-hand-tile is-${entry.role}`}
              data-role={entry.role}
              data-tile={`${low}-${high}`}
            >
              <DominoTile
                tile={{ low, high }}
                size={36}
                disabled
                highlight={entry.role === 'played'}
                unplayable={entry.role === 'held'}
                className="gr-your-hand-domino"
              />
              {roleLabel ? <span className="gr-your-hand-tile-badge">{roleLabel}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
