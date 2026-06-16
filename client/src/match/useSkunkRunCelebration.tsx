import { useCallback, useEffect, useRef, useState } from 'react';
import { SkunkRunCelebration } from '../bot/SkunkRunCelebration';
import {
  resolveSkunkCelebrationSide,
  type SkunkCelebrationSide,
} from '../bot/skunkCelebration';

type UseSkunkRunCelebrationParams = {
  active: boolean;
  youScore: number;
  opponentScore: number;
  localWon: boolean | null;
  runKey: string;
  enabled?: boolean;
};

export function useSkunkRunCelebration({
  active,
  youScore,
  opponentScore,
  localWon,
  runKey,
  enabled = true,
}: UseSkunkRunCelebrationParams) {
  const keyRef = useRef('');
  const [skunkRunSide, setSkunkRunSide] = useState<SkunkCelebrationSide | null>(null);
  const [skunkRunComplete, setSkunkRunComplete] = useState(true);

  const handleSkunkRunComplete = useCallback(() => {
    setSkunkRunComplete(true);
  }, []);

  useEffect(() => {
    if (!active || !enabled) {
      keyRef.current = '';
      setSkunkRunSide(null);
      setSkunkRunComplete(true);
      return;
    }
    if (keyRef.current === runKey) return;
    keyRef.current = runKey;

    const side = resolveSkunkCelebrationSide({
      active: true,
      youScore,
      opponentScore,
      localWon,
    });
    if (side) {
      setSkunkRunSide(side);
      setSkunkRunComplete(false);
      return;
    }
    setSkunkRunSide(null);
    setSkunkRunComplete(true);
  }, [active, enabled, localWon, opponentScore, runKey, youScore]);

  const skunkRunOverlay =
    skunkRunSide && !skunkRunComplete ? (
      <SkunkRunCelebration side={skunkRunSide} onComplete={handleSkunkRunComplete} />
    ) : null;

  const readyForPostGameOverlay = !active || skunkRunComplete;

  return { skunkRunOverlay, readyForPostGameOverlay };
}
