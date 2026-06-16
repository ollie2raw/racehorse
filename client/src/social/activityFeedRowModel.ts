import type { FeedItem } from './socialApi';

export type FeedIconKind =
  | 'trophy'
  | 'puzzle'
  | 'medal'
  | 'flame'
  | 'crown'
  | 'mention'
  | 'swords'
  | 'robot';

export type FeedBadgeTone = 'purple' | 'green' | 'teal' | 'gray' | 'gold' | 'red' | 'skunk';

export interface FeedRowViewModel {
  icon: FeedIconKind;
  action: string;
  secondary: string;
  modeBadge?: { label: string; tone: FeedBadgeTone };
  scoreLine?: string;
  pointsLine?: string;
  ratingDelta?: string;
  badge?: { label: string; tone: FeedBadgeTone };
  streakCount?: number;
  showViewButton?: boolean;
}

function normalizeName(value: unknown, fallback: string): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return fallback;
  const lower = name.toLowerCase();
  if (lower.includes('fritz') || lower.includes('bot')) return 'Fritz';
  return name.replace(/^@/, '');
}

function formatMode(mode: unknown): string {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value === 'daily_fritz') return 'Daily Fritz';
  if (value.includes('fritz') || value === 'bot') return 'Play vs Fritz';
  if (value.includes('puzzle')) return 'Daily Puzzle';
  if (value.includes('quick')) return 'Quick Match';
  if (value.includes('ranked')) return 'Ranked';
  if (value.includes('tournament')) return 'Tournament';
  if (value.includes('multi')) return 'Quick Match';
  if (!value) return 'Racehorse';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function tilesSuffix(meta: Record<string, unknown>): string {
  const tiles = meta.tiles ?? meta.hand_size ?? meta.tile_count;
  if (tiles == null || tiles === '') return '';
  return ` • ${tiles} Tiles`;
}

function placementBadge(placement: string | undefined): { label: string; tone: FeedBadgeTone } | undefined {
  if (!placement) return undefined;
  const lower = placement.toLowerCase();
  if (lower.includes('winner') || lower.includes('1st')) return { label: 'Winner', tone: 'gold' };
  if (lower.includes('2nd')) return { label: '2nd Place', tone: 'gray' };
  if (lower.includes('3rd')) return { label: '3rd Place', tone: 'purple' };
  if (lower.includes('4th') || lower.includes('5th')) return { label: placement, tone: 'gray' };
  return { label: placement, tone: 'purple' };
}

function scorePair(meta: Record<string, unknown>, flip = false): string | undefined {
  const a = meta.score;
  const b = meta.opponent_score;
  if (a == null || b == null) return undefined;
  return flip ? `${b} - ${a}` : `${a} - ${b}`;
}

function tournamentAction(meta: Record<string, unknown>): string {
  const name = String(meta.tournament_name ?? 'Tournament');
  const placement = typeof meta.placement === 'string' ? meta.placement : '';
  const lower = placement.toLowerCase();
  if (!placement) return `played ${name}`;
  if (lower.includes('winner') || lower.includes('1st')) return `won ${name}`;
  if (lower.includes('final')) return 'advanced to the Final';
  if (lower.includes('semi')) return 'advanced to the Semifinal';
  return `finished ${placement} in ${name}`;
}

export function buildFeedRowViewModel(item: FeedItem): FeedRowViewModel {
  const meta = item.metadata;

  switch (item.type) {
    case 'win': {
      const opp = normalizeName(meta.opponent_username, 'an opponent');
      const mode = formatMode(meta.mode);
      const isFritzBot = typeof meta.mode === 'string' && (meta.mode === 'bot' || meta.mode.toLowerCase().includes('fritz'));
      return {
        icon: isFritzBot ? 'robot' : 'trophy',
        action: `won against ${opp}`,
        secondary: `${mode}${tilesSuffix(meta)}`,
        modeBadge: { label: mode, tone: isFritzBot ? 'gold' : 'green' },
        scoreLine: scorePair(meta),
        ratingDelta: meta.rating_change != null ? `+${meta.rating_change}` : '+22',
      };
    }
    case 'loss': {
      const opp = normalizeName(meta.opponent_username, 'an opponent');
      const mode = formatMode(meta.mode);
      const isFritzBot = typeof meta.mode === 'string' && (meta.mode === 'bot' || meta.mode.toLowerCase().includes('fritz'));
      return {
        icon: isFritzBot ? 'robot' : 'swords',
        action: `lost to ${opp}`,
        secondary: `${mode}${tilesSuffix(meta)}`,
        modeBadge: { label: mode, tone: isFritzBot ? 'gold' : 'gray' },
        scoreLine: scorePair(meta, true),
        badge: { label: 'Loss', tone: 'red' },
      };
    }
    case 'streak': {
      const n = Number(meta.streak ?? 0);
      const source = meta.source === 'puzzle' ? 'Daily Puzzle' : 'Play vs Fritz';
      return {
        icon: 'flame',
        action: `hit a ${n || '?'}-match win streak`,
        secondary: source,
        modeBadge: { label: source, tone: 'gold' },
        streakCount: Math.min(Math.max(n, 1), 7),
        ratingDelta: '+18',
      };
    }
    case 'tournament': {
      const placement = meta.placement as string | undefined;
      const players = meta.player_count ?? meta.players;
      return {
        icon: 'medal',
        action: tournamentAction(meta),
        secondary: players != null ? `${players} players` : 'Tournament bracket update',
        modeBadge: { label: 'Tournament', tone: 'purple' },
        badge: placementBadge(placement),
      };
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return {
        icon: 'puzzle',
        action: 'won Daily Puzzle',
        secondary: s != null ? `Solved with ${s} points` : 'Daily Puzzle complete',
        modeBadge: { label: 'Daily Puzzle', tone: 'teal' },
        pointsLine: s != null ? `${s} pts` : undefined,
        ratingDelta: '+12',
      };
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const opp = 'Fritz';
      const playerScore = meta.player_score as number | undefined;
      const fritzScore = meta.fritz_score as number | undefined;
      const gameNumberRaw = meta.game_number;
      const gameNumber =
        gameNumberRaw === 1 || gameNumberRaw === 2 || gameNumberRaw === 3 ? gameNumberRaw : null;
      const won = result === 'win';
      const skunk = meta.skunk === true;
      const skunkBy = meta.skunk_by === 'player' || meta.skunk_by === 'fritz' ? meta.skunk_by : null;
      return {
        icon: 'robot',
        action:
          skunk && won
            ? `skunked ${opp}`
            : skunk && skunkBy === 'fritz'
              ? `was skunked by ${opp}`
              : won
                ? `won against ${opp}`
                : `lost to ${opp}`,
        secondary: gameNumber != null ? `Game ${gameNumber} · Elite run` : 'Elite run',
        modeBadge: { label: 'Daily Fritz', tone: 'gold' },
        scoreLine:
          playerScore != null && fritzScore != null
            ? `${playerScore} - ${fritzScore}`
            : undefined,
        badge: skunk
          ? { label: 'SKUNK', tone: 'skunk' }
          : won
            ? { label: 'Winner', tone: 'teal' }
            : { label: 'Loss', tone: 'red' },
      };
    }
    default:
      return {
        icon: 'mention',
        action: 'posted an update',
        secondary: 'Racehorse',
        showViewButton: true,
      };
  }
}
