import { DEFAULT_CONFIG, type Config } from '../game/types';

const ALLOWED_WINNING_SCORES = new Set([30, 60]);

function resolveAllowedWinningScores(): Set<number> {
  // Cert/soak mode unlocks a short match target so rematch/lifecycle proof can finish quickly.
  if (process.env.MP_PRIVATE_CERT_MODE === '1') {
    return new Set([5, 30, 60]);
  }
  return ALLOWED_WINNING_SCORES;
}

function resolveTilesPerPlayer(raw: Record<string, unknown>): 7 | 14 {
  if (raw.tilesPerPlayer === 14 || raw.dealSize === 14 || raw.dealFormat === 14) {
    return 14;
  }
  return 7;
}

/**
 * Normalizes host-chosen private-room settings from room:create.
 * Only whitelisted Config fields are returned; identity/junk keys are dropped.
 */
export function sanitizePrivateRoomConfig(raw: Record<string, unknown>): Partial<Config> {
  const tilesPerPlayer = resolveTilesPerPlayer(raw);

  const allowed = resolveAllowedWinningScores();
  const winningScoreRaw = Number(raw.winningScore ?? raw.winTarget);
  const winningScore = allowed.has(winningScoreRaw)
    ? winningScoreRaw
    : DEFAULT_CONFIG.winningScore;

  const skipPregameDraw = raw.skipPregameDraw === true;

  return {
    tilesPerPlayer,
    deadTileCount: tilesPerPlayer === 14 ? 0 : DEFAULT_CONFIG.deadTileCount,
    winningScore,
    skipPregameDraw,
  };
}
