import type { Tile } from '../../types';

export type HandOverWinnerSide = 'you' | 'opponent' | 'bot' | 'tie' | 'none';

export type HandOverTileReveal = {
  ownerLabel: string;
  tiles: Tile[];
  pipTotal: number;
  /** Tiles counted toward the awarded points (opponent hand when you win, etc.) */
  isScoredHand: boolean;
};

export function sumHandPips(tiles: Tile[]): number {
  return tiles.reduce((sum, tile) => sum + tile.low + tile.high, 0);
}

export function handOverTileSize(tileCount: number): number {
  if (tileCount <= 3) return 46;
  if (tileCount <= 6) return 40;
  if (tileCount <= 10) return 34;
  return 28;
}

function handOverPointsLabel(points: number): string {
  return `${points} point${points === 1 ? '' : 's'}`;
}

/** Concise hero result line (includes points once; reward plate repeats the award). */
export function buildHandOverReasonCopy(opts: {
  youWentOut: boolean;
  opponentWentOut: boolean;
  isBlocked: boolean;
  opponentName: string;
  pointsAwarded: number;
}): string {
  const { youWentOut, opponentWentOut, isBlocked, opponentName, pointsAwarded } = opts;
  const pointsLabel = handOverPointsLabel(pointsAwarded);

  if (youWentOut) {
    return `You emptied your hand and collected ${pointsLabel}.`;
  }
  if (opponentWentOut) {
    const wentOut =
      opponentName === 'Fritz'
        ? `${opponentName} emptied his hand`
        : `${opponentName} went out`;
    return `${wentOut}. ${opponentName} collected ${pointsLabel}.`;
  }
  if (isBlocked) {
    return `Hand blocked — lowest combined pips earn ${pointsLabel}.`;
  }
  return `Hand complete — ${pointsLabel} awarded.`;
}

export function buildRemainingTilesMetric(reveal: HandOverTileReveal): string {
  const pipLabel = `${reveal.pipTotal} pip${reveal.pipTotal === 1 ? '' : 's'}`;
  const tileLabel = `${reveal.tiles.length} tile${reveal.tiles.length === 1 ? '' : 's'}`;
  return `${pipLabel} · ${tileLabel}`;
}

/** Short game-like line under the tile showcase (no point totals). */
export function buildRemainingTilesEvidenceNote(reveal: HandOverTileReveal): string {
  if (reveal.ownerLabel === 'You') return 'You left these tiles.';
  return `${reveal.ownerLabel} left these tiles.`;
}

export function buildBotHandOverReveals(
  handReveal: {
    winner: 'you' | 'bot' | null;
    reason: 'domino' | 'blocked';
    yourRemainingTiles: Tile[];
    botRemainingTiles: Tile[];
  },
  opponentLabel: string,
): HandOverTileReveal[] {
  const isBlocked = handReveal.reason === 'blocked';
  const yourTiles = handReveal.yourRemainingTiles;
  const oppTiles = handReveal.botRemainingTiles;

  if (isBlocked) {
    return [
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: true,
      },
      {
        ownerLabel: opponentLabel,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: true,
      },
    ];
  }

  if (handReveal.winner === 'you') {
    return [
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: false,
      },
      {
        ownerLabel: opponentLabel,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: true,
      },
    ];
  }

  if (handReveal.winner === 'bot') {
    return [
      {
        ownerLabel: opponentLabel,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: false,
      },
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: true,
      },
    ];
  }

  return [
    {
      ownerLabel: 'You',
      tiles: yourTiles,
      pipTotal: sumHandPips(yourTiles),
      isScoredHand: true,
    },
    {
      ownerLabel: opponentLabel,
      tiles: oppTiles,
      pipTotal: sumHandPips(oppTiles),
      isScoredHand: true,
    },
  ];
}

export function buildMultiplayerHandOverReveals(
  handReveal: {
    yourRemainingTiles: Tile[];
    opponentRemainingTiles: Tile[];
  },
  winner: 'you' | 'opponent' | 'none',
  youWentOut: boolean,
  opponentWentOut: boolean,
  opponentName: string,
): HandOverTileReveal[] {
  const yourTiles = handReveal.yourRemainingTiles;
  const oppTiles = handReveal.opponentRemainingTiles;
  const isBlocked = !youWentOut && !opponentWentOut;

  if (isBlocked) {
    return [
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: true,
      },
      {
        ownerLabel: opponentName,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: true,
      },
    ];
  }

  if (winner === 'you') {
    return [
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: false,
      },
      {
        ownerLabel: opponentName,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: true,
      },
    ];
  }

  if (winner === 'opponent') {
    return [
      {
        ownerLabel: opponentName,
        tiles: oppTiles,
        pipTotal: sumHandPips(oppTiles),
        isScoredHand: false,
      },
      {
        ownerLabel: 'You',
        tiles: yourTiles,
        pipTotal: sumHandPips(yourTiles),
        isScoredHand: true,
      },
    ];
  }

  return [
    {
      ownerLabel: 'You',
      tiles: yourTiles,
      pipTotal: sumHandPips(yourTiles),
      isScoredHand: true,
    },
    {
      ownerLabel: opponentName,
      tiles: oppTiles,
      pipTotal: sumHandPips(oppTiles),
      isScoredHand: true,
    },
  ];
}

export function resolveWinnerSide(
  winner: 'you' | 'opponent' | 'bot' | 'none' | null,
): HandOverWinnerSide {
  if (winner === 'you') return 'you';
  if (winner === 'opponent' || winner === 'bot') return winner === 'bot' ? 'bot' : 'opponent';
  if (winner === 'none' || winner === null) return 'tie';
  return 'none';
}

export function winnerDisplayLabel(
  winnerSide: HandOverWinnerSide,
  opponentName: string,
): string {
  if (winnerSide === 'you') return 'You';
  if (winnerSide === 'opponent' || winnerSide === 'bot') return opponentName;
  return 'Tie';
}

export function loserDisplayLabel(
  winnerSide: HandOverWinnerSide,
  opponentName: string,
): string {
  if (winnerSide === 'you') return opponentName;
  if (winnerSide === 'opponent' || winnerSide === 'bot') return 'You';
  return '—';
}
