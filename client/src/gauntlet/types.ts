import type { BoardState, Move, Tile } from '../types';

export type GauntletDifficulty = 'intro' | 'easy' | 'medium' | 'hard' | 'brutal';
export type FritzArchetype = 'greedy' | 'trap' | 'branchlord' | 'tempo' | 'mirror' | 'boss';
export type GauntletRewardId =
  | 'tempo_buffer'
  | 'route_scan'
  | 'branch_hunter'
  | 'safe_bank'
  | 'double_down'
  | 'ice_veins';

export interface GauntletRewardChoice {
  id: GauntletRewardId;
  title: string;
  description: string;
  rarity: 'common' | 'rare';
}

export interface GauntletScenario {
  round: number;
  difficulty: GauntletDifficulty;
  playerHand: Tile[];
  boardState: BoardState;
  opponentTiles: number;
  fritzArchetype: FritzArchetype;
  fritzName: string;
  encounterTitle: string;
  arenaName: string;
  laneName: string;
  mutationTitle: string;
  mutationDescription: string;
  briefing: string;
  taunt: string;
  threatLabel: string;
  rewardChoices: GauntletRewardChoice[];
  optimalSolution: Move[];
  optimalScore: number;
}

export type PublicGauntletScenario = Omit<GauntletScenario, 'optimalSolution'>;

export interface ReplayFrame {
  roundNumber: number;
  moveIndex: number;
  move: Move;
  timestampMs: number;
  boardStateAfter: BoardState;
}

export interface RoundScore {
  baseScore: number;
  speedBonus: number;
  optimalityPct: number;
  optimalityBonus: number;
  total: number;
}

export interface GauntletTodaySummary {
  dayId: number;
  dayDate: string;
  rounds: PublicGauntletScenario[];
  closesAt: string;
  attemptCount: number;
  attemptId: number | null;
  attemptStatus: 'in_progress' | 'banked' | 'finished' | null;
  roundsPlayed: number;
  totalScore: number;
  rating: number;
  division: string;
  currentLoadout: GauntletRewardChoice[];
}

export interface GauntletLeaderboardRow {
  rank: number;
  userId: string;
  username: string;
  totalScore: number;
  roundsPlayed: number;
  finishedAt: string;
  division: string;
  percentile: number | null;
  isCaller: boolean;
}

export interface GauntletRating {
  userId: string;
  rating: number;
  peakRating: number;
  division: string;
  season: number;
  gamesPlayed: number;
  seasonRank: number | null;
}

export interface GauntletAttemptHistoryRow {
  attemptId: number;
  dayDate: string;
  totalScore: number;
  roundsPlayed: number;
  bankedOut: boolean;
  percentile: number | null;
  eloBefore: number;
  eloAfter: number | null;
  finishedAt: string | null;
}

export interface GauntletRoundSubmitResult {
  baseScore: number;
  speedBonus: number;
  optimalityPct: number;
  optimalityBonus: number;
  duelBonus: number;
  dominanceBonus: number;
  survivalBonus: number;
  roundTotal: number;
  runningTotal: number;
  roundsPlayed: number;
  hasMoreRounds: boolean;
}

export interface GauntletEncounterHistoryItem {
  round: number;
  encounterTitle: string;
  fritzName: string;
  youScore: number;
  fritzScore: number;
  roundTotal: number;
  duelBonus: number;
  dominanceBonus: number;
  survivalBonus: number;
  draftedRewardTitle?: string | null;
}

export interface GauntletFinalizeResult {
  totalScore: number;
  roundsPlayed: number;
  status: 'banked' | 'finished';
}
