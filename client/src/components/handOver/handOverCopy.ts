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

export function buildHandOverReasonCopy(opts: {
  youWentOut: boolean;
  opponentWentOut: boolean;
  isBlocked: boolean;
  opponentName: string;
  pointsAwarded: number;
}): string {
  const { youWentOut, opponentWentOut, isBlocked, opponentName, pointsAwarded } = opts;
  const pointsLabel = `${pointsAwarded} point${pointsAwarded === 1 ? '' : 's'}`;

  if (youWentOut) {
    return `You emptied your hand. Tiles left with ${opponentName} count toward your ${pointsLabel}.`;
  }
  if (opponentWentOut) {
    return `${opponentName} went out. Your leftover tiles were rounded into ${pointsLabel} for them.`;
  }
  if (isBlocked) {
    return `The hand blocked with no play left. Lowest combined pips earn ${pointsLabel}.`;
  }
  return `Hand complete — ${pointsLabel} awarded.`;
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
