import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import LayoutScreen from '../ui/LayoutScreen';
import { Board, DominoTile } from '../components';
import { applyPlayMove, computeOpenEndsSum, drawOne, getLegalMoves, passTurn, previewPlayMove, type BotMatchState, type BotPlayerId } from '../bot/botEngine';
import { chooseBotMove, toBotVisibleState } from '../bot/botHeuristics';
import type { Move, Tile } from '../types';
import {
  finishGauntletAttempt,
  getGauntletLeaderboard,
  getTodayGauntletSummary,
  startGauntletAttempt,
  submitGauntletRound,
  toUserFacingError,
} from './api';
import type {
  GauntletEncounterHistoryItem,
  GauntletLeaderboardRow,
  GauntletRewardChoice,
  GauntletRoundSubmitResult,
  GauntletTodaySummary,
  PublicGauntletScenario,
  ReplayFrame,
} from './types';
import './gauntlet.css';

interface GauntletScreenProps {
  user: User | null;
  profile: UserProfile | null;
  isAdmin: boolean;
  onBack: () => void;
}

type GauntletView = 'lobby' | 'round' | 'between' | 'final';
const MAX_FRITZ_RUN_ENCOUNTERS = 3;

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'Closed';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

function isPlaceholderUsername(username: string): boolean {
  return /^user_[a-f0-9]{8}$/i.test(username);
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function cloneMove(move: Move): Move {
  return {
    type: move.type,
    tile: move.tile ? { ...move.tile } : undefined,
    position: move.position,
  };
}

const LOADOUT_STORAGE_PREFIX = 'racehorse:gauntlet-loadout:';

function readStoredLoadout(attemptId: number | null): GauntletRewardChoice[] {
  if (typeof window === 'undefined' || !attemptId) return [];
  try {
    const raw = window.localStorage.getItem(`${LOADOUT_STORAGE_PREFIX}${attemptId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry): GauntletRewardChoice => {
        const rec = entry as Partial<GauntletRewardChoice>;
        return {
          id: String(rec.id ?? '') as GauntletRewardChoice['id'],
          title: String(rec.title ?? ''),
          description: String(rec.description ?? ''),
          rarity: rec.rarity === 'rare' ? 'rare' : 'common',
        };
      })
      .filter((entry) => entry.id && entry.title);
  } catch {
    return [];
  }
}

function writeStoredLoadout(attemptId: number | null, loadout: GauntletRewardChoice[]) {
  if (typeof window === 'undefined' || !attemptId) return;
  window.localStorage.setItem(`${LOADOUT_STORAGE_PREFIX}${attemptId}`, JSON.stringify(loadout));
}

function hasReward(loadout: GauntletRewardChoice[], id: GauntletRewardChoice['id']): boolean {
  return loadout.some((reward) => reward.id === id);
}

function nextPlayer(player: BotPlayerId): BotPlayerId {
  return player === 'you' ? 'bot' : 'you';
}

function isDouble(tile: Tile): boolean {
  return tile.low === tile.high;
}

function tileKey(tile: Tile): string {
  return `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;
}

function buildDoubleSixSet(): Tile[] {
  const tiles: Tile[] = [];
  for (let high = 0; high <= 6; high += 1) {
    for (let low = 0; low <= high; low += 1) {
      tiles.push({ low, high });
    }
  }
  return tiles;
}

function getBoardTiles(board: PublicGauntletScenario['boardState']): Tile[] {
  const tiles = board.mainLine.map((placement) => placement.tile);
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (!branch) continue;
      for (const placement of branch.tiles) {
        tiles.push(placement.tile);
      }
    }
  }
  return tiles;
}

function scoreOpponentTileForArchetype(tile: Tile, scenario: PublicGauntletScenario): number {
  const ends = [scenario.boardState.leftEnd, scenario.boardState.rightEnd];
  const touchesBoard = ends.includes(tile.low) || ends.includes(tile.high);
  const pipSum = tile.low + tile.high;
  switch (scenario.fritzArchetype) {
    case 'greedy':
      return pipSum * 2 + (touchesBoard ? 10 : 0);
    case 'tempo':
      return (touchesBoard ? 18 : 0) + (isDouble(tile) ? 12 : 0) + pipSum;
    case 'trap':
      return (touchesBoard ? 14 : 0) + (tile.low === tile.high ? 6 : 0) + Math.abs(tile.high - tile.low);
    case 'branchlord':
      return (isDouble(tile) ? 20 : 0) + (touchesBoard ? 12 : 0) + pipSum * 0.8;
    case 'mirror':
      return (touchesBoard ? 16 : 0) + pipSum * 1.2;
    case 'boss':
      return (touchesBoard ? 20 : 0) + (isDouble(tile) ? 16 : 0) + pipSum * 1.4;
    default:
      return pipSum + (touchesBoard ? 10 : 0);
  }
}

function buildFritzHand(scenario: PublicGauntletScenario): Tile[] {
  const used = new Set<string>();
  for (const tile of scenario.playerHand) used.add(tileKey(tile));
  for (const tile of getBoardTiles(scenario.boardState)) used.add(tileKey(tile));
  const pool = buildDoubleSixSet().filter((tile) => !used.has(tileKey(tile)));
  const scored = [...pool].sort((a, b) => {
    const diff = scoreOpponentTileForArchetype(b, scenario) - scoreOpponentTileForArchetype(a, scenario);
    if (diff !== 0) return diff;
    return tileKey(a).localeCompare(tileKey(b));
  });
  return scored.slice(0, Math.max(0, scenario.opponentTiles)).map((tile) => ({ ...tile }));
}

function runDrawSequenceLocal(initialState: BotMatchState, player: BotPlayerId): { state: BotMatchState; drew: boolean; passed: boolean } {
  let current = initialState;
  let drew = false;
  while (getLegalMoves(current, player).filter((move) => move.type === 'play').length === 0) {
    const step = drawOne(current, player);
    if (!step.drew) break;
    drew = true;
    current = step.state;
  }
  if (getLegalMoves(current, player).filter((move) => move.type === 'play').length === 0) {
    const passResult = passTurn(current, player);
    return { state: passResult.state, drew, passed: Boolean(passResult.passed) };
  }
  return { state: current, drew, passed: false };
}

function stateProgressKey(state: BotMatchState): string {
  const boardTileCount = (state.board?.mainLine.length ?? 0)
    + (state.board?.hubDoubles.reduce((sum, hub) => {
      const branchTiles = hub.branches.reduce((branchSum, branch) => branchSum + (branch?.tiles.length ?? 0), 0);
      return sum + branchTiles;
    }, 0) ?? 0);
  const youHand = state.players.you.hand.map(tileKey).sort().join(',');
  const botHand = state.players.bot.hand.map(tileKey).sort().join(',');
  return [
    state.currentPlayer,
    state.consecutivePasses,
    state.players.you.score,
    state.players.bot.score,
    state.handOver ? 1 : 0,
    state.gameOver ? 1 : 0,
    boardTileCount,
    youHand,
    botHand,
  ].join('|');
}

function resolveBotDeadlock(state: BotMatchState): BotMatchState {
  if (state.currentPlayer !== 'bot' || state.handOver || state.gameOver) return state;

  const botResolved = runDrawSequenceLocal(state, 'bot').state;
  if (botResolved !== state) {
    if (botResolved.handOver || botResolved.gameOver || botResolved.currentPlayer !== 'you') return botResolved;
    const youResolved = runDrawSequenceLocal(botResolved, 'you').state;
    return youResolved;
  }

  const forcedPass = passTurn(state, 'bot').state;
  if (forcedPass !== state) {
    if (forcedPass.handOver || forcedPass.gameOver || forcedPass.currentPlayer !== 'you') return forcedPass;
    const youResolved = runDrawSequenceLocal(forcedPass, 'you').state;
    return youResolved;
  }

  return {
    ...state,
    currentPlayer: 'you',
    consecutivePasses: Math.max(1, state.consecutivePasses),
    turnIndex: (state.turnIndex ?? 0) + 1,
  };
}

function chooseFritzDifficulty(scenario: PublicGauntletScenario): 'casual' | 'standard' | 'hard' {
  switch (scenario.fritzArchetype) {
    case 'greedy':
      return 'standard';
    case 'tempo':
    case 'mirror':
    case 'boss':
      return 'hard';
    case 'trap':
    case 'branchlord':
      return 'hard';
    default:
      return 'standard';
  }
}

function chooseFritzMove(state: BotMatchState, scenario: PublicGauntletScenario): Move | null {
  const legal = getLegalMoves(state, 'bot').filter((move) => move.type === 'play' && move.tile && move.position);
  if (legal.length === 0) return null;
  if (scenario.fritzArchetype === 'mirror') {
    return chooseBotMove(toBotVisibleState(state), 'hard')?.move ?? legal[0];
  }

  const baseline = chooseBotMove(toBotVisibleState(state), chooseFritzDifficulty(scenario));
  const scored = legal
    .map((move) => {
      const preview = previewPlayMove(state, 'bot', move);
      if (!preview || !move.tile) return null;
      const nextState = applyPlayMove(state, 'bot', move).state;
      const yourReplies =
        nextState.currentPlayer === 'you'
          ? getLegalMoves(nextState, 'you').filter((candidate) => candidate.type === 'play').length
          : 0;
      const boardPressure = preview.openEnds.length + computeOpenEndsSum(preview.nextBoard) / 5;
      const immediate = preview.immediateScore;
      const pipSum = move.tile.low + move.tile.high;
      let bias = 0;

      switch (scenario.fritzArchetype) {
        case 'greedy':
          bias = immediate * 18 + pipSum * 2 + (preview.turnContinues ? 18 : 0);
          break;
        case 'trap':
          bias = immediate * 8 - yourReplies * 10 + (preview.isDouble ? 6 : 0) + boardPressure * 1.5;
          break;
        case 'branchlord':
          bias = (preview.isDouble ? 26 : 0) + preview.openEnds.length * 8 + boardPressure * 2;
          break;
        case 'tempo':
          bias = (preview.turnContinues ? 28 : 0) + immediate * 10 - nextState.players.bot.hand.length * 2;
          break;
        case 'boss':
          bias = immediate * 16 + (preview.turnContinues ? 18 : 0) - yourReplies * 7 + boardPressure * 2.5;
          break;
        default:
          bias = immediate * 10 + pipSum;
      }

      const baselineScore = baseline && baseline.move.tile && baseline.move.position === move.position && tileEquals(baseline.move.tile, move.tile)
        ? baseline.score
        : 0;

      return {
        move,
        score: baselineScore + bias,
      };
    })
    .filter((entry): entry is { move: Move; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.move ?? baseline?.move ?? legal[0];
}

const FALLBACK_ROUNDS: PublicGauntletScenario[] = [
  {
    round: 1,
    difficulty: 'intro',
    playerHand: [{ low: 1, high: 5 }, { low: 2, high: 5 }, { low: 0, high: 1 }, { low: 4, high: 6 }, { low: 3, high: 3 }],
    boardState: {
      mainLine: [{ tile: { low: 1, high: 4 }, orientation: 'horizontal-normal' }],
      leftEnd: 1,
      rightEnd: 4,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 3,
    fritzArchetype: 'greedy',
    fritzName: 'Fritz Goldfang',
    encounterTitle: 'Fritz Goldfang Control Rail',
    arenaName: 'Cinder Yard',
    laneName: 'Control Rail',
    mutationTitle: 'Soft Launch',
    mutationDescription: 'Early board stays loose. Push clean points before Fritz settles in.',
    briefing: 'Fritz is hunting obvious points. Beat the first read, not just the first score.',
    taunt: 'Warm-up is over when you blink.',
    threatLabel: 'Warm-up',
    rewardChoices: [
      { id: 'tempo_buffer', title: 'Tempo Buffer', description: 'Reveal the speed-bonus timer bands before each fight.', rarity: 'common' },
      { id: 'route_scan', title: 'Route Scan', description: 'Preview the next Fritz encounter before you commit.', rarity: 'rare' },
      { id: 'branch_hunter', title: 'Branch Hunter', description: 'Display branch pressure and live route counts mid-fight.', rarity: 'common' },
    ],
    optimalScore: 500,
  },
  {
    round: 2,
    difficulty: 'easy',
    playerHand: [{ low: 0, high: 4 }, { low: 2, high: 4 }, { low: 4, high: 5 }, { low: 1, high: 2 }, { low: 3, high: 6 }, { low: 2, high: 2 }],
    boardState: {
      mainLine: [{ tile: { low: 2, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 6,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 4,
    fritzArchetype: 'tempo',
    fritzName: 'Fritz Blitzhand',
    encounterTitle: 'Fritz Blitzhand Highwire Lane',
    arenaName: 'Switchback Arena',
    laneName: 'Highwire Lane',
    mutationTitle: 'Tempo Tax',
    mutationDescription: 'Hesitation bleeds edge. Fast clean lines matter here.',
    briefing: 'This encounter rewards instant recognition. Fritz wants you second-guessing.',
    taunt: 'Late moves are losing moves.',
    threatLabel: 'Rising',
    rewardChoices: [
      { id: 'double_down', title: 'Double Down', description: 'Track live doubles in hand and highlight explosive tiles.', rarity: 'rare' },
      { id: 'safe_bank', title: 'Safe Bank', description: 'Bank prompts emphasize what you are protecting before the jump.', rarity: 'common' },
      { id: 'ice_veins', title: 'Ice Veins', description: 'Surface calmer encounter intel so fast decisions stay readable.', rarity: 'common' },
    ],
    optimalScore: 800,
  },
  {
    round: 3,
    difficulty: 'medium',
    playerHand: [{ low: 1, high: 6 }, { low: 0, high: 6 }, { low: 6, high: 6 }, { low: 2, high: 3 }, { low: 3, high: 5 }, { low: 1, high: 3 }, { low: 2, high: 5 }],
    boardState: {
      mainLine: [{ tile: { low: 0, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 0,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 5,
    fritzArchetype: 'trap',
    fritzName: 'Fritz Snareline',
    encounterTitle: 'Fritz Snareline Ashfall Spur',
    arenaName: 'Dead Rail Annex',
    laneName: 'Ashfall Spur',
    mutationTitle: 'Fork Pressure',
    mutationDescription: 'Branches open fast and bad greed gets punished immediately.',
    briefing: 'The board is bait. Sequence with discipline or the line collapses.',
    taunt: 'The trap was not the tile. It was your confidence.',
    threatLabel: 'High',
    rewardChoices: [
      { id: 'route_scan', title: 'Route Scan', description: 'Preview the next Fritz encounter before you commit.', rarity: 'rare' },
      { id: 'branch_hunter', title: 'Branch Hunter', description: 'Display branch pressure and live route counts mid-fight.', rarity: 'common' },
      { id: 'ice_veins', title: 'Ice Veins', description: 'Surface calmer encounter intel so fast decisions stay readable.', rarity: 'common' },
    ],
    optimalScore: 1200,
  },
  {
    round: 4,
    difficulty: 'hard',
    playerHand: [{ low: 0, high: 3 }, { low: 3, high: 4 }, { low: 3, high: 6 }, { low: 1, high: 1 }, { low: 2, high: 4 }, { low: 4, high: 4 }, { low: 1, high: 5 }],
    boardState: {
      mainLine: [{ tile: { low: 1, high: 6 }, orientation: 'horizontal-normal' }],
      leftEnd: 1,
      rightEnd: 6,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 6,
    fritzArchetype: 'branchlord',
    fritzName: 'Fritz Forkstorm',
    encounterTitle: 'Fritz Forkstorm Vault Line',
    arenaName: 'Walnut Dome',
    laneName: 'Vault Line',
    mutationTitle: 'Collapse Window',
    mutationDescription: 'One dead move and the lane belongs to Fritz.',
    briefing: 'This is where the run turns serious. Control beats panic.',
    taunt: 'Cross the double. I dare you.',
    threatLabel: 'Severe',
    rewardChoices: [
      { id: 'safe_bank', title: 'Safe Bank', description: 'Bank prompts emphasize what you are protecting before the jump.', rarity: 'common' },
      { id: 'double_down', title: 'Double Down', description: 'Track live doubles in hand and highlight explosive tiles.', rarity: 'rare' },
      { id: 'tempo_buffer', title: 'Tempo Buffer', description: 'Reveal the speed-bonus timer bands before each fight.', rarity: 'common' },
    ],
    optimalScore: 1800,
  },
  {
    round: 5,
    difficulty: 'brutal',
    playerHand: [{ low: 0, high: 0 }, { low: 0, high: 2 }, { low: 2, high: 6 }, { low: 5, high: 6 }, { low: 3, high: 5 }, { low: 1, high: 4 }, { low: 2, high: 2 }],
    boardState: {
      mainLine: [{ tile: { low: 2, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    opponentTiles: 6,
    fritzArchetype: 'boss',
    fritzName: 'Emperor Fritz',
    encounterTitle: 'Emperor Fritz Final',
    arenaName: 'Midnight Exchange',
    laneName: 'Signal Run',
    mutationTitle: 'Final Table',
    mutationDescription: 'Every pip is contested. This is the leaderboard round.',
    briefing: 'Your run only matters if you hold form against the boss.',
    taunt: 'Bring me your best line. I will still ask for more.',
    threatLabel: 'Extreme',
    rewardChoices: [],
    optimalScore: 2500,
  },
];

function isScenarioConfigured(scenario: PublicGauntletScenario | null | undefined): scenario is PublicGauntletScenario {
  if (!scenario) return false;
  if (!Array.isArray(scenario.playerHand) || scenario.playerHand.length === 0) return false;
  if (!scenario.boardState || !Array.isArray(scenario.boardState.mainLine)) return false;
  if (scenario.boardState.mainLine.length === 0) return false;
  return true;
}

function hasEncounterMetadata(scenario: PublicGauntletScenario | null | undefined): boolean {
  if (!scenario) return false;
  return Boolean(
    scenario.fritzArchetype
    && scenario.fritzName
    && scenario.encounterTitle
    && scenario.arenaName
    && scenario.laneName
    && scenario.mutationTitle
    && scenario.mutationDescription
    && scenario.briefing
    && scenario.taunt
    && scenario.threatLabel,
  );
}

function normalizeScenario(scenario: PublicGauntletScenario | null | undefined, roundIdx: number): PublicGauntletScenario {
  const fallback = FALLBACK_ROUNDS[Math.max(0, Math.min(FALLBACK_ROUNDS.length - 1, roundIdx))];
  if (!isScenarioConfigured(scenario)) return fallback;
  const configuredScenario = scenario as PublicGauntletScenario;
  if (hasEncounterMetadata(configuredScenario)) return configuredScenario;
  return Object.assign({}, fallback, configuredScenario, {
    rewardChoices: Array.isArray(configuredScenario.rewardChoices) && configuredScenario.rewardChoices.length > 0
      ? configuredScenario.rewardChoices
      : fallback.rewardChoices,
  });
}

function withPlayableFallback(scenario: PublicGauntletScenario | null | undefined, roundIdx: number): PublicGauntletScenario {
  return normalizeScenario(scenario, roundIdx);
}

function createRoundState(scenario: PublicGauntletScenario): BotMatchState {
  const boardHasTiles = Array.isArray(scenario.boardState?.mainLine) && scenario.boardState.mainLine.length > 0;
  const fritzHand = buildFritzHand(scenario);
  return {
    players: {
      you: { hand: [...scenario.playerHand], score: 0 },
      bot: { hand: fritzHand, score: 0 },
    },
    board: boardHasTiles
      ? {
          ...scenario.boardState,
          mainLine: [...scenario.boardState.mainLine],
          hubDoubles: [...scenario.boardState.hubDoubles],
        }
      : null,
    boneyard: [],
    deadTiles: [],
    handOpen: boardHasTiles,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };
}

export default function GauntletScreen({ user, profile, onBack }: GauntletScreenProps) {
  const [summary, setSummary] = useState<GauntletTodaySummary | null>(null);
  const [leaderboard, setLeaderboard] = useState<GauntletLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submittingRound, setSubmittingRound] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [view, setView] = useState<GauntletView>('lobby');
  const [attemptId, setAttemptId] = useState<number | null>(null);
  const [currentRoundIndex, setCurrentRoundIndex] = useState(0);
  const [runningTotal, setRunningTotal] = useState(0);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [runtimeState, setRuntimeState] = useState<BotMatchState | null>(null);
  const [roundMoves, setRoundMoves] = useState<Move[]>([]);
  const [roundReplay, setRoundReplay] = useState<ReplayFrame[]>([]);
  const [allReplayFrames, setAllReplayFrames] = useState<ReplayFrame[]>([]);
  const [roundStartMs, setRoundStartMs] = useState(0);
  const [latestRoundResult, setLatestRoundResult] = useState<GauntletRoundSubmitResult | null>(null);
  const [roundAutoSubmitted, setRoundAutoSubmitted] = useState(false);
  const [fritzThinking, setFritzThinking] = useState(false);
  const [encounterHistory, setEncounterHistory] = useState<GauntletEncounterHistoryItem[]>([]);
  const fritzThinkingRef = useRef(false);
  const fritzChainPauseRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const refreshSummary = async () => {
    const today = await getTodayGauntletSummary();
    setSummary(today);
    if (today?.dayDate) {
      const rows = await getGauntletLeaderboard(today.dayDate);
      setLeaderboard(rows);
    } else {
      setLeaderboard([]);
    }
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const today = await getTodayGauntletSummary();
        if (!active) return;
        setSummary(today);
        if (today?.dayDate) {
          const rows = await getGauntletLeaderboard(today.dayDate);
          if (!active) return;
          setLeaderboard(rows);
        } else {
          setLeaderboard([]);
        }
      } catch (err) {
        if (!active) return;
        setError(toUserFacingError(err));
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, []);

  const closeMs = useMemo(() => {
    if (!summary?.closesAt) return 0;
    return new Date(summary.closesAt).getTime() - now;
  }, [summary?.closesAt, now]);

  const displayName = profile?.username && !isPlaceholderUsername(profile.username)
    ? `@${profile.username}`
    : 'Player';

  const rounds = summary?.rounds ?? [];
  const hasFallbackRounds = useMemo(
    () => rounds.some((round) => !isScenarioConfigured(round) || !hasEncounterMetadata(round)),
    [rounds],
  );
  const playableRounds = useMemo(
    () => rounds.map((round, idx) => withPlayableFallback(round, idx)).slice(0, MAX_FRITZ_RUN_ENCOUNTERS),
    [rounds],
  );
  const activeRound = playableRounds[currentRoundIndex] ?? null;
  const nextRound = playableRounds[currentRoundIndex + 1] ?? null;

  const legalMoves = useMemo(() => {
    if (!runtimeState || view !== 'round') return [] as Move[];
    if (runtimeState.currentPlayer !== 'you') return [] as Move[];
    return getLegalMoves(runtimeState, 'you').filter((m) => m.type === 'play' && m.tile && m.position);
  }, [runtimeState, view]);

  const playableTiles = useMemo(() => {
    const set = new Set<string>();
    for (const move of legalMoves) {
      if (!move.tile) continue;
      set.add(`${move.tile.low}-${move.tile.high}`);
    }
    return set;
  }, [legalMoves]);
  const canResolveNoMove = view === 'round'
    && runtimeState?.currentPlayer === 'you'
    && !runtimeState?.handOver
    && !runtimeState?.gameOver
    && legalMoves.length === 0;
  const liveEncounterScore = view === 'round' ? (runtimeState?.players.you.score ?? 0) : 0;
  const liveRunPace = runningTotal + liveEncounterScore;

  const openRound = (roundIdx: number) => {
    const scenario = rounds[roundIdx];
    const safeScenario = withPlayableFallback(scenario, roundIdx);
    if (!safeScenario) return;
    setCurrentRoundIndex(roundIdx);
    setRuntimeState(createRoundState(safeScenario));
    setSelectedTile(null);
    setRoundMoves([]);
    setRoundReplay([]);
    setRoundStartMs(Date.now());
    setRoundAutoSubmitted(false);
    setFritzThinking(false);
    fritzChainPauseRef.current = false;
    setView('round');
  };

  const handleStartOrResume = async () => {
    if (!user) {
      setError('Sign in to enter The Gauntlet.');
      return;
    }

    setStarting(true);
    setError(null);
    try {
      let nextAttemptId: number | null = null;
      let nextRoundsPlayed = 0;
      let nextTotal = 0;

      const started = await startGauntletAttempt();
      nextAttemptId = started.attemptId;

      await refreshSummary();
      const refreshed = await getTodayGauntletSummary();
      if (refreshed) {
        setSummary(refreshed);
        nextRoundsPlayed = refreshed.roundsPlayed;
        nextTotal = refreshed.totalScore;
        nextAttemptId = refreshed.attemptId ?? nextAttemptId;
      }

      if (!nextAttemptId) {
        setError('Unable to start attempt.');
        return;
      }

      setAttemptId(nextAttemptId);
      setRunningTotal(nextTotal);
      setAllReplayFrames([]);
      setEncounterHistory([]);
      openRound(Math.min(MAX_FRITZ_RUN_ENCOUNTERS - 1, nextRoundsPlayed));
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setStarting(false);
    }
  };

  const handlePositionClick = (position: Move['position']) => {
    if (!runtimeState || !selectedTile || !activeRound || submittingRound) return;
    if (runtimeState.currentPlayer !== 'you') return;

    const move = legalMoves.find(
      (candidate) =>
        candidate.position === position &&
        candidate.tile &&
        tileEquals(candidate.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(runtimeState, 'you', move);
    const nextState = result.state;
    const moveCopy = cloneMove(move);

    const frame: ReplayFrame = {
      roundNumber: activeRound.round,
      moveIndex: roundMoves.length,
      move: moveCopy,
      timestampMs: Math.max(0, Date.now() - roundStartMs),
      boardStateAfter: nextState.board
        ? {
            ...nextState.board,
            mainLine: [...nextState.board.mainLine],
            hubDoubles: [...nextState.board.hubDoubles],
          }
        : {
            mainLine: [],
            leftEnd: 0,
            rightEnd: 0,
            leftEndIsDouble: false,
            rightEndIsDouble: false,
            hubDoubles: [],
          },
    };

    setRuntimeState(nextState);
    setRoundMoves((prev) => [...prev, moveCopy]);
    setRoundReplay((prev) => [...prev, frame]);
    setSelectedTile(null);
  };

  const handleResolveNoMove = () => {
    if (!runtimeState || runtimeState.currentPlayer !== 'you' || runtimeState.handOver || runtimeState.gameOver) return;
    const result = runDrawSequenceLocal(runtimeState, 'you');
    if (result.state === runtimeState) return;
    setRuntimeState(result.state);
    setSelectedTile(null);
  };

  const submitCurrentRound = async () => {
    if (!attemptId || !activeRound || !runtimeState || submittingRound) return;
    setSubmittingRound(true);
    setError(null);
    try {
      const playerScore = runtimeState.players.you.score;
      const timeTakenMs = Math.max(0, Date.now() - roundStartMs);

      const scored = await submitGauntletRound({
        attemptId,
        roundNumber: activeRound.round,
        movesPlayed: roundMoves,
        replayFrames: roundReplay,
        timeTakenMs,
        playerScore,
        fritzScore: runtimeState.players.bot.score,
        playerHandCount: runtimeState.players.you.hand.length,
        fritzHandCount: runtimeState.players.bot.hand.length,
        loadout: [],
        encounterResult: {
          wonHand: runtimeState.lastHandWinner === 'you',
          lostHand: runtimeState.lastHandWinner === 'bot',
          handReason: runtimeState.lastHandReason,
          fritzArchetype: activeRound.fritzArchetype,
          encounterTitle: activeRound.encounterTitle,
        },
      });

      setLatestRoundResult(scored);
      setRunningTotal(scored.runningTotal);
      setAllReplayFrames((prev) => [...prev, ...roundReplay]);
      setEncounterHistory((prev) => [
        ...prev,
        {
          round: activeRound.round,
          encounterTitle: activeRound.encounterTitle,
          fritzName: activeRound.fritzName,
          youScore: runtimeState.players.you.score,
          fritzScore: runtimeState.players.bot.score,
          roundTotal: scored.roundTotal,
          duelBonus: scored.duelBonus,
          dominanceBonus: scored.dominanceBonus,
          survivalBonus: scored.survivalBonus,
          draftedRewardTitle: null,
        },
      ]);

      if (currentRoundIndex + 1 >= MAX_FRITZ_RUN_ENCOUNTERS) {
        setFinishing(true);
        const finalized = await finishGauntletAttempt(attemptId, [...allReplayFrames, ...roundReplay]);
        setRunningTotal(finalized.totalScore);
        await refreshSummary();
        setView('final');
      } else {
        setView('between');
      }
    } catch (err) {
      setError(toUserFacingError(err));
    } finally {
      setSubmittingRound(false);
      setFinishing(false);
    }
  };

  useEffect(() => {
    if (view !== 'round' || !runtimeState || submittingRound || roundAutoSubmitted) return;
    if (!runtimeState.handOver) return;
    setRoundAutoSubmitted(true);
    void submitCurrentRound();
  }, [view, runtimeState, submittingRound, roundAutoSubmitted]);

  useEffect(() => {
    if (view !== 'round' || !runtimeState || runtimeState.handOver || runtimeState.gameOver) return;
    if (runtimeState.currentPlayer !== 'bot' || fritzThinkingRef.current || !activeRound) return;
    let cancelled = false;
    fritzThinkingRef.current = true;
    setFritzThinking(true);
    const thinkDelayMs = fritzChainPauseRef.current ? 1180 : 760;
    fritzChainPauseRef.current = false;
    const timer = window.setTimeout(() => {
      let working = runtimeState;
      let replayFrames = [...roundReplay];
      const beforeKey = stateProgressKey(working);
      const initialPlayable = getLegalMoves(working, 'bot').filter((move) => move.type === 'play' && move.tile && move.position);
      if (initialPlayable.length === 0) {
        working = runDrawSequenceLocal(working, 'bot').state;
      }

      const botPlayable = getLegalMoves(working, 'bot').filter((move) => move.type === 'play' && move.tile && move.position);
      if (!working.handOver && !working.gameOver && working.currentPlayer === 'bot' && botPlayable.length > 0) {
        const move = chooseFritzMove(working, activeRound) ?? botPlayable[0];
        const result = applyPlayMove(working, 'bot', move);
        working = result.state;
        if (move.type === 'play' && move.tile) {
          replayFrames = [
            ...replayFrames,
            {
              roundNumber: activeRound.round,
              moveIndex: replayFrames.length,
              move: cloneMove(move),
              timestampMs: Math.max(0, Date.now() - roundStartMs),
              boardStateAfter: working.board
                ? {
                    ...working.board,
                    mainLine: [...working.board.mainLine],
                    hubDoubles: [...working.board.hubDoubles],
                  }
                : {
                    mainLine: [],
                    leftEnd: 0,
                    rightEnd: 0,
                    leftEndIsDouble: false,
                    rightEndIsDouble: false,
                    hubDoubles: [],
                  },
            },
          ];
        }
      }

      if (stateProgressKey(working) === beforeKey) {
        working = resolveBotDeadlock(working);
      }

      if (!cancelled) {
        fritzChainPauseRef.current =
          working.currentPlayer === 'bot' && !working.handOver && !working.gameOver;
        setRoundReplay(replayFrames);
        setRuntimeState(working);
        setSelectedTile(null);
        fritzThinkingRef.current = false;
        setFritzThinking(false);
      }
    }, thinkDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      fritzThinkingRef.current = false;
      setFritzThinking(false);
    };
  }, [view, runtimeState, activeRound, roundReplay, roundStartMs]);

  useEffect(() => {
    if (view !== 'round' || !runtimeState || runtimeState.currentPlayer !== 'you') return;
    if (runtimeState.handOver || runtimeState.gameOver) return;
    if (legalMoves.length > 0) return;
    const result = runDrawSequenceLocal(runtimeState, 'you');
    if (result.state !== runtimeState) {
      setRuntimeState(result.state);
      setSelectedTile(null);
    }
  }, [view, runtimeState, legalMoves.length]);

  const handleContinue = async () => {
    if (!activeRound) return;
    openRound(Math.min(MAX_FRITZ_RUN_ENCOUNTERS - 1, currentRoundIndex + 1));
  };

  const renderLobby = () => (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
      badge="Racehorse Dominoes"
      title="Fritz Run"
      subtitle="Three daily Fritz encounters. Same seed for everyone."
      contentClassName="screen-shell"
    >
      <div className="gauntlet-shell">
        <div className="gauntlet-entry-card">
          <div className="gauntlet-entry-top">
            <div>
              <p className="gauntlet-kicker">Daily Challenge</p>
              <h2>⚔ The Gauntlet</h2>
            </div>
            <span className="gauntlet-pill">DAILY</span>
          </div>

          {loading && <p className="lobby-server">Loading today&apos;s gauntlet...</p>}
          {!loading && !summary && <p className="lobby-server">No gauntlet published for today yet.</p>}
          {error && <p className="auth-inline-error">{error}</p>}
          {summary && hasFallbackRounds && (
            <p className="gauntlet-fallback-note">
              Using fallback round templates. Publish full generated rounds for true daily challenge quality.
            </p>
          )}
          {summary && (
            <>
              <div className="gauntlet-stat-grid">
                <p className="gauntlet-stat">Your rating: <strong>{summary.rating.toLocaleString()}</strong> [{summary.division}]</p>
                <p className="gauntlet-stat">Today&apos;s attempts: {summary.attemptCount.toLocaleString()} players</p>
                <p className="gauntlet-stat">Signed in as: {user ? displayName : 'Guest (read-only)'}</p>
                <p className="gauntlet-stat">Daily seed: <strong>Fritz Circuit</strong> · Same encounters for everyone, one run to survive.</p>
              </div>

              <div className="gauntlet-round-track" aria-label="Gauntlet rounds">
                {playableRounds.map((round) => (
                  <div key={round.round} className={`gauntlet-round-dot round-${round.difficulty}`} title={`Round ${round.round}: ${round.difficulty}`}>
                    {round.round}
                  </div>
                ))}
              </div>

              <div className="gauntlet-encounter-stack">
                {playableRounds.map((round) => (
                  <div key={`encounter-${round.round}`} className="gauntlet-encounter-card">
                    <div className="gauntlet-encounter-top">
                      <span className="gauntlet-encounter-index">Encounter {round.round}</span>
                      <span className={`gauntlet-threat-chip threat-${round.difficulty}`}>{round.threatLabel}</span>
                    </div>
                    <h4>{round.encounterTitle}</h4>
                    <p>{round.mutationTitle} · {round.arenaName}</p>
                  </div>
                ))}
              </div>

              <div className="gauntlet-footer-row">
                <p className="gauntlet-close">Closes in: {formatRemaining(closeMs)}</p>

                <div className="gauntlet-actions">
                  <button className="mode-option mode-option-primary gauntlet-enter-btn" onClick={handleStartOrResume} disabled={starting || !user || closeMs <= 0}>
                    <span className="mode-option-title">{summary.attemptId ? 'Resume Attempt' : 'Enter the Gauntlet'}</span>
                  <span className="mode-option-meta">
                    {summary.attemptId
                      ? `Attempt #${summary.attemptId} · ${Math.min(summary.roundsPlayed, MAX_FRITZ_RUN_ENCOUNTERS)}/${MAX_FRITZ_RUN_ENCOUNTERS} encounters · ${summary.totalScore.toLocaleString()} pts`
                      : 'Start your daily Fritz run'}
                  </span>
                </button>
                  <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="gauntlet-leaderboard-card mode-option">
          <h3>Leaderboard Preview</h3>
          {leaderboard.length === 0 ? (
            <p className="lobby-server">No finalized attempts yet.</p>
          ) : (
            <div className="gauntlet-leaderboard-list">
              {leaderboard.slice(0, 5).map((row) => (
                <div key={`${row.rank}-${row.userId}`} className={`gauntlet-leaderboard-row ${row.isCaller ? 'is-caller' : ''}`}>
                  <span>#{row.rank}</span>
                  <span className="gauntlet-name">{row.username}</span>
                  <span>{row.totalScore.toLocaleString()}</span>
                  <span>{row.division}</span>
                </div>
              ))}
            </div>
          )}
          <p className="gauntlet-footnote">Full replay unlocks after close at 00:00 UTC.</p>
        </div>
      </div>
    </LayoutScreen>
  );

  const renderRound = () => {
    if (!runtimeState || !activeRound) return null;
    const recentHistory = encounterHistory.slice(-3).reverse();
    const turnLabel = runtimeState.handOver
      ? runtimeState.players.you.score >= runtimeState.players.bot.score
        ? 'Encounter secured'
        : 'Fritz took the hand'
      : runtimeState.currentPlayer === 'bot'
        ? fritzThinking
          ? `${activeRound.fritzName} is thinking`
          : `${activeRound.fritzName} is moving`
        : 'Your turn';

    return (
      <div className="screen game-screen walnut-live theme-green gauntlet-play-screen">
        <div className="wl-top-rail gauntlet-top-rail" data-ui="hud">
          <div className="gauntlet-pace-pill" data-ui="gauntlet-pace">
            <span className="gauntlet-pace-label">{view === 'round' ? 'Live Pace' : 'Gauntlet Total'}</span>
            <span className="gauntlet-pace-score">{view === 'round' ? liveRunPace : runningTotal}</span>
            {view === 'round' && (
              <span className="gauntlet-pace-meta">Banked {runningTotal} · Encounter {liveEncounterScore}</span>
            )}
          </div>
          <div className="daily-center-zone">
            <div className="wl-center-status">
              <span className="wl-turn-label your-turn">Encounter {currentRoundIndex + 1}/{MAX_FRITZ_RUN_ENCOUNTERS} · {turnLabel}</span>
              <span className="wl-room-code">You {runtimeState.players.you.score} · Fritz {runtimeState.players.bot.score}</span>
            </div>
          </div>
          <div className="daily-top-actions-pill">
            <button className="btn text compact daily-chip-control" onClick={onBack}>Back to Home</button>
          </div>
        </div>

        {error && <div className="gauntlet-inline-error">{error}</div>}
        <div className="gauntlet-sidecar">
          <div className="gauntlet-sidecard gauntlet-identity-card">
            <div className="gauntlet-sidecard-kicker">{activeRound.fritzName}</div>
            <strong>{activeRound.laneName}</strong>
            <p>{activeRound.briefing}</p>
          </div>
          <div className="gauntlet-sidecard gauntlet-chip-card">
            <span className={`gauntlet-threat-chip threat-${activeRound.difficulty}`}>{activeRound.threatLabel}</span>
            <span className="gauntlet-round-chip">{activeRound.arenaName}</span>
            <span className="gauntlet-round-chip">{activeRound.laneName}</span>
          </div>
          <div className="gauntlet-sidecard">
            <div className="gauntlet-sidecard-kicker">Encounter Intel</div>
            <p>Live routes: <strong>{legalMoves.length}</strong> playable placements</p>
            <p>Threat level: <strong>{activeRound.threatLabel}</strong></p>
          </div>
          {recentHistory.length > 0 && (
            <div className="gauntlet-sidecard">
              <div className="gauntlet-sidecard-kicker">Run Log</div>
              <div className="gauntlet-history-list">
                {recentHistory.map((item) => (
                  <div key={`history-${item.round}`} className="gauntlet-history-item">
                    <strong>{item.encounterTitle}</strong>
                    <span>You {item.youScore} · Fritz {item.fritzScore}</span>
                    <span>+{item.roundTotal} total</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="wl-stage-shell">
          <div className="board-area wl-board-area gauntlet-board-card" data-ui="board">
            <Board
              board={runtimeState.board}
              legalMoves={legalMoves}
              selectedTile={selectedTile}
              onPositionClick={handlePositionClick}
              tileSize={72}
            />
          </div>
        </div>

        <div className="hand-area wl-hand-area" data-ui="tray">
          <div className="tray-rail">
            <div className="tray-center">
              <div className="hand-container">
                <div className="hand-row">
                  {runtimeState.players.you.hand.map((tile, idx) => {
                    const isSelected = selectedTile ? tileEquals(selectedTile, tile) : false;
                    const key = `${tile.low}-${tile.high}`;
                    const playable = playableTiles.has(key);
                    return (
                      <DominoTile
                        key={`gauntlet-hand-${idx}-${key}`}
                        tile={tile}
                        size={56}
                        rotation={0}
                        selected={isSelected}
                        highlight={playable}
                        disabled={!playable || submittingRound}
                        onClick={() => {
                          if (!playable || submittingRound) return;
                          setSelectedTile(tile);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="gauntlet-round-actions">
          {canResolveNoMove && (
            <button
              className="mode-inline-btn gauntlet-pass-btn"
              onClick={handleResolveNoMove}
              disabled={submittingRound || finishing}
            >
              Draw / Pass
            </button>
          )}
          <button
            className="mode-option mode-option-primary"
            onClick={submitCurrentRound}
            disabled={submittingRound || finishing || !runtimeState.handOver}
          >
            <span className="mode-option-title">{submittingRound ? 'Scoring Encounter...' : 'Finish Encounter'}</span>
            <span className="mode-option-meta">
              {runtimeState.handOver
                ? 'Lock this duel result against Fritz and send it for ranked scoring'
                : 'Encounter auto-scores when the hand ends'}
            </span>
          </button>
          <span className="gauntlet-round-meta">
            Your moves: {roundMoves.length} · Live routes: {runtimeState.currentPlayer === 'you' ? legalMoves.length : 0}
            {canResolveNoMove ? ' · No legal moves, resolve draw/pass to continue' : ''}
          </span>
        </div>
      </div>
    );
  };

  const renderBetween = () => {
    if (!activeRound || !latestRoundResult) return null;
    const youScore = runtimeState?.players.you.score ?? 0;
    const fritzScore = runtimeState?.players.bot.score ?? 0;
    const verdict =
      youScore > fritzScore
        ? 'You broke Fritz.'
        : youScore < fritzScore
          ? 'Fritz won the hand, but the run lives on.'
          : 'Dead even. Fritz did not separate from you.';

    return (
      <LayoutScreen
        className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
        badge="Racehorse Dominoes"
        title={`Encounter ${activeRound.round} Cleared`}
        subtitle="Clear the recap, then move straight into the next Fritz encounter."
        contentClassName="screen-shell"
      >
        <div className="gauntlet-result-card">
          <div className="gauntlet-result-layout">
            <section className="gauntlet-result-section gauntlet-score-section">
              <p><strong>{verdict}</strong></p>
              <div className="gauntlet-score-grid">
                <p>Encounter board: <strong>You {youScore}</strong> · <strong>Fritz {fritzScore}</strong></p>
                <p>Base score: <strong>{latestRoundResult.baseScore}</strong></p>
                <p>Speed bonus: <strong>+{latestRoundResult.speedBonus}</strong></p>
                <p>Optimality ({Math.round(latestRoundResult.optimalityPct * 100)}%): <strong>+{latestRoundResult.optimalityBonus}</strong></p>
                <p>Duel bonus: <strong>+{latestRoundResult.duelBonus}</strong></p>
                <p>Dominance bonus: <strong>+{latestRoundResult.dominanceBonus}</strong></p>
                <p>Survival bonus: <strong>+{latestRoundResult.survivalBonus}</strong></p>
                <p>Round total: <strong>{latestRoundResult.roundTotal}</strong></p>
                <p>Running total: <strong>{latestRoundResult.runningTotal}</strong></p>
              </div>
              <p className="gauntlet-warning">
                {nextRound
                  ? `Next threat: ${nextRound.fritzName} · ${nextRound.mutationTitle}`
                  : 'Final encounter reached.'}
              </p>
              {nextRound && (
                <div className="gauntlet-next-preview">
                  <div className="gauntlet-sidecard-kicker">Next Encounter Preview</div>
                  <strong>{nextRound.encounterTitle}</strong>
                  <p>{nextRound.mutationTitle}: {nextRound.mutationDescription}</p>
                </div>
              )}
            </section>

            <section className="gauntlet-result-section gauntlet-reward-section">
              {encounterHistory.length > 0 && (
                <div className="gauntlet-run-summary">
                  <div className="gauntlet-sidecard-kicker">Run So Far</div>
                  {encounterHistory.map((item) => (
                    <div key={`between-history-${item.round}`} className="gauntlet-history-item">
                      <strong>#{item.round} {item.fritzName}</strong>
                      <span>{item.youScore}-{item.fritzScore} · +{item.roundTotal}</span>
                      <span>
                        Duel +{item.duelBonus} · Dom +{item.dominanceBonus} · Survive +{item.survivalBonus}
                        {item.draftedRewardTitle ? ` · Drafted ${item.draftedRewardTitle}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          {error && <p className="auth-inline-error">{error}</p>}
          <div className="gauntlet-actions">
            <button className="mode-option mode-option-primary" onClick={handleContinue} disabled={finishing}>
              <span className="mode-option-title">{nextRound ? 'Continue Run →' : 'View Result'}</span>
            </button>
          </div>
        </div>
      </LayoutScreen>
    );
  };

  const renderFinal = () => (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen mode-accent-gauntlet"
      badge="Racehorse Dominoes"
      title="Gauntlet Complete"
      subtitle="Finalized for today."
      contentClassName="screen-shell"
    >
      <div className="gauntlet-result-card">
        <p>Total score: <strong>{runningTotal.toLocaleString()}</strong></p>
        <p>Attempt: <strong>#{attemptId ?? '-'}</strong></p>
        <p>Rounds completed: <strong>{summary?.roundsPlayed ?? currentRoundIndex + 1}</strong></p>
        {encounterHistory.length > 0 && (
          <div className="gauntlet-run-summary">
            <div className="gauntlet-sidecard-kicker">Run Breakdown</div>
            {encounterHistory.map((item) => (
              <div key={`final-history-${item.round}`} className="gauntlet-history-item">
                <strong>Encounter {item.round}: {item.encounterTitle}</strong>
                <span>You {item.youScore} · Fritz {item.fritzScore} · +{item.roundTotal}</span>
                <span>
                  Duel +{item.duelBonus} · Dominance +{item.dominanceBonus} · Survival +{item.survivalBonus}
                  {item.draftedRewardTitle ? ` · Drafted ${item.draftedRewardTitle}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="gauntlet-actions">
          <button className="mode-option mode-option-secondary" onClick={() => setView('lobby')}>
            <span className="mode-option-title">Back to Gauntlet Lobby</span>
          </button>
          <button className="mode-option mode-option-secondary" onClick={onBack}>
            <span className="mode-option-title">Back to Home</span>
          </button>
        </div>
      </div>
    </LayoutScreen>
  );

  if (view === 'round') return renderRound();
  if (view === 'between') return renderBetween();
  if (view === 'final') return renderFinal();
  return renderLobby();
}
