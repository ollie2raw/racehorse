import { useCallback, useState } from 'react';
import type { AppMode } from '../types';
import TournamentReadyBanner from './TournamentReadyBanner';
import { readyBannerMode, selectReadyBannerMatch } from './readyBanner';
import type { MatchReadyEvent, TournamentAssignedPlayable } from './types';

/**
 * Wires the app-wide ready banner to tournament state (Phase 3D). One banner
 * per match id: a dismissal is remembered for that match only (a new match
 * id can show again). Nothing here joins on its own.
 */
export function TournamentReadyBannerHost(props: {
  enabled: boolean;
  activeAssignedMatch: TournamentAssignedPlayable | null;
  pendingMatch: MatchReadyEvent | null;
  pendingMatchAtMono: number;
  myRequestedAtMono: number;
  cancelledTournamentIds: ReadonlySet<string>;
  appMode: AppMode;
  tournamentSubView: 'hub' | 'bracket' | 'result' | 'history';
  activeTournamentId: string | null;
  joinedRoom: string | null;
  currentTournamentMatch: { tournamentId: string; matchId: string } | null;
  liveGameOver: boolean;
  joining: boolean;
  onJoin: (matchId: string) => void;
}) {
  const [dismissedMatchIds, setDismissedMatchIds] = useState<ReadonlySet<string>>(() => new Set());
  const dismiss = useCallback((matchId: string) => {
    setDismissedMatchIds((prev) => (prev.has(matchId) ? prev : new Set([...prev, matchId])));
  }, []);

  if (!props.enabled) return null;
  const match = selectReadyBannerMatch(props);
  const mode = readyBannerMode({ ...props, match, dismissedMatchIds });
  if (!match || mode === 'hidden') return null;
  return (
    <TournamentReadyBanner
      match={match}
      mode={mode}
      joining={props.joining}
      onJoin={props.onJoin}
      onDismiss={dismiss}
    />
  );
}
