import { useEffect, useMemo } from 'react';
import { GlobalNav } from '../components';
import type { AppMode } from '../types';
import type { BracketView, Registration, TournamentMatch } from './types';
import './tournamentBracket.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentBracketScreenProps {
  identity: Identity;
  tournamentId: string;
  bracket: BracketView | null;
  onLoadBracket: (tournamentId: string) => void;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onAttachAssignedMatch: (matchId: string) => void;
}

function nameFor(userId: string | null, regs: Registration[]): string {
  if (!userId) return 'TBD';
  const reg = regs.find((r) => r.user_id === userId);
  return reg?.username ?? userId.slice(0, 6);
}

function MatchCard({
  match,
  regs,
  youUserId,
}: {
  match: TournamentMatch;
  regs: Registration[];
  youUserId: string | null;
}) {
  const isYours = Boolean(youUserId) && (match.player1_id === youUserId || match.player2_id === youUserId);
  const isBye = match.status === 'bye';
  return (
    <div className={`tb-match${isYours ? ' is-yours' : ''}${isBye ? ' is-bye' : ''}`}>
      <div className="tb-slot">
        <span className={`tb-slot__name${!match.player1_id ? ' tb-slot__name--tbd' : ''}`}>
          {match.player1_id ? nameFor(match.player1_id, regs) : 'TBD'}
        </span>
        <span className={`tb-slot__score${match.winner_id === match.player1_id && match.winner_id ? ' tb-slot__score--win' : ''}`}>
          {match.player1_score ?? '—'}
        </span>
      </div>
      <div className="tb-slot">
        <span className={`tb-slot__name${!match.player2_id ? ' tb-slot__name--tbd' : ''}`}>
          {match.player2_id ? nameFor(match.player2_id, regs) : 'TBD'}
        </span>
        <span className={`tb-slot__score${match.winner_id === match.player2_id && match.winner_id ? ' tb-slot__score--win' : ''}`}>
          {match.player2_score ?? '—'}
        </span>
      </div>
    </div>
  );
}

export default function TournamentBracketScreen(props: TournamentBracketScreenProps) {
  const userId = props.identity?.userId ?? null;
  const { onLoadBracket } = props;

  useEffect(() => {
    onLoadBracket(props.tournamentId);
  }, [props.tournamentId, onLoadBracket]);

  const bracket: BracketView | null =
    props.bracket?.tournament.id === props.tournamentId ? props.bracket : null;

  const yourReadyMatch = useMemo(() => {
    if (!bracket || !userId) return null;
    return (
      bracket.matches.find(
        (m) =>
          m.status === 'ready' && (m.player1_id === userId || m.player2_id === userId),
      ) ?? null
    );
  }, [bracket, userId]);

  const qf = bracket?.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number) ?? [];
  const sf = bracket?.matches.filter((m) => m.round === 2).sort((a, b) => a.match_number - b.match_number) ?? [];
  const fnl = bracket?.matches.filter((m) => m.round === 3) ?? [];
  const champion = fnl[0]?.winner_id ?? null;
  const championName = champion && bracket ? nameFor(champion, bracket.registrations) : null;

  return (
    <div className="tb-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        activeColor="var(--accent-amber)"
      />
      <div className="tb-shell">
        <div className="tb-toolbar">
          <button className="tb-back" onClick={props.onBack}>
            <span aria-hidden>←</span> Back to Tournament
          </button>
          <div className="tb-head">
            <div className="tb-kicker">Tournament</div>
            <h2 className="tb-title">Bracket</h2>
          </div>
        </div>

        {bracket ? (
          <div className="tb-bracket">
            <div className="tb-col">
              <span className="tb-col-label">Quarterfinals</span>
              {qf.map((m) => (
                <MatchCard key={m.id} match={m} regs={bracket.registrations} youUserId={userId} />
              ))}
            </div>
            <div className="tb-col">
              <span className="tb-col-label">Semifinals</span>
              {sf.map((m) => (
                <MatchCard key={m.id} match={m} regs={bracket.registrations} youUserId={userId} />
              ))}
            </div>
            <div className="tb-col">
              <span className="tb-col-label">Final</span>
              {fnl.map((m) => (
                <MatchCard key={m.id} match={m} regs={bracket.registrations} youUserId={userId} />
              ))}
            </div>
            <div className="tb-col">
              <span className="tb-col-label">Champion</span>
              <div className="tb-champion-card">
                <span className="tb-champion-label">Champion</span>
                <span className="tb-champion-name">{championName ?? '—'}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="tb-empty">Loading bracket…</p>
        )}

        {yourReadyMatch ? (
          <div className="tb-your-banner">
            <div className="tb-your-banner__meta">
              <span className="tb-your-banner__kicker">Your match is ready</span>
              <span className="tb-your-banner__heading">
                {yourReadyMatch.round === 1
                  ? 'Quarterfinal'
                  : yourReadyMatch.round === 2
                    ? 'Semifinal'
                    : 'Final'}
              </span>
            </div>
            <button
              className="tb-your-cta"
              onClick={() => props.onAttachAssignedMatch(yourReadyMatch.id)}
            >
              Join Match ›
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
