import { useEffect, useRef } from 'react';
import {
  playYourTurnSound,
  queueSound,
} from '../utils/sound';
import { traceDailyFritzEvent } from '../dailyFritz/botMatchDailyFritz';
import type { Tile } from '../types';

export interface UseBotMatchSoundsProps {
  match: {
    currentPlayer: 'you' | 'bot';
    handOver: boolean;
    gameOver: boolean;
  };
  ghostPlayedTile: Tile | null;
  isMuted: boolean;
  isDailyFritzMode: boolean;
  selectedTile: Tile | null;
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
}

export function useBotMatchSounds({
  match,
  ghostPlayedTile,
  isMuted,
  isDailyFritzMode,
  selectedTile,
  handActive,
  botTurn,
  drawSequenceActive,
}: UseBotMatchSoundsProps): void {
  const prevTurnRef = useRef<'you' | 'bot'>(match.currentPlayer);

  // ── Play "your turn" sound when player's turn begins ──────────────────────
  useEffect(() => {
    const prev = prevTurnRef.current;
    const next = match.currentPlayer;
    if (prev === 'bot' && next === 'you' && !match.handOver && !match.gameOver) {
      queueSound(() => playYourTurnSound(isMuted), 400);
    }
    prevTurnRef.current = next;
  }, [match.currentPlayer, match.handOver, match.gameOver, isMuted]);

  // ── Clear ghost tile overlay after 900ms ────────────────────────────────
  useEffect(() => {
    if (!ghostPlayedTile) return;
    const timer = window.setTimeout(() => {
      // Overlay clears automatically; timer just ensures state side-effect fires
    }, 900);
    return () => window.clearTimeout(timer);
  }, [ghostPlayedTile]);

  // ── Trace Daily Fritz tile selection (dev logging) ─────────────────────
  useEffect(() => {
    if (!isDailyFritzMode) return;
    traceDailyFritzEvent('[input] tile click', {
      tile: selectedTile ? `${selectedTile.low}|${selectedTile.high}` : null,
      playable: true,
      handActive,
      botTurn,
      drawSequenceActive,
    });
  }, [isDailyFritzMode, selectedTile, handActive, botTurn, drawSequenceActive]);
}
