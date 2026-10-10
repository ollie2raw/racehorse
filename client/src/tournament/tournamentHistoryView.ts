/**
 * Tournament history rows (Phase 3E): one per finished tournament, answering
 * which kind, when (the player's local time), how far they got, whether they
 * won, and — only when it matters — how their last match was decided. From
 * /history's fields and outcomeKind only (never status_reason).
 */
import { tournamentPlayerDisplay, type TournamentPlayerDisplay } from './displayNames';
import { formatEventTime } from './tournamentTime';
import type { TournamentHistoryEntry, TournamentOutcomeKind } from './types';

export type TournamentHistoryRow = {
  tournamentId: string;
  kindLabel: 'Fritz Cup' | 'Live Event';
  /** "Oct 9 · 8:00 PM" in the player's time zone. */
  when: string;
  /** Champion / Runner-up / Semifinal / Quarterfinal. */
  finish: string;
  isChampion: boolean;
  /** Who won, when it was not the player (a Fritz champion included). */
  champion: TournamentPlayerDisplay | null;
  /** How the player's last match was decided, only when not a played game. */
  note: string | null;
};

/** Canonical finish words from the placement rank (1, 2, 3, 5). */
export function historyFinishLabel(placement: number | null, placementLabel: string | null): string {
  if (placement === 1) return 'Champion';
  if (placement === 2) return 'Runner-up';
  if (placement === 3 || placement === 4) return 'Semifinal';
  if (placement != null && placement >= 5 && placement <= 8) return 'Quarterfinal';
  return placementLabel ?? 'Finished';
}

/** Unusual endings only, from the player's side. A played match needs no note. */
export function historyOutcomeNote(kind: TournamentOutcomeKind | null | undefined, won: boolean): string | null {
  switch (kind) {
    case 'forfeit': return won ? 'Opponent forfeited' : 'Forfeit';
    case 'missed_turns': return won ? 'Opponent missed turns' : 'Missed turns';
    case 'no_show': return won ? 'Opponent no-show' : 'No-show';
    case 'administrative': return won ? 'Advanced by rule' : 'Decided by rule';
    case 'bye': return 'Bye';
    default: return null;
  }
}

function dateLabel(iso: string, timeZone?: string, locale?: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const day = new Intl.DateTimeFormat(locale ?? 'en-US', { month: 'short', day: 'numeric', timeZone }).format(ms);
  return `${day} · ${formatEventTime(iso, { timeZone, locale })}`;
}

export function deriveHistoryRows(
  entries: TournamentHistoryEntry[],
  opts: { timeZone?: string; locale?: string } = {},
): TournamentHistoryRow[] {
  return entries.map((entry) => {
    const isChampion = entry.placement === 1;
    const last = entry.myLastMatch ?? null;
    const championDisplay = entry.championId
      ? tournamentPlayerDisplay(entry.championId, {
          username: entry.championName,
          botTier: entry.championFritzTier ?? null,
          round: 3,
        })
      : null;
    // The server names a Fritz champion ("Master Fritz"); keep its name.
    const champion = championDisplay?.isFritz && entry.championName ? { ...championDisplay, label: entry.championName } : championDisplay;
    return {
      tournamentId: entry.tournamentId,
      kindLabel: entry.kind === 'fritz_cup' ? 'Fritz Cup' : 'Live Event',
      when: dateLabel(entry.scheduledStart, opts.timeZone, opts.locale),
      finish: historyFinishLabel(entry.placement, entry.placementLabel),
      isChampion,
      champion: isChampion ? null : champion,
      note: last ? historyOutcomeNote(last.outcomeKind, last.won) : null,
    };
  });
}
