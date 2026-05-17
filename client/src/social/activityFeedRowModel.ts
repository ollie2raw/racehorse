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

export type FeedBadgeTone = 'purple' | 'green' | 'teal' | 'gray' | 'gold';

export interface FeedRowViewModel {
  icon: FeedIconKind;
  action: string;
  secondary: string;
  scoreLine?: string;
  pointsLine?: string;
  ratingDelta?: string;
  badge?: { label: string; tone: FeedBadgeTone };
  streakCount?: number;
  showViewButton?: boolean;
}

function formatMode(mode: unknown): string {
  const value = typeof mode === 'string' ? mode.toLowerCase() : '';
  if (value.includes('fritz') || value === 'bot' || value === 'daily_fritz') return 'Play vs Fritz';
  if (value.includes('puzzle')) return 'Daily Puzzle';
  if (value.includes('ranked')) return 'Ranked';
  if (value.includes('tournament')) return 'Tournament';
  if (value.includes('multi')) return 'Multiplayer';
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
  if (lower.includes('winner') || lower.includes('1st')) return { label: 'Winner', tone: 'teal' };
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

export function buildFeedRowViewModel(item: FeedItem): FeedRowViewModel {
  const meta = item.metadata;

  switch (item.type) {
    case 'win': {
      const opp = meta.opponent_username as string | undefined;
      const mode = formatMode(meta.mode);
      return {
        icon: 'trophy',
        action: opp ? `defeated ${opp}` : 'won a match',
        secondary: `Online • ${mode}${tilesSuffix(meta)}`,
        scoreLine: scorePair(meta),
        ratingDelta: meta.rating_change != null ? `+${meta.rating_change}` : '+22',
      };
    }
    case 'loss': {
      const opp = meta.opponent_username as string | undefined;
      const mode = formatMode(meta.mode);
      return {
        icon: 'swords',
        action: opp ? `lost to ${opp}` : 'lost a match',
        secondary: `Online • ${mode}${tilesSuffix(meta)}`,
        scoreLine: scorePair(meta, true),
      };
    }
    case 'streak': {
      const n = Number(meta.streak ?? 0);
      return {
        icon: 'flame',
        action: `${n || '?'} win streak`,
        secondary: meta.source === 'puzzle' ? 'Daily Puzzle' : 'Play vs Fritz',
        streakCount: Math.min(Math.max(n, 1), 7),
        ratingDelta: '+18',
      };
    }
    case 'tournament': {
      const placement = meta.placement as string | undefined;
      const players = meta.player_count ?? meta.players;
      return {
        icon: 'medal',
        action: String(meta.tournament_name ?? 'Tournament'),
        secondary: players != null ? `${players} Players` : 'Tournament',
        badge: placementBadge(placement),
      };
    }
    case 'puzzle': {
      const s = meta.score as number | undefined;
      return {
        icon: 'puzzle',
        action: "won today's Daily Puzzle",
        secondary: s != null ? `Score: ${s}` : 'Daily Puzzle',
        pointsLine: s != null ? `${s} pts` : undefined,
        ratingDelta: '+12',
      };
    }
    case 'daily_fritz': {
      const result = meta.result as string | undefined;
      const opp = 'Daily Fritz';
      const playerScore = meta.player_score as number | undefined;
      const fritzScore = meta.fritz_score as number | undefined;
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
                ? `defeated ${opp}`
                : `lost to ${opp}`,
        secondary: 'Daily Fritz • Elite',
        scoreLine:
          playerScore != null && fritzScore != null
            ? `${playerScore} - ${fritzScore}`
            : undefined,
        badge: skunk
          ? { label: 'SKUNK', tone: 'gold' }
          : won
            ? { label: 'Winner', tone: 'teal' }
            : undefined,
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
