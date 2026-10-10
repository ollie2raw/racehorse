import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import { fetchHistory } from './tournamentApi';
import { deriveHistoryRows } from './tournamentHistoryView';
import type { TournamentHistoryEntry } from './types';
import './tournamentHub.css';

export type HistoryLoad =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: TournamentHistoryEntry[] };

/** Loads /history once per visit; Retry reloads. A failure never touches the Hub. */
export function useTournamentHistory(load: () => Promise<TournamentHistoryEntry[]> = fetchHistory) {
  const [state, setState] = useState<HistoryLoad>({ status: 'loading' });
  const loadRef = useRef(load);
  const fetchInto = useCallback(() => {
    loadRef.current()
      .then((entries) => setState({ status: 'ready', entries }))
      .catch(() => setState({ status: 'error' }));
  }, []);
  // Starts in 'loading'; the first load needs no state change before it.
  useEffect(() => {
    fetchInto();
  }, [fetchInto]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    fetchInto();
  }, [fetchInto]);
  return { state, retry };
}

export interface TournamentHistoryScreenProps {
  history: HistoryLoad;
  /** Fritz Cups are offered (the empty state only mentions what exists). */
  fritzCupEnabled: boolean;
  timeZone?: string;
  onRetry: () => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

/**
 * Tournament history (Phase 3E): one card per finished tournament — Fritz Cup
 * or Live Event, when (local time), how far the player got, and an unusual
 * ending only when there was one. Long lists scroll inside the panel.
 */
export default function TournamentHistoryScreen(props: TournamentHistoryScreenProps) {
  const rows = useMemo(
    () => (props.history.status === 'ready' ? deriveHistoryRows(props.history.entries, { timeZone: props.timeZone }) : []),
    [props.history, props.timeZone],
  );

  return (
    <div className="th-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onSignOut={props.onSignOut}
        activeColor="var(--accent-amber)"
      />
      <div className="th-shell">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBack}>
            <span aria-hidden>←</span> Back to Tournaments
          </button>
        </div>
        <div className="th-history">
          <h1 className="th-title th-history__title">History</h1>
          <div className="th-history__list" aria-busy={props.history.status === 'loading'}>
            {props.history.status === 'loading' ? (
              <>
                <span className="th-sr-only" role="status">Loading tournament history…</span>
                <div className="th-event th-event--skeleton" aria-hidden />
                <div className="th-event th-event--skeleton" aria-hidden />
              </>
            ) : props.history.status === 'error' ? (
              <div className="th-state-card th-state-card--error" role="alert">
                <div className="th-state-card__text">
                  <strong>Couldn&apos;t load tournament history.</strong>
                  <span>Check your connection and try again.</span>
                </div>
                <button type="button" className="th-cta th-cta--ghost" onClick={props.onRetry}>Retry</button>
              </div>
            ) : rows.length === 0 ? (
              <div className="th-state-card" role="status">
                <div className="th-state-card__text">
                  <strong>No tournament results yet.</strong>
                  <span>
                    {props.fritzCupEnabled
                      ? 'Play a Fritz Cup or join a Live Event to get started.'
                      : 'Join a Live Event to get started.'}
                  </span>
                </div>
              </div>
            ) : (
              <ul className="th-history__rows" aria-label="Finished tournaments">
                {rows.map((row) => (
                  <li
                    key={row.tournamentId}
                    className={`th-event th-history__row${row.kindLabel === 'Fritz Cup' ? ' th-event--fritz' : ''}`}
                  >
                    <div className="th-event__head">
                      <span className="th-event__kicker">{row.kindLabel}</span>
                      <span className="th-history__when">{row.when}</span>
                    </div>
                    <div className="th-history__finish">
                      <strong>{row.finish}</strong>
                      {row.isChampion ? <span className="th-chip th-chip--ok">Won</span> : null}
                      {row.note ? <span className="th-chip th-chip--muted">{row.note}</span> : null}
                    </div>
                    {row.champion ? (
                      <p className="th-event__meta">
                        Champion: {row.champion.label}
                        {row.champion.badgeLabel ? <span className="th-history__fritz">{row.champion.badgeLabel}</span> : null}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
