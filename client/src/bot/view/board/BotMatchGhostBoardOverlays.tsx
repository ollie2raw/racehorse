import { DominoTile } from '../../../components';
import type { Tile } from '../../../types.ts';

type BotMatchGhostBoardOverlaysProps = {
  isGhostMode: boolean;
  ghostAgreementType: 'agrees' | 'heuristic' | null;
  ghostPlayedTile: Tile | null;
};

export function BotMatchGhostBoardOverlays({
  isGhostMode,
  ghostAgreementType,
  ghostPlayedTile,
}: BotMatchGhostBoardOverlaysProps) {
  if (!isGhostMode) return null;
  return (
    <>
      {ghostAgreementType && (
        <div className={`ghost-agreement-indicator ${ghostAgreementType}`}>
          {ghostAgreementType === 'agrees' ? '✓ Ghost agrees' : '✓ Ghost thinks so'}
        </div>
      )}
      {ghostPlayedTile && (
        <div className="ghost-played-overlay" aria-hidden="true">
          <DominoTile tile={ghostPlayedTile} size={52} className="ghost-played-tile" />
        </div>
      )}
    </>
  );
}