
export const TAU = 0.5;
export const EPSILON = 0.000001;
export const DEFAULT_RATING = 800;
export const DEFAULT_RD = 200;
export const DEFAULT_VOL = 0.06;
export const FRITZ_ROOKIE_ID = '00000000-0000-0000-0000-000000000002';
export const FRITZ_STANDARD_ID = '00000000-0000-0000-0000-000000000003';
export const FRITZ_ELITE_ID = '00000000-0000-0000-0000-000000000001';
export const FRITZ_MASTER_ID = '00000000-0000-0000-0000-000000000004';
export const FRITZ_GRANDMASTER_ID = '00000000-0000-0000-0000-000000000005';
export const FRITZ_SYSTEM_ID = FRITZ_ELITE_ID;
export const FRITZ_ROOKIE_RATING = 600;
export const FRITZ_ROOKIE_RD = 50;
export const FRITZ_STANDARD_RATING = 1000;
export const FRITZ_STANDARD_RD = 50;
export const FRITZ_RATING = 1800;
export const FRITZ_RD = 50;
export const FRITZ_MASTER_RATING = 2200;
export const FRITZ_MASTER_RD = 50;
export const FRITZ_GRANDMASTER_RATING = 2400;
export const FRITZ_GRANDMASTER_RD = 45;

export interface GlickoPlayer {
  rating: number;
  rd: number;
  vol: number;
  gamesPlayed: number;
}

export interface GlickoOpponent {
  rating: number;
  rd: number;
}

export interface GlickoResult {
  score: number;
  opponentScore: number;
}

const SCALE = 173.7178;

function toGlicko2(rating: number, rd: number) {
  return {
    mu: (rating - 1500) / SCALE,
    phi: rd / SCALE,
  };
}

function fromGlicko2(mu: number, phi: number) {
  return {
    rating: mu * SCALE + 1500,
    rd: phi * SCALE,
  };
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function E(mu: number, mu_j: number, phi_j: number): number {
  return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

export function computeGlicko2(
  player: GlickoPlayer,
  games: { opponent: GlickoOpponent; result: GlickoResult }[],
): { newRating: number; newRD: number; newVol: number } {
  const { mu, phi } = toGlicko2(player.rating, player.rd);
  const sigma = player.vol;

  // Step 3: Compute v and delta
  let vInv = 0;
  let deltaSum = 0;

  for (const game of games) {
    const { mu: mu_j, phi: phi_j } = toGlicko2(game.opponent.rating, game.opponent.rd);
    const gj = g(phi_j);
    const ej = E(mu, mu_j, phi_j);
    const sj = game.result.score > game.result.opponentScore ? 1 : game.result.score < game.result.opponentScore ? 0 : 0.5;

    vInv += gj * gj * ej * (1 - ej);
    deltaSum += gj * (sj - ej);
  }

  const v = 1 / vInv;
  const delta = v * deltaSum;

  // Step 4: Update volatility sigma' using the iterative procedure (often called Illinois algorithm in this context)
  const a = Math.log(sigma * sigma);

  const f = (x: number) => {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    const p2 = phi * phi;
    const v_val = v;
    const term1 = (ex * (d2 - p2 - v_val - ex)) / (2 * (p2 + v_val + ex) * (p2 + v_val + ex));
    const term2 = (x - a) / (TAU * TAU);
    return term1 - term2;
  };

  let A = a;
  let B: number;

  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) {
      k++;
    }
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > EPSILON) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  const newVol = Math.exp(B / 2);

  // Step 5: Update RD' = phi_star
  const phiStar = Math.sqrt(phi * phi + newVol * newVol);

  // Step 6: Update Rating and RD
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * deltaSum;

  const { rating: newRating, rd: newRD } = fromGlicko2(newMu, newPhi);

  return {
    newRating,
    newRD,
    newVol,
  };
}

export function decayRD(player: GlickoPlayer): { newRD: number } {
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const newRD = Math.min(DEFAULT_RD, phiStar * SCALE);
  return { newRD };
}

export function isProvisional(gamesPlayed: number): boolean {
  return gamesPlayed < 20;
}

export function displayRating(rating: number): number {
  return Math.round(rating);
}

export function getFritzConfig(fritzId: string): {
  rating: number;
  rd: number;
  difficulty: 'casual' | 'standard' | 'hard' | 'master' | 'grandmaster';
} {
  if (fritzId === FRITZ_ROOKIE_ID) {
    return { rating: FRITZ_ROOKIE_RATING, rd: FRITZ_ROOKIE_RD, difficulty: 'casual' };
  }
  if (fritzId === FRITZ_STANDARD_ID) {
    return { rating: FRITZ_STANDARD_RATING, rd: FRITZ_STANDARD_RD, difficulty: 'standard' };
  }
  if (fritzId === FRITZ_GRANDMASTER_ID) {
    return { rating: FRITZ_GRANDMASTER_RATING, rd: FRITZ_GRANDMASTER_RD, difficulty: 'grandmaster' };
  }
  if (fritzId === FRITZ_MASTER_ID) {
    return { rating: FRITZ_MASTER_RATING, rd: FRITZ_MASTER_RD, difficulty: 'master' };
  }
  return { rating: FRITZ_RATING, rd: FRITZ_RD, difficulty: 'hard' };
}

export function isFritzId(id: string): boolean {
  return id === FRITZ_ELITE_ID || id === FRITZ_STANDARD_ID || id === FRITZ_ROOKIE_ID || id === FRITZ_MASTER_ID || id === FRITZ_GRANDMASTER_ID;
}
