import { useCallback, type RefObject } from 'react';
import type { Tile } from '../../../types.ts';
import { traceDailyFritzEvent } from '../../../modules/daily/dailyFritzMatchDiagnostics.ts';
import { toTileKey } from '../../../ghost/logic.ts';
import { BotHandTray } from '../../BotHandTray.tsx';

export type BotMatchHandTraySectionProps = {
  preGameDrawActive: boolean;
  hasPreGameDrawState: boolean;
  normalHandRows: Tile[][];
  handTileSize: number;
  handCompactStacked: boolean;
  selectedTile: Tile | null;
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
  drawPulseIndex: number | null;
  playableTileKeys: Set<string>;
  isGuidedMode: boolean;
  guidedScoringTiles: Map<string, number>;
  showCoachedRecommendation: boolean;
  lessonRecommendedTileKey: string | null;
  handAreaRef: RefObject<HTMLDivElement | null>;
  playerHand: Tile[];
  isDailyFritzMode: boolean;
  setSelectedTile: (tile: Tile | null) => void;
  setSelectedController: (controller: 'you' | 'bot' | null) => void;
};

export function BotMatchHandTraySection({
  preGameDrawActive,
  hasPreGameDrawState,
  normalHandRows,
  handTileSize,
  handCompactStacked,
  selectedTile,
  handActive,
  botTurn,
  drawSequenceActive,
  drawPulseIndex,
  playableTileKeys,
  isGuidedMode,
  guidedScoringTiles,
  showCoachedRecommendation,
  lessonRecommendedTileKey,
  handAreaRef,
  playerHand,
  isDailyFritzMode,
  setSelectedTile,
  setSelectedController,
}: BotMatchHandTraySectionProps) {
  const handleTileClick = useCallback(
    (tile: Tile, playable: boolean) => {
      if (isDailyFritzMode) {
        traceDailyFritzEvent('[input] tile click', {
          tile: toTileKey(tile),
          playable,
          handActive,
          botTurn,
          drawSequenceActive,
        });
      }
      if (!handActive || botTurn) return;
      if (!playable) return;
      setSelectedTile(tile);
      setSelectedController('you');
    },
    [
      botTurn,
      drawSequenceActive,
      handActive,
      isDailyFritzMode,
      setSelectedController,
      setSelectedTile,
    ],
  );

  if (preGameDrawActive && hasPreGameDrawState) {
    return (
      <div className="hand-area wl-hand-area pre-game-draw-hand-dock" data-ui="tray" aria-hidden="true" />
    );
  }

  return (
    <BotHandTray
      normalHandRows={normalHandRows}
      handTileSize={handTileSize}
      handCompactStacked={handCompactStacked}
      selectedTile={selectedTile}
      handActive={handActive}
      botTurn={botTurn}
      drawSequenceActive={drawSequenceActive}
      drawPulseIndex={drawPulseIndex}
      playableTileKeys={playableTileKeys}
      isGuidedMode={isGuidedMode}
      guidedScoringTiles={guidedScoringTiles}
      showCoachedRecommendation={showCoachedRecommendation}
      lessonRecommendedTileKey={lessonRecommendedTileKey}
      handAreaRef={handAreaRef}
      playerHand={playerHand}
      onTileClick={handleTileClick}
    />
  );
}