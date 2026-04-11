import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import BotMatchScreen from '../bot/BotMatchScreen';
import { fetchGhostProfileSummary, type GhostProfileSummary } from '../ghost/api';
import LayoutScreen from '../ui/LayoutScreen';
import LeagueHistoryScreen from './LeagueHistoryScreen';
import { ensureLeagueReady, fetchLeagueHistory, openLeagueLiveRoom, reportLeagueResult } from './api';
import type {
  FixtureRecord,
  LeagueHistoryResponse,
  LeaguePlayerState,
  LeagueStandingRow,
} from './types';
import './league.css';

interface LeagueScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onBack: () => void;
  onOpenLiveMatch: (roomCode: string) => Promise<void> | void;
}

type Stage = 'hub' | 'pre' | 'match' | 'post' | 'history';
type ResultCode = 'W' | 'D' | 'L';
const TOTAL_DIVISIONS = 3;
const PROMOTION_SLOTS = 2;
const RELEGATION_SLOTS = 2;
const RELEGATION_START = 6;
const LEAGUE_MATCH_META_KEY = 'racehorse:league-match-meta';

type ResultChip = {
  code: ResultCode;
  label: string;
  className: string;
};

type FixtureSummary = {
  fixtureId: string;
  matchday: number;
  opponentName: string;
  result: ResultChip;
  scoreLabel: string;
  pointsGained: number;
  positionChange: number | null;
  impactLabel: string;
};

type PostMatchState = {
  yourScore: number;
  botScore: number;
  winner: 'you' | 'bot' | null;
  standings: LeagueStandingRow[];
  previousPosition: number | null;
  currentPosition: number | null;
  isProvisional: boolean;
  canLiveOverride: boolean;
  isCanonicalProvisional: boolean;
};

function formatDate(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysUntil(dateText: string): number {
  const today = new Date();
  const current = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = Date.parse(`${dateText}T00:00:00Z`);
  return Math.max(0, Math.round((target - current) / 86400000));
}

function ordinal(value: number | null): string {
  if (!value) return '—';
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

function getPstWindowStatus(now = new Date()): { open: boolean; label: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const totalMinutes = hour * 60 + minute;
  const open = totalMinutes >= 20 * 60 && totalMinutes < 20 * 60 + 15;
  return {
    open,
    label: open ? 'Live window open now (8:00-8:15pm PST)' : 'Live window daily at 8:00pm PST',
  };
}

function fixtureScoresForMember(fixture: FixtureRecord, memberId: string): { your: number | null; opp: number | null } {
  const isHome = fixture.home_member_id === memberId;
  return {
    your: isHome ? fixture.home_score : fixture.away_score,
    opp: isHome ? fixture.away_score : fixture.home_score,
  };
}

function resultCodeForFixture(fixture: FixtureRecord, memberId: string): ResultCode | null {
  const { your, opp } = fixtureScoresForMember(fixture, memberId);
  if (your === null || opp === null) return null;
  if (your > opp) return 'W';
  if (your < opp) return 'L';
  return 'D';
}

function resultChip(code: ResultCode): ResultChip {
  if (code === 'W') return { code, label: 'Win', className: 'is-win' };
  if (code === 'L') return { code, label: 'Loss', className: 'is-loss' };
  return { code, label: 'Draw', className: 'is-draw' };
}

function truncateText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function computeStandings(members: LeaguePlayerState['members'], fixtures: FixtureRecord[]): LeagueStandingRow[] {
  const rows = new Map<string, LeagueStandingRow>();
  for (const member of members) {
    rows.set(member.id, {
      memberId: member.id,
      displayName: member.display_name,
      memberType: member.member_type,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointsDiff: 0,
      leaguePoints: 0,
      position: 0,
    });
  }
  for (const fixture of fixtures) {
    if (fixture.status === 'scheduled') continue;
    if (fixture.home_score === null || fixture.away_score === null) continue;
    const home = rows.get(fixture.home_member_id);
    const away = rows.get(fixture.away_member_id);
    if (!home || !away) continue;
    home.played += 1;
    away.played += 1;
    home.pointsFor += fixture.home_score;
    home.pointsAgainst += fixture.away_score;
    away.pointsFor += fixture.away_score;
    away.pointsAgainst += fixture.home_score;
    if (fixture.home_score > fixture.away_score) {
      home.wins += 1;
      home.leaguePoints += 3;
      away.losses += 1;
    } else if (fixture.home_score < fixture.away_score) {
      away.wins += 1;
      away.leaguePoints += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.leaguePoints += 1;
      away.leaguePoints += 1;
    }
  }
  const ordered = [...rows.values()].map((row) => ({
    ...row,
    pointsDiff: row.pointsFor - row.pointsAgainst,
  }));
  ordered.sort((a, b) => {
    if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
    if (b.pointsDiff !== a.pointsDiff) return b.pointsDiff - a.pointsDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.displayName.localeCompare(b.displayName);
  });
  return ordered.map((row, index) => ({ ...row, position: index + 1 }));
}

function zoneStatus(position: number | null): { label: string; className: string; subcopy: string } {
  if (position && position <= 2) {
    return {
      label: 'Promotion Zone',
      className: 'is-promo',
      subcopy: 'Keep winning and you move up next season.',
    };
  }
  if (position && position >= 6) {
    return {
      label: 'Relegation Zone',
      className: 'is-relegation',
      subcopy: 'Danger area. A strong result today matters.',
    };
  }
  return {
    label: 'Mid-table',
    className: 'is-mid',
    subcopy: 'Within reach of promotion, clear of immediate danger.',
  };
}

function classifyOpponentType(
  fixture: FixtureRecord | null,
  opponent: LeaguePlayerState['todaysOpponent'],
  meta: LeaguePlayerState['fixtureResolutionById'][string] | null,
): string {
  if (!fixture || !opponent) return 'No opponent';
  if (fixture.status === 'provisional') {
    if (meta?.effectiveMode === 'ghost') return 'Ghost async match';
    if (meta?.effectiveMode === 'bot' && opponent.memberType === 'player') return 'Bot stand-in async match';
    if (meta?.effectiveMode === 'bot') return 'Bot match';
  }
  if (fixture.status === 'completed') {
    if (meta?.effectiveMode === 'live') return 'Final live match';
    if (opponent.memberType === 'bot') return 'Bot match';
    return 'Final settled match';
  }
  if (opponent.memberType === 'bot') return opponent.isFritz ? 'Fritz bot match' : 'League bot match';
  return 'Real-player match';
}

function describeStakes(
  standings: LeagueStandingRow[],
  yourMemberId: string,
): {
  tone: 'promo' | 'mid' | 'danger';
  headline: string;
  detail: string;
} {
  const you = standings.find((row) => row.memberId === yourMemberId) ?? null;
  if (!you) {
    return {
      tone: 'mid',
      headline: 'Table still settling',
      detail: 'One strong result will start to shape your season.',
    };
  }

  const promoTarget = standings[PROMOTION_SLOTS - 1] ?? null;
  const safetyTarget = standings[RELEGATION_START - 2] ?? null;

  if (you.position <= PROMOTION_SLOTS) {
    const gap = you.leaguePoints - (standings[PROMOTION_SLOTS]?.leaguePoints ?? you.leaguePoints);
    return {
      tone: 'promo',
      headline: gap > 0 ? 'You are holding a promotion place' : 'You are in the promotion places',
      detail: gap > 0 ? `You have a ${gap}-point cushion above the chase pack.` : 'Another result keeps you on the road up.',
    };
  }

  if (you.position >= RELEGATION_START) {
    const gapToSafety = Math.max(0, (safetyTarget?.leaguePoints ?? you.leaguePoints) - you.leaguePoints);
    return {
      tone: 'danger',
      headline: 'You are in relegation danger',
      detail: gapToSafety > 0 ? `You are ${gapToSafety} point${gapToSafety === 1 ? '' : 's'} from safety.` : 'A good result can pull you clear quickly.',
    };
  }

  const gapToPromotion = Math.max(0, (promoTarget?.leaguePoints ?? you.leaguePoints) - you.leaguePoints);
  return {
    tone: 'mid',
    headline: gapToPromotion === 0 ? 'You are within touching distance of promotion' : 'Promotion is still within reach',
    detail: gapToPromotion > 0 ? `You are ${gapToPromotion} point${gapToPromotion === 1 ? '' : 's'} off the promotion places.` : 'One more result could lift you into the top two.',
  };
}

function positionImpactLabel(position: number | null): string {
  if (position === null) return 'Table still settling';
  if (position <= PROMOTION_SLOTS) return `↑ Into the top ${PROMOTION_SLOTS} — promotion spot`;
  if (position >= RELEGATION_START) return `↓ Down to ${ordinal(position)} — relegation danger`;
  return 'Held in the middle pack';
}

function describeRecentImpact(currentPosition: number | null, previousPosition: number | null): string {
  if (currentPosition === null) return 'Table still settling';
  if (previousPosition === null) return positionImpactLabel(currentPosition);
  if (currentPosition <= PROMOTION_SLOTS && previousPosition > PROMOTION_SLOTS) {
    return `↑ Into the top ${PROMOTION_SLOTS} — promotion spot`;
  }
  if (currentPosition >= RELEGATION_START && previousPosition < RELEGATION_START) {
    return `↓ Down to ${ordinal(currentPosition)} — relegation danger`;
  }
  if (currentPosition < previousPosition) {
    return `↑ Up to ${ordinal(currentPosition)} — climbed ${previousPosition - currentPosition}`;
  }
  if (currentPosition > previousPosition) {
    return `↓ Down to ${ordinal(currentPosition)} — dropped ${currentPosition - previousPosition}`;
  }
  if (currentPosition <= PROMOTION_SLOTS) return 'Holding a promotion spot';
  if (currentPosition >= RELEGATION_START) return 'Still in relegation danger';
  return `→ Holding ${ordinal(currentPosition)}`;
}

function buildNextActionMessage(input: {
  fixture: FixtureRecord | null;
  opponent: LeaguePlayerState['todaysOpponent'];
  liveAvailable: boolean;
  asyncPreview: 'ghost' | 'bot' | null;
}): { headline: string; detail: string; tone: 'action' | 'wait' | 'settled' } {
  const { fixture, opponent, liveAvailable, asyncPreview } = input;
  if (!fixture || !opponent) {
    return {
      headline: 'No match to settle today',
      detail: 'Check the table, track your rivals, and come back for the next matchday.',
      tone: 'wait',
    };
  }

  if (fixture.status === 'scheduled') {
    if (opponent.memberType === 'bot') {
      return {
        headline: 'Play your league match now',
        detail: 'Beat the scheduled bot to bank points in the table today.',
        tone: 'action',
      };
    }
    if (liveAvailable) {
      return {
        headline: 'Opponent is online — settle this live now',
        detail: 'A live head-to-head gives the match a final result immediately.',
        tone: 'action',
      };
    }
    return {
      headline: 'Play async now',
      detail: asyncPreview === 'ghost'
        ? 'Their ghost can represent the match now, and the result will count right away.'
        : 'Use the async stand-in now. A live match can still settle it later.',
      tone: 'action',
    };
  }

  if (fixture.status === 'provisional') {
    if (opponent.memberType === 'bot') {
      return {
        headline: 'This match is settled',
        detail: 'Result is final. No further action for this match.',
        tone: 'settled',
      };
    }
    if (liveAvailable) {
      return {
        headline: 'Your async result is in — settle it live now',
        detail: 'The table has already moved, but a live result will decide this match for real.',
        tone: 'action',
      };
    }
    return {
      headline: 'This match is still open',
      detail: 'The table has changed. A live match can still settle it later.',
      tone: 'wait',
    };
  }

  return {
    headline: 'This match is settled',
    detail: 'You’re done for today. Check the table and prepare for the next match.',
    tone: 'settled',
  };
}

export default function LeagueScreen({ user, profile, onBack, onOpenLiveMatch }: LeagueScreenProps) {
  const [stage, setStage] = useState<Stage>('hub');
  const [helpOpen, setHelpOpen] = useState(false);
  const [state, setState] = useState<LeaguePlayerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [history, setHistory] = useState<LeagueHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [postMatch, setPostMatch] = useState<PostMatchState | null>(null);
  const [matchMode, setMatchMode] = useState<'ghost' | 'bot'>('bot');
  const [ghostProfile, setGhostProfile] = useState<GhostProfileSummary | null>(null);
  const [asyncModeLoading, setAsyncModeLoading] = useState(false);
  const [asyncModePreview, setAsyncModePreview] = useState<'ghost' | 'bot' | null>(null);

  const loadState = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const next = await ensureLeagueReady(user.id);
      setState(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load league.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const openHistory = useCallback(async () => {
    if (!user) return;
    setHistoryLoading(true);
    try {
      const next = await fetchLeagueHistory(user.id);
      setHistory(next);
      setStage('history');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load season history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelpOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [helpOpen]);

  useEffect(() => {
    if (!state?.todaysOpponent) {
      setAsyncModePreview(null);
      setGhostProfile(null);
      return;
    }

    const opponentMember =
      state.members.find((member) => member.id === state.todaysOpponent?.memberId) ?? null;
    if (!opponentMember || opponentMember.member_type === 'bot' || !opponentMember.player_user_id) {
      setAsyncModePreview('bot');
      setGhostProfile(null);
      return;
    }

    let active = true;
    setAsyncModeLoading(true);
    void fetchGhostProfileSummary(opponentMember.player_user_id)
      .then((summary) => {
        if (!active) return;
        const confidence = summary.styleProfile?.confidence ?? 0;
        setGhostProfile(summary);
        setAsyncModePreview(confidence >= 0.5 ? 'ghost' : 'bot');
      })
      .catch(() => {
        if (!active) return;
        setGhostProfile(null);
        setAsyncModePreview('bot');
      })
      .finally(() => {
        if (!active) return;
        setAsyncModeLoading(false);
      });

    return () => {
      active = false;
    };
  }, [state?.todaysOpponent, state?.members]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!state?.todaysFixture || stage !== 'hub') return;
    try {
      const raw = window.sessionStorage.getItem(LEAGUE_MATCH_META_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        resumeKey?: string;
        mode?: 'ghost' | 'bot';
        ghostProfile?: GhostProfileSummary | null;
      };
      if (parsed.resumeKey !== state.todaysFixture.id) return;
      if (state.todaysFixture.status !== 'scheduled' && state.todaysFixture.status !== 'provisional') {
        window.sessionStorage.removeItem(LEAGUE_MATCH_META_KEY);
        window.sessionStorage.removeItem(`racehorse:league-match:${state.todaysFixture.id}`);
        return;
      }
      setMatchMode(parsed.mode === 'ghost' ? 'ghost' : 'bot');
      setGhostProfile(parsed.ghostProfile ?? null);
      setStage('match');
    } catch {
      window.sessionStorage.removeItem(LEAGUE_MATCH_META_KEY);
    }
  }, [stage, state?.todaysFixture]);

  const derived = useMemo(() => {
    if (!state) return null;
    const memberById = new Map(state.members.map((member) => [member.id, member]));
    const completed = state.fullSchedule
      .filter((fixture) => fixture.status !== 'scheduled' && fixture.home_score !== null && fixture.away_score !== null)
      .sort((a, b) => a.matchday - b.matchday || a.scheduled_date.localeCompare(b.scheduled_date));

    const formByMember = new Map<string, ResultCode[]>();
    for (const fixture of completed) {
      const homeCode = resultCodeForFixture(fixture, fixture.home_member_id);
      const awayCode = resultCodeForFixture(fixture, fixture.away_member_id);
      if (homeCode) formByMember.set(fixture.home_member_id, [...(formByMember.get(fixture.home_member_id) ?? []), homeCode]);
      if (awayCode) formByMember.set(fixture.away_member_id, [...(formByMember.get(fixture.away_member_id) ?? []), awayCode]);
    }

    const yourRecent: FixtureSummary[] = [];
    const processed: FixtureRecord[] = [];
    let previousPosition: number | null = null;
    for (const fixture of completed) {
      const involvesYou = fixture.home_member_id === state.you.id || fixture.away_member_id === state.you.id;
      const before = previousPosition;
      processed.push(fixture);
      const standings = computeStandings(state.members, processed);
      const current = standings.find((row) => row.memberId === state.you.id)?.position ?? null;
      if (involvesYou) {
        const opponentId = fixture.home_member_id === state.you.id ? fixture.away_member_id : fixture.home_member_id;
        const opponent = memberById.get(opponentId);
        const code = resultCodeForFixture(fixture, state.you.id);
        if (opponent && code) {
          const scores = fixtureScoresForMember(fixture, state.you.id);
          yourRecent.push({
            fixtureId: fixture.id,
            matchday: fixture.matchday,
            opponentName: opponent.display_name,
            result: resultChip(code),
            scoreLabel: `${scores.your}-${scores.opp}`,
            pointsGained: code === 'W' ? 3 : code === 'D' ? 1 : 0,
            positionChange:
              before !== null && current !== null
                ? before - current
                : null,
            impactLabel: describeRecentImpact(current, before),
          });
        }
      }
      previousPosition = current;
    }

    const totalMatchdays = Math.max(...state.fullSchedule.map((fixture) => fixture.matchday), 1);
    const currentMatchday =
      state.todaysFixture?.matchday ??
      state.fullSchedule.find((fixture) => fixture.status === 'scheduled')?.matchday ??
      totalMatchdays;
    const currentPosition = state.standings.find((row) => row.memberId === state.you.id)?.position ?? null;
    const zone = zoneStatus(currentPosition);
    const stakes = describeStakes(state.standings, state.you.id);
    const realPlayers = state.members.filter((member) => member.member_type === 'player').length;
    const botPlayers = state.members.filter((member) => member.member_type === 'bot').length;

    const opponent = state.todaysOpponent;
    let opponentForm: ResultCode[] = [];
    let headToHead = { wins: 0, draws: 0, losses: 0 };
    let lastMeetingCode: ResultCode | null = null;
    if (opponent) {
      opponentForm = (formByMember.get(opponent.memberId) ?? []).slice(-3).reverse();
      for (const fixture of completed) {
        const involvesBoth =
          (fixture.home_member_id === state.you.id && fixture.away_member_id === opponent.memberId) ||
          (fixture.away_member_id === state.you.id && fixture.home_member_id === opponent.memberId);
        if (!involvesBoth) continue;
        const code = resultCodeForFixture(fixture, state.you.id);
        if (code === 'W') headToHead.wins += 1;
        else if (code === 'L') headToHead.losses += 1;
        else if (code === 'D') headToHead.draws += 1;
        lastMeetingCode = code;
      }
    }

    const nextFixture = state.fullSchedule.find((fixture) => {
      if (fixture.status !== 'scheduled') return false;
      if (state.todaysFixture && fixture.id === state.todaysFixture.id) return false;
      return fixture.home_member_id === state.you.id || fixture.away_member_id === state.you.id;
    }) ?? null;

    const contextStandings = state.standings.filter((row) => {
      if (currentPosition === null) return false;
      return Math.abs(row.position - currentPosition) <= 1;
    });

    const opponentStanding = opponent ? state.standings.find((row) => row.memberId === opponent.memberId) ?? null : null;
    const rivalryNote = opponent
      ? headToHead.wins + headToHead.draws + headToHead.losses > 0
        ? lastMeetingCode === 'L'
          ? `Rematch. You lost the last meeting with ${opponent.displayName}.`
          : lastMeetingCode === 'W'
            ? `Rematch. You won the last meeting with ${opponent.displayName}.`
            : `Rematch. The last meeting with ${opponent.displayName} ended level.`
        : opponentStanding && currentPosition !== null
          ? opponentStanding.position < currentPosition
            ? `${opponent.displayName} is above you in the table. Beating them would matter.`
            : opponentStanding.position > currentPosition
              ? `${opponent.displayName} is below you in the table. Protect your edge.`
              : `${opponent.displayName} is level with you in the standings.`
          : 'Today’s opponent can shift the table right away.'
      : null;

  const habitHook =
      state.todaysFixture && opponent
        ? state.todaysFixture.status === 'scheduled'
          ? 'You have one league match to settle today.'
          : state.todaysFixture.status === 'provisional'
            ? opponent.memberType === 'bot'
              ? 'Today’s match is complete.'
              : 'Your async result is in, but the match is still open.'
            : 'Today’s match is settled. Track the table and prepare for the next one.'
        : state.isByeDay
          ? 'No match today — check the table and return tomorrow.'
          : 'Your next league match will appear here as the schedule settles.';

    return {
      memberById,
      formByMember,
      yourRecent: yourRecent.slice(-5).reverse(),
      currentMatchday,
      totalMatchdays,
      zone,
      currentPosition,
      realPlayers,
      botPlayers,
      stakes,
      opponentForm,
      headToHead,
      lastMeetingCode,
      rivalryNote,
      habitHook,
      nextFixture,
      contextStandings,
    };
  }, [state]);

  const seasonEndsIn = state ? daysUntil(state.league.week_end) : 0;
  const todaysOpponentName = state?.todaysOpponent?.displayName ?? 'Opponent';
  const todaysFixtureMeta = state?.todaysFixture ? state.fixtureResolutionById[state.todaysFixture.id] : null;
  const liveWindowStatus = getPstWindowStatus();
  const fixtureTypeLabel = classifyOpponentType(state?.todaysFixture ?? null, state?.todaysOpponent ?? null, todaysFixtureMeta ?? null);
  const liveAvailable = Boolean(
    state?.todaysFixture &&
      state.todaysOpponent?.memberType === 'player' &&
      state.todaysOpponent.online &&
      state.todaysFixture.status !== 'completed' &&
      state.todaysFixture.status !== 'forfeit',
  );
  const nextAction = buildNextActionMessage({
    fixture: state?.todaysFixture ?? null,
    opponent: state?.todaysOpponent ?? null,
    liveAvailable,
    asyncPreview: asyncModePreview,
  });

  const launchAsyncMatch = useCallback(() => {
    if (!state?.todaysFixture || !state.todaysOpponent) return;
    setMatchMode(asyncModePreview === 'ghost' ? 'ghost' : 'bot');
    setStage('match');
  }, [asyncModePreview, state]);

  const launchLiveMatch = useCallback(async () => {
    if (!state?.todaysFixture || !state.todaysOpponent || !state.todaysOpponent.online) return;
    try {
      const live = await openLeagueLiveRoom(state.todaysFixture.id);
      await onOpenLiveMatch(live.roomCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open live room.');
    }
  }, [onOpenLiveMatch, state]);

  const handleMatchComplete = useCallback(
    async (result: { winner: 'you' | 'bot' | null; yourScore: number; botScore: number }) => {
      if (!state?.todaysFixture || !state.todaysOpponent) return;
      setReporting(true);
      try {
        const youAreHome = state.todaysFixture.home_member_id === state.you.id;
        const recorded = await reportLeagueResult({
          fixtureId: state.todaysFixture.id,
          homeScore: youAreHome ? result.yourScore : result.botScore,
          awayScore: youAreHome ? result.botScore : result.yourScore,
          mode: matchMode,
          playerMemberId: state.you.id,
          opponentMemberId: state.todaysOpponent.memberId,
        });
        const previousPosition = state.standings.find((row) => row.memberId === state.you.id)?.position ?? null;
        const nextPosition = recorded.standings.find((row) => row.memberId === state.you.id)?.position ?? null;
        const updatedFixture = recorded.fixture ?? state.todaysFixture;
        setState((prev) =>
          prev
            ? {
                ...prev,
                standings: recorded.standings,
                todaysFixture: updatedFixture,
                recentResults: [
                  updatedFixture,
                  ...prev.recentResults.filter((fixture) => fixture.id !== updatedFixture.id),
                ].slice(0, 3),
                fullSchedule: prev.fullSchedule.map((fixture) => (fixture.id === updatedFixture.id ? updatedFixture : fixture)),
                fixtureResolutionById: {
                  ...prev.fixtureResolutionById,
                  [updatedFixture.id]: {
                    effectiveStatus: updatedFixture.status,
                    effectiveMode: matchMode,
                    asyncAttempts: (prev.fixtureResolutionById[updatedFixture.id]?.asyncAttempts ?? 0) + 1,
                    liveAttempts: prev.fixtureResolutionById[updatedFixture.id]?.liveAttempts ?? 0,
                    liveCanOverride: updatedFixture.status === 'provisional',
                    liveRoomCode: updatedFixture.live_room_code ?? null,
                    liveRoomOpenedAt: updatedFixture.live_room_opened_at ?? null,
                  },
                },
              }
            : prev,
        );
        setPostMatch({
          ...result,
          standings: recorded.standings,
          previousPosition,
          currentPosition: nextPosition,
          isProvisional: updatedFixture.status === 'provisional',
          canLiveOverride: updatedFixture.status === 'provisional',
          isCanonicalProvisional: recorded.isCanonicalProvisional !== false,
        });
        setStage('post');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record league result.');
        setStage('hub');
      } finally {
        setReporting(false);
      }
    },
    [matchMode, state],
  );

  if (!user) {
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league mode-auth-gate-screen" title="Sign In Required" subtitle="League Mode is tied to your account and season progression." contentClassName="mode-auth-gate-content">
        <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
      </LayoutScreen>
    );
  }

  if (loading) {
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league" title="Loading League" subtitle="Building your table and today’s fixture." contentClassName="" />
    );
  }

  if (error || !state || !derived) {
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league" title="League Unavailable" subtitle="Unable to load your current season." contentClassName="">
        {error ? <p className="auth-inline-error">{error}</p> : null}
        <div className="league-actions-inline">
          <button className="mode-inline-btn" onClick={() => void loadState()}>Retry</button>
          <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
        </div>
      </LayoutScreen>
    );
  }

  if (stage === 'history' && history) {
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league league-screen" title="League History" subtitle="Career performance across completed seasons." contentClassName="">
        <LeagueHistoryScreen history={history} onBack={() => setStage('hub')} />
      </LayoutScreen>
    );
  }

  if (stage === 'match' && state.todaysFixture && state.todaysOpponent) {
    return (
      <BotMatchScreen
        onBack={() => setStage('hub')}
        dealSize={7}
        winningScore={30}
        mode={matchMode}
        opponentName={state.todaysOpponent.displayName}
        ghostProfile={matchMode === 'ghost' ? ghostProfile : null}
        resumeKey={state.todaysFixture.id}
        onMatchComplete={(result) => void handleMatchComplete(result)}
      />
    );
  }

  if (stage === 'pre' && state.todaysOpponent) {
    const opponentStanding = state.standings.find((row) => row.memberId === state.todaysOpponent?.memberId) ?? null;
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league league-screen" title={state.todaysOpponent.displayName} subtitle="One match today. First to 30 wins the points." contentClassName="">
        <div className={`league-opponent-card ${state.todaysOpponent.isFritz ? 'is-fritz' : ''}`}>
          <div className="league-opponent-hero">
            <div>
              <p className="league-opponent-name">{state.todaysOpponent.displayName}</p>
              <div className="league-opponent-position-badge">Position {ordinal(state.todaysOpponent.currentPosition)}</div>
            </div>
            <div className="league-form-strip">
              {derived.opponentForm.length > 0 ? derived.opponentForm.map((code, index) => (
                <span key={`${code}-${index}`} className={`league-form-dot is-${code === 'W' ? 'win' : code === 'L' ? 'loss' : 'draw'}`}>{code}</span>
              )) : <span className="league-form-empty">No recent form</span>}
            </div>
          </div>
          <div className="league-opponent-bubble">
            {state.todaysOpponent.personality ? `“${state.todaysOpponent.personality}”` : 'A rival from your division.'}
          </div>
          <div className="league-opponent-grid">
            <div><span>Record</span><strong>{state.todaysOpponent.record ? `${state.todaysOpponent.record.wins}W ${state.todaysOpponent.record.draws}D ${state.todaysOpponent.record.losses}L` : '0W 0D 0L'}</strong></div>
            <div><span>League Points</span><strong>{opponentStanding?.leaguePoints ?? 0}</strong></div>
            <div><span>Position</span><strong>{ordinal(state.todaysOpponent.currentPosition)}</strong></div>
            <div><span>Head to Head</span><strong>{derived.headToHead.wins}-{derived.headToHead.draws}-{derived.headToHead.losses}</strong></div>
          </div>
          <p className="league-fixture-result">
            {asyncModeLoading
              ? 'Checking async opponent mode…'
              : asyncModePreview === 'ghost'
                ? 'Async play uses the opponent ghost.'
                : state.todaysOpponent.memberType === 'player'
                  ? 'Ghost confidence is low, so async play uses a bot stand-in.'
                  : 'Async play uses the scheduled bot opponent.'}
          </p>
          {state.todaysOpponent.memberType === 'player' ? (
            <p className="league-fixture-result">
              Opponent is currently {state.todaysOpponent.online ? 'online' : 'offline'}.
            </p>
          ) : null}
          {state.todaysOpponent.memberType === 'player' ? (
            <p className="league-fixture-result">{liveWindowStatus.label}</p>
          ) : null}
          <div className="league-actions-inline">
            <button className="mode-option mode-option-primary mode-accent-league league-play-now league-play-now-large" onClick={launchAsyncMatch} disabled={reporting || asyncModeLoading}>
              <span className="mode-option-title">Play Async Match</span>
              <span className="mode-option-meta">
                {asyncModePreview === 'ghost' ? 'Opponent ghost will represent this match.' : 'Bot fallback will represent this match.'}
              </span>
            </button>
            {state.todaysOpponent.memberType === 'player' && state.todaysOpponent.online ? (
              <button className="mode-inline-btn" onClick={() => void launchLiveMatch()}>
                Play Live
              </button>
            ) : null}
            <button className="mode-inline-btn" onClick={() => setStage('hub')}>View Table</button>
          </div>
        </div>
      </LayoutScreen>
    );
  }

  if (stage === 'post' && postMatch) {
    const moved = postMatch.previousPosition !== null && postMatch.currentPosition !== null
      ? postMatch.previousPosition - postMatch.currentPosition
      : 0;
    const postZone = zoneStatus(postMatch.currentPosition);
    const postImpact = describeRecentImpact(postMatch.currentPosition, postMatch.previousPosition);
    const miniTable = postMatch.standings.filter((row) => {
      if (postMatch.currentPosition === null) return false;
      return Math.abs(row.position - postMatch.currentPosition) <= 1;
    });
    return (
      <LayoutScreen className="screen mode-subpage-screen mode-accent-league league-screen" title={postMatch.winner === 'you' ? 'Full-Time Win' : postMatch.winner === 'bot' ? `${todaysOpponentName} Took It` : 'Points Shared'} subtitle={postMatch.isProvisional ? 'Table updated from the current provisional async result.' : 'Table updated from the final match result.'} contentClassName="">
        <div className="league-post-card league-post-card-rich">
          <div className="league-score-banner">
            <div className="league-scoreline is-big"><span>{profile?.username ? `@${profile.username}` : 'You'}</span><strong>{postMatch.yourScore}</strong></div>
            <div className="league-scoreline is-big"><span>{todaysOpponentName}</span><strong>{postMatch.botScore}</strong></div>
          </div>
          <div className={`league-points-badge ${postMatch.winner === 'you' ? 'is-win' : postMatch.winner === 'bot' ? 'is-loss' : 'is-draw'}`}>
            {postMatch.winner === 'you' ? '+3 WIN' : postMatch.winner === 'bot' ? '+0 LOSS' : '+1 DRAW'}
          </div>
          <div className="league-next-action-card is-settled">
            <strong>{postImpact}</strong>
              <span>
              {postMatch.isProvisional
                ? 'This result counts in the table now, but the match is still open.'
                : 'This match is settled. Your table position is now locked for today.'}
            </span>
          </div>
          {postMatch.isProvisional ? (
            <p className="league-post-summary">
              {state.todaysOpponent?.memberType === 'bot'
                ? 'This match is settled. Result is final for this match.'
                : postMatch.isCanonicalProvisional
                  ? 'Provisional result recorded. This match is still open.'
                  : 'Attempt stored. An earlier provisional result still counts unless a live match settles it.'}
            </p>
          ) : null}
          <p className="league-post-summary">
            {postMatch.previousPosition && postMatch.currentPosition
              ? moved > 0
                ? `↑ Moved from ${ordinal(postMatch.previousPosition)} to ${ordinal(postMatch.currentPosition)}`
                : moved < 0
                  ? `↓ Dropped from ${ordinal(postMatch.previousPosition)} to ${ordinal(postMatch.currentPosition)}`
                  : `— Stayed ${ordinal(postMatch.currentPosition)}`
              : 'Table movement pending.'}
          </p>
          <div className={`league-status-banner ${postZone.className}`}>
            <strong>{postZone.className === 'is-promo' ? 'Promotion Push' : postZone.className === 'is-relegation' ? 'Relegation Warning' : 'Mid-table Reset'}</strong>
            <span>{postZone.subcopy}</span>
          </div>
          <div className="league-mini-table">
            {miniTable.map((row) => (
              <div key={row.memberId} className={`league-mini-row ${row.memberId === state.you.id ? 'is-you' : ''}`}>
                <span>{row.position}</span>
                <span>{row.displayName}</span>
                <strong>{row.leaguePoints} pts</strong>
              </div>
            ))}
          </div>
          <div className="league-actions-inline">
            <button className="mode-inline-btn" onClick={() => setStage('hub')}>View Table</button>
            <button className="mode-inline-btn" onClick={onBack}>Done</button>
          </div>
        </div>
      </LayoutScreen>
    );
  }

  return (
    <LayoutScreen className="screen mode-subpage-screen mode-accent-league league-screen" title={`Division ${state.league.division}`} subtitle={`Season ends in ${seasonEndsIn} day${seasonEndsIn === 1 ? '' : 's'}`} contentClassName="">
      <div className="league-help-corner">
        <button
          type="button"
          className="league-help-trigger"
          onClick={() => setHelpOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={helpOpen}
          aria-controls="league-help-modal"
        >
          <span className="league-help-trigger-mark">?</span>
          <span>How League Mode works</span>
        </button>
      </div>
      <p className="league-header-note">
        Live matches available daily at 8PM PST if both players are online.
      </p>
      <div className="league-hub">
        <div className="league-main-column">
          <div className="league-members-summary">
            {derived.realPlayers} real players · {derived.botPlayers} bots
          </div>
          <div className={`league-live-banner is-${nextAction.tone}`}>
            <strong>{derived.habitHook}</strong>
            <span>{nextAction.headline}</span>
          </div>
          <div className="league-rules-card">
            <div>
              <p className="league-card-label">How This Division Works</p>
              <strong>Division {state.league.division} of {TOTAL_DIVISIONS}</strong>
            </div>
            <span>Top {PROMOTION_SLOTS} promoted · Bottom {RELEGATION_SLOTS} relegated · {derived.totalMatchdays} matchdays</span>
          </div>
          {state.newRealPlayerJoined ? (
            <div className="league-live-banner">A new player just joined your division!</div>
          ) : null}
          <div className={`league-status-banner ${derived.zone.className}`}>
            <strong>{derived.zone.className === 'is-promo' ? 'Promotion Zone' : derived.zone.className === 'is-relegation' ? 'Relegation Zone' : 'Mid-table'}</strong>
            <span>{derived.zone.subcopy}</span>
          </div>
          <div className={`league-stakes-card is-${derived.stakes.tone}`}>
            <div>
              <p className="league-card-label">What’s At Stake Today</p>
              <h3>{derived.stakes.headline}</h3>
            </div>
            <p className="league-fixture-result">{derived.stakes.detail}</p>
          </div>

          <div className="league-progress-card">
            <div className="league-progress-head">
              <div>
                <p className="league-card-label">Season Progress</p>
                <h3>Matchday {derived.currentMatchday} of {derived.totalMatchdays}</h3>
              </div>
              <span>{seasonEndsIn} day{seasonEndsIn === 1 ? '' : 's'} left</span>
            </div>
            <div className="league-progress-bar"><div style={{ width: `${(derived.currentMatchday / derived.totalMatchdays) * 100}%` }} /></div>
            <p className="league-fixture-result">Each match counts once in the standings. Async results count immediately, but a live head-to-head can still settle the match if it is only provisional.</p>
          </div>

          <div className="league-fixture-card league-fixture-card-primary">
            <div className="league-fixture-header">
              <p className="league-card-label">Today’s Match</p>
              {state.todaysFixture && state.todaysOpponent ? (
                <h3>{state.todaysOpponent.displayName}</h3>
              ) : state.isByeDay ? (
                <h3>Rest Day</h3>
              ) : (
                <h3>No Match Yet</h3>
              )}
              {state.todaysFixture && state.todaysOpponent ? (
                <div className="league-fixture-state-row">
                  <span className={`league-result-badge ${
                    state.todaysFixture.status === 'scheduled'
                      ? 'is-ready'
                      : state.todaysFixture.status === 'provisional' && state.todaysOpponent.memberType === 'bot'
                        ? 'is-win'
                        : state.todaysFixture.status === 'provisional'
                          ? 'is-draw'
                          : state.todaysFixture.status === 'completed'
                            ? 'is-win'
                            : 'is-loss'
                  }`}>
                    {state.todaysFixture.status === 'scheduled'
                      ? 'Ready'
                      : state.todaysFixture.status === 'provisional' && state.todaysOpponent.memberType === 'bot'
                        ? 'Final'
                        : state.todaysFixture.status === 'provisional'
                          ? 'Provisional'
                          : state.todaysFixture.status === 'completed'
                            ? 'Final'
                            : 'Forfeit'}
                  </span>
                  <span className="league-fixture-type">{fixtureTypeLabel}</span>
                </div>
              ) : null}
            </div>
            {state.todaysFixture && state.todaysOpponent ? (
              <>
                <div className={`league-next-action-card is-${nextAction.tone}`}>
                  <strong>{nextAction.headline}</strong>
                  <span>{nextAction.detail}</span>
                </div>
                {derived.rivalryNote ? (
                  <p className="league-fixture-rivalry">{derived.rivalryNote}</p>
                ) : null}
                {state.todaysFixture.status === 'scheduled' ? (
                  <>
                    <div className="league-match-meta-row">
                      <span>Position {ordinal(state.todaysOpponent.currentPosition)}</span>
                      <span>H2H {derived.headToHead.wins}-{derived.headToHead.draws}-{derived.headToHead.losses}</span>
                    </div>
                    <div className="league-form-strip">
                      {derived.opponentForm.length > 0 ? derived.opponentForm.map((code, index) => (
                        <span key={`${code}-${index}`} className={`league-form-dot is-${code === 'W' ? 'win' : code === 'L' ? 'loss' : 'draw'}`}>{code}</span>
                      )) : <span className="league-form-empty">No recent form</span>}
                    </div>
                    <div className="league-callout-grid">
                      <div className="league-callout">
                        <span>Async</span>
                        <strong>
                          {asyncModeLoading
                            ? 'Checking…'
                            : asyncModePreview === 'ghost'
                              ? 'Opponent ghost will play this fixture'
                              : state.todaysOpponent.memberType === 'player'
                                ? 'Bot stand-in will cover async play'
                                : 'Play the scheduled bot now'}
                        </strong>
                      </div>
                      <div className="league-callout">
                        <span>Live</span>
                        <strong>
                          {state.todaysOpponent.memberType === 'player'
                            ? state.todaysOpponent.online
                              ? 'Available now'
                              : 'Waiting for opponent to come online'
                            : 'Not needed for bot matches'}
                        </strong>
                      </div>
                    </div>
                    <button className="mode-option mode-option-primary mode-accent-league league-play-now league-play-now-large" onClick={() => setStage('pre')}>
                      <span className="mode-option-title">{state.todaysOpponent.memberType === 'player' ? 'Play Async Match' : 'Play Match'}</span>
                      <span className="mode-option-meta">
                        {asyncModeLoading
                          ? 'Checking async opponent mode…'
                          : asyncModePreview === 'ghost'
                            ? 'Records a provisional result right away'
                            : state.todaysOpponent.memberType === 'player'
                              ? 'Records a provisional stand-in result right away'
                              : 'Settles the bot match right away'}
                      </span>
                    </button>
                    {state.todaysOpponent.memberType === 'player' ? (
                      <p className="league-fixture-result">
                        Opponent is currently {state.todaysOpponent.online ? 'online — you can play live or async' : 'offline — async play is the fastest path'}.
                      </p>
                    ) : null}
                    {state.todaysOpponent.memberType === 'player' ? (
                      <p className="league-fixture-result">{liveWindowStatus.label}</p>
                    ) : null}
                    {liveAvailable ? (
                      <button className="mode-inline-btn" onClick={() => void launchLiveMatch()}>
                        Play Live Match
                      </button>
                    ) : null}
                  </>
                ) : (
                  (() => {
                    const code = resultCodeForFixture(state.todaysFixture, state.you.id) ?? 'D';
                    const chip = resultChip(code);
                    const scores = fixtureScoresForMember(state.todaysFixture, state.you.id);
                    const points = code === 'W' ? 3 : code === 'D' ? 1 : 0;
                    return (
                      <div className="league-fixture-completed">
                        <span className={`league-result-badge ${chip.className}`}>{chip.label}</span>
                        <strong className="league-fixture-score">{scores.your} - {scores.opp}</strong>
                        <p className="league-fixture-result">{points > 0 ? `+${points}` : '0'} pts earned</p>
                        {todaysFixtureMeta?.effectiveStatus === 'provisional' ? (
                          state.todaysOpponent.memberType === 'bot' ? (
                            <>
                              <p className="league-fixture-result">This match is settled. Result is final for this match.</p>
                            </>
                          ) : (
                            <>
                              <p className="league-fixture-result">Provisional result recorded. The table moved, but this match is still open.</p>
                              {state.todaysOpponent.memberType === 'player' ? (
                                <p className="league-fixture-result">
                                  {state.todaysOpponent.online
                                    ? 'Opponent is online — settle it now. A live head-to-head decides the final result.'
                                    : 'Opponent is offline. This match stays open until you settle it live or the season closes.'}
                                </p>
                              ) : null}
                              {state.todaysOpponent.memberType === 'player' ? (
                                <p className="league-fixture-result">{liveWindowStatus.label}</p>
                              ) : null}
                              {liveAvailable ? (
                                <button
                                  className="mode-option mode-option-primary mode-accent-league league-play-now league-play-now-large"
                                  onClick={() => void launchLiveMatch()}
                                >
                                  <span className="mode-option-title">Play Live Match</span>
                                  <span className="mode-option-meta">Settle it head-to-head. Live decides the final result.</span>
                                </button>
                              ) : null}
                            </>
                          )
                        ) : state.todaysFixture.status === 'completed' ? (
                          <p className="league-fixture-result">
                            {todaysFixtureMeta?.effectiveMode === 'live'
                              ? 'Final live result recorded. This match is settled.'
                              : state.todaysOpponent.memberType === 'bot'
                                ? 'Bot match complete. This match is settled.'
                                : 'Final result recorded. This match is settled.'}
                          </p>
                        ) : null}
                        <p className="league-fixture-result">
                          {derived.nextFixture
                            ? `Next match: ${derived.memberById.get(derived.nextFixture.home_member_id === state.you.id ? derived.nextFixture.away_member_id : derived.nextFixture.home_member_id)?.display_name ?? 'Opponent'} — tomorrow`
                            : 'This match is settled — check back for the next one.'}
                        </p>
                      </div>
                    );
                  })()
                )}
                {derived.nextFixture ? (
                  <p className="league-next-fixture">
                    Next up: {derived.memberById.get(derived.nextFixture.home_member_id === state.you.id ? derived.nextFixture.away_member_id : derived.nextFixture.home_member_id)?.display_name ?? 'Opponent'} — MD{derived.nextFixture.matchday}
                  </p>
                ) : null}
              </>
              ) : state.isByeDay ? (
                <>
                <p className="league-fixture-result">No counted match today. The table still matters, and your next matchday is already on the schedule.</p>
              </>
            ) : (
              <>
                <p className="league-fixture-result">Season schedule is still settling. Your match list will appear here as soon as today’s matchup is ready.</p>
              </>
            )}
          </div>

          <div className="league-table-card">
            <div className="league-table-head">
              <span>#</span>
              <span>Player</span>
              <span>Form</span>
              <span>W-D-L</span>
              <span>Point Diff</span>
              <span>Pts</span>
            </div>
            {state.standings.map((row) => {
              const isYou = row.memberId === state.you.id;
              const member = state.members.find((entry) => entry.id === row.memberId) ?? null;
              const isFritz = Boolean(state.memberMeta[row.memberId]?.isFritz);
              const zoneClass = row.position <= 2 ? 'is-promo' : row.position >= 6 ? 'is-relegation' : 'is-mid';
              const form = (derived.formByMember.get(row.memberId) ?? []).slice(-5).reverse();
              const personality = truncateText(state.memberMeta[row.memberId]?.personality ?? null, 40);
              return (
                <div key={row.memberId} className={`league-table-row ${zoneClass} ${isYou ? 'is-you' : ''} ${isFritz ? 'is-fritz' : ''}`}>
                  <span>{row.position}</span>
                  <span className="league-player-cell">
                    <span className="league-player-primary">
                      {member?.member_type === 'player' ? <i className="league-player-real-dot" aria-hidden="true" /> : null}
                      {row.displayName}
                      {member?.member_type === 'bot' ? <em className="league-player-bot-tag">BOT</em> : null}
                      {isYou ? ' ← You' : ''}
                    </span>
                    {member?.member_type === 'bot' && personality ? (
                      <span className="league-player-subtitle">{personality}</span>
                    ) : null}
                  </span>
                  <span className="league-table-form">
                    {form.length > 0 ? form.map((code, index) => (
                      <i key={`${row.memberId}-${index}`} className={`league-form-dot is-${code === 'W' ? 'win' : code === 'L' ? 'loss' : 'draw'}`} />
                    )) : <span className="league-form-empty">—</span>}
                  </span>
                  <span>{row.wins}-{row.draws}-{row.losses}</span>
                  <span>{row.pointsDiff >= 0 ? `+${row.pointsDiff}` : row.pointsDiff}</span>
                  <span>{row.leaguePoints}</span>
                </div>
              );
            })}
            <div className="league-zone-legend">▲ Promotion Zone&nbsp;&nbsp;&nbsp;▼ Relegation Zone</div>
          </div>
          <div className="league-recent-card">
            <div className="league-card-head">
              <p className="league-card-label">Recent Results</p>
              <button className="mode-inline-btn" onClick={() => void openHistory()} disabled={historyLoading}>
                {historyLoading ? 'Loading…' : 'Season History'}
              </button>
            </div>
            <p className="league-fixture-result">Your activity feed: scorelines, points earned, and what each match did to your season.</p>
            {derived.yourRecent.length === 0 ? (
              <p className="league-fixture-result">No completed matches yet this season.</p>
            ) : (
              <div className="league-recent-list">
                {derived.yourRecent.map((item) => (
                  <div key={item.fixtureId} className="league-recent-item">
                    <span className={`league-result-badge ${item.result.className}`}>{item.result.label}</span>
                    <div>
                      <strong>{item.opponentName}</strong>
                      <div className="league-recent-meta">{item.scoreLabel} • {item.pointsGained > 0 ? `+${item.pointsGained}` : '0'} pts</div>
                      <div className="league-recent-impact">{item.impactLabel}</div>
                    </div>
                    <span className="league-recent-move">
                      {item.positionChange === null ? '—' : item.positionChange > 0 ? `↑${item.positionChange}` : item.positionChange < 0 ? `↓${Math.abs(item.positionChange)}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="league-schedule-card">
            <summary>View Full Schedule</summary>
            <p className="league-fixture-result">One match per matchday. Rows are either unsettled, provisional, or final.</p>
            <div className="league-schedule-list">
              {state.fullSchedule
                .filter(
                  (fixture) =>
                    fixture.home_member_id === state.you.id || fixture.away_member_id === state.you.id,
                )
                .map((fixture) => {
                const opponentId = fixture.home_member_id === state.you.id ? fixture.away_member_id : fixture.home_member_id;
                const opponent = derived.memberById.get(opponentId);
                const scores = fixtureScoresForMember(fixture, state.you.id);
                return (
                  <div key={fixture.id} className="league-schedule-item">
                    <span>MD{fixture.matchday}</span>
                    <span>{formatDate(fixture.scheduled_date)}</span>
                    <span>{opponent ? opponent.display_name : fixture.status}</span>
                    <span>
                      {scores.your !== null && scores.opp !== null
                        ? `${scores.your}-${scores.opp} • ${fixture.status === 'provisional' ? 'provisional' : fixture.status === 'completed' ? 'final' : fixture.status}`
                        : fixture.status === 'scheduled'
                          ? 'unsettled'
                          : fixture.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="league-actions-inline">
            <button className="mode-inline-btn" onClick={() => void loadState()}>Refresh</button>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
      {helpOpen ? (
        <div className="league-help-overlay" onClick={() => setHelpOpen(false)}>
          <div
            id="league-help-modal"
            className="league-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="league-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="league-help-head">
              <div>
                <p className="league-card-label">League Help</p>
                <h3 id="league-help-title">How League Mode works</h3>
              </div>
              <button type="button" className="league-help-close" onClick={() => setHelpOpen(false)} aria-label="Close league help">
                ×
              </button>
            </div>
            <div className="league-help-grid">
              <section className="league-help-section">
                <h4>What it is</h4>
                <p>League Mode is a season table. You play one match at a time and try to finish as high as possible.</p>
              </section>
              <section className="league-help-section">
                <h4>Your goal</h4>
                <p>Win matches, earn points, and stay out of the bottom places. Top 2 go up. Bottom 2 go down.</p>
              </section>
              <section className="league-help-section">
                <h4>What to do each day</h4>
                <p>Check Today&apos;s Match and play your match. A good result can move you up the table fast.</p>
              </section>
              <section className="league-help-section">
                <h4>Async and live</h4>
                <p>Async lets you play right away. If a real opponent is online, live play can settle the match head-to-head.</p>
              </section>
              <section className="league-help-section">
                <h4>Provisional and final</h4>
                <p>Provisional means the result counts now. Final means the match is settled.</p>
              </section>
              <section className="league-help-section">
                <h4>What to watch</h4>
                <p>Today&apos;s Match tells you what to do now. The table shows where you stand. Season History shows how you&apos;ve finished before.</p>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </LayoutScreen>
  );
}
