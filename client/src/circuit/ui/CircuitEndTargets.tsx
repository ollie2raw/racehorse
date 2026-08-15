import type { PlacementPosition, Tile } from '../../types';

export type CircuitEndLegal = {
  readonly position: PlacementPosition;
};

export type CircuitEndTargetsProps = {
  leftEnd: number;
  rightEnd: number;
  selectedTile: Tile | null;
  legalPositions: readonly PlacementPosition[];
  disabled?: boolean;
  onCommit: (position: PlacementPosition) => void;
  onIllegalAttempt: (position: PlacementPosition) => void;
};

export function CircuitEndTargets({
  leftEnd,
  rightEnd,
  selectedTile,
  legalPositions,
  disabled = false,
  onCommit,
  onIllegalAttempt,
}: CircuitEndTargetsProps) {
  if (!selectedTile) {
    return (
      <div className="rh-circuit-ends rh-circuit-ends--idle" aria-hidden="true">
        <p className="rh-circuit-ends__idle-copy">Select a tile to reveal placement targets</p>
      </div>
    );
  }

  const leftLegal = legalPositions.includes('left');
  const rightLegal = legalPositions.includes('right');
  const onlyLeft = leftLegal && !rightLegal;
  const onlyRight = rightLegal && !leftLegal;
  const noneLegal = !leftLegal && !rightLegal;

  const handle = (position: 'left' | 'right', legal: boolean) => {
    if (disabled) return;
    if (legal) onCommit(position);
    else onIllegalAttempt(position);
  };

  return (
    <div
      className={[
        'rh-circuit-ends',
        onlyLeft || onlyRight ? 'rh-circuit-ends--single' : '',
        noneLegal ? 'rh-circuit-ends--none' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={`Placement targets for [${selectedTile.low}|${selectedTile.high}]`}
    >
      {noneLegal ? (
        <p className="rh-circuit-ends__none" role="status">
          [{selectedTile.low}|{selectedTile.high}] cannot play on either open end.
        </p>
      ) : null}

      <button
        type="button"
        className={[
          'rh-circuit-end',
          'rh-circuit-end--left',
          leftLegal ? 'rh-circuit-end--legal' : 'rh-circuit-end--blocked',
          onlyLeft ? 'rh-circuit-end--solo' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        aria-disabled={disabled ? true : undefined}
        aria-label={
          leftLegal
            ? `Play on left, needs ${leftEnd}`
            : `Left end blocked, needs ${leftEnd}`
        }
        onClick={() => handle('left', leftLegal)}
      >
        <span className="rh-circuit-end__side" aria-hidden="true">
          ← Left
        </span>
        <span className="rh-circuit-end__title">
          {leftLegal ? 'Play on left' : 'Left unavailable'}
        </span>
        <span className="rh-circuit-end__need">needs {leftEnd}</span>
        {!leftLegal ? (
          <span className="rh-circuit-end__why">
            Does not match [{selectedTile.low}|{selectedTile.high}]
          </span>
        ) : onlyLeft ? (
          <span className="rh-circuit-end__why">Only legal destination — tap to commit</span>
        ) : null}
      </button>

      <button
        type="button"
        className={[
          'rh-circuit-end',
          'rh-circuit-end--right',
          rightLegal ? 'rh-circuit-end--legal' : 'rh-circuit-end--blocked',
          onlyRight ? 'rh-circuit-end--solo' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        disabled={disabled}
        aria-disabled={disabled ? true : undefined}
        aria-label={
          rightLegal
            ? `Play on right, needs ${rightEnd}`
            : `Right end blocked, needs ${rightEnd}`
        }
        onClick={() => handle('right', rightLegal)}
      >
        <span className="rh-circuit-end__side" aria-hidden="true">
          Right →
        </span>
        <span className="rh-circuit-end__title">
          {rightLegal ? 'Play on right' : 'Right unavailable'}
        </span>
        <span className="rh-circuit-end__need">needs {rightEnd}</span>
        {!rightLegal ? (
          <span className="rh-circuit-end__why">
            Does not match [{selectedTile.low}|{selectedTile.high}]
          </span>
        ) : onlyRight ? (
          <span className="rh-circuit-end__why">Only legal destination — tap to commit</span>
        ) : null}
      </button>
    </div>
  );
}
