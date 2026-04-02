import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import BotMatchScreen from '../bot/BotMatchScreen';
import LayoutScreen from '../ui/LayoutScreen';
import { ensureLeagueReady, reportLeagueResult } from './api';
import type { FixtureRecord, LeaguePlayerState, LeagueStandingRow } from './types';
import './league.css';

interface LeagueScreenProps {
  user: User | null;
  profile: UserProfile | null;
  onBack: () => void;
}

type Stage = 'hub' | 'pre' | 'match' | 'post';

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

function fixtureResultLabel(fixture: FixtureRecord, youId: string): string {
  const youAreHome = fixture.home_member_id === youId;
  const yourScore = youAreHome ? fixture.home_score : fixture.away_score;
  const oppScore = youAreHome ? fixture.away_score : fixture.home_score;
  if (yourScore === null || oppScore === null) return 'Scheduled';
  if (yourScore > oppScore) return `Win ${yourScore}-${oppScore}`;
  if (yourScore < oppScore) return `Loss ${yourScore}-${oppScore}`;
  return `Draw ${yourScore}-${oppScore}`;
}

export default function LeagueScreen({ user, profile, onBack }: LeagueScreenProps) {
  const [stage, setStage] = useState<Stage>('hub');
  const [state, setState] = useState<LeaguePlayerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [postMatch, setPostMatch] = useState<{
    yourScore: number;
    botScore: number;
    winner: 'you' | 'bot' | null;
    standings: LeagueStandingRow[];
    previousPosition: number | null;
    currentPosition: number | null;
  } | null>(null);

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

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const currentPosition = useMemo(
    () => state?.standings.find((row) => row.memberId === state.you.id)?.position ?? null,
    [state],
  );
  const seasonEndsIn = state ? daysUntil(state.league.week_end) : 0;
  const todaysOpponentName = state?.todaysOpponent?.displayName ?? 'Opponent';

  const handleMatchComplete = useCallback(
    async (result: { winner: 'you' | 'bot' | null; yourScore: number; botScore: number }) => {
      if (!state?.todaysFixture) return;
      setReporting(true);
      try {
        const youAreHome = state.todaysFixture.home_member_id === state.you.id;
        const completedFixture: FixtureRecord = {
          ...state.todaysFixture,
          status: 'completed',
          home_score: youAreHome ? result.yourScore : result.botScore,
          away_score: youAreHome ? result.botScore : result.yourScore,
        };
        const recorded = await reportLeagueResult(
          state.todaysFixture.id,
          youAreHome ? result.yourScore : result.botScore,
          youAreHome ? result.botScore : result.yourScore,
        );
        const previousPosition =
          state.standings.find((row) => row.memberId === state.you.id)?.position ?? null;
        const nextPosition =
          recorded.standings.find((row) => row.memberId === state.you.id)?.position ?? null;
        setState((prev) =>
          prev
            ? {
                ...prev,
                standings: recorded.standings,
                todaysFixture: completedFixture,
                recentResults: [
                  completedFixture,
                  ...prev.recentResults.filter((fixture) => fixture.id !== prev.todaysFixture?.id),
                ].slice(0, 3),
              }
            : prev,
        );
        setPostMatch({
          ...result,
          standings: recorded.standings,
          previousPosition,
          currentPosition: nextPosition,
        });
        setStage('post');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record league result.');
        setStage('hub');
      } finally {
        setReporting(false);
      }
    },
    [state],
  );

  if (!user) {
    return (
      <LayoutScreen
        className="screen mode-home-screen mode-subpage-screen mode-accent-league"
        badge="Your League"
        title="Sign In Required"
        subtitle="League Mode is tied to your account and season progression."
        contentClassName="screen-shell"
      >
        <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
      </LayoutScreen>
    );
  }

  if (loading) {
    return (
      <LayoutScreen
        className="screen mode-home-screen mode-subpage-screen mode-accent-league"
        badge="Your League"
        title="Loading League"
        subtitle="Building your table and today’s fixture."
        contentClassName="screen-shell"
      />
    );
  }

  if (error || !state) {
    return (
      <LayoutScreen
        className="screen mode-home-screen mode-subpage-screen mode-accent-league"
        badge="Your League"
        title="League Unavailable"
        subtitle="Unable to load your current season."
        contentClassName="screen-shell"
      >
        {error ? <p className="auth-inline-error">{error}</p> : null}
        <div className="league-actions-inline">
          <button className="mode-inline-btn" onClick={() => void loadState()}>Retry</button>
          <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
        </div>
      </LayoutScreen>
    );
  }

  if (stage === 'match' && state.todaysFixture && state.todaysOpponent) {
    return (
      <BotMatchScreen
        onBack={() => setStage('hub')}
        dealSize={7}
        winningScore={30}
        opponentName={state.todaysOpponent.displayName}
        onMatchComplete={(result) => void handleMatchComplete(result)}
        userId={user.id}
        username={profile?.username ?? null}
      />
    );
  }

  if (stage === 'pre' && state.todaysOpponent) {
    return (
      <LayoutScreen
        className="screen mode-home-screen mode-subpage-screen mode-accent-league league-screen"
        badge="Your League"
        title="Today’s Opponent"
        subtitle="One match today. First to 30 wins the fixture."
        contentClassName="screen-shell"
      >
        <div className={`league-opponent-card ${state.todaysOpponent.isFritz ? 'is-fritz' : ''}`}>
          <p className="league-opponent-name">{state.todaysOpponent.isFritz ? 'Fritz' : state.todaysOpponent.displayName}</p>
          <p className="league-opponent-quote">
            {state.todaysOpponent.personality
              ? `“${state.todaysOpponent.personality}”`
              : 'A rival from your division.'}
          </p>
          <p className="league-opponent-meta">
            Record this season: {state.todaysOpponent.record
              ? `${state.todaysOpponent.record.wins}W ${state.todaysOpponent.record.draws}D ${state.todaysOpponent.record.losses}L`
              : '0W 0D 0L'}
          </p>
          <p className="league-opponent-meta">
            Current position: {state.todaysOpponent.currentPosition ? `${state.todaysOpponent.currentPosition}${state.todaysOpponent.currentPosition === 1 ? 'st' : state.todaysOpponent.currentPosition === 2 ? 'nd' : state.todaysOpponent.currentPosition === 3 ? 'rd' : 'th'}` : '—'}
          </p>
          <div className="league-actions-inline">
            <button className="mode-inline-btn" onClick={() => setStage('match')} disabled={reporting}>Play Match</button>
            <button className="mode-inline-btn" onClick={() => setStage('hub')}>View Table</button>
          </div>
        </div>
      </LayoutScreen>
    );
  }

  if (stage === 'post' && postMatch) {
    const movedUp =
      postMatch.previousPosition !== null &&
      postMatch.currentPosition !== null &&
      postMatch.currentPosition < postMatch.previousPosition;
    return (
      <LayoutScreen
        className="screen mode-home-screen mode-subpage-screen mode-accent-league league-screen"
        badge="Match Result"
        title={postMatch.winner === 'you' ? 'You Won' : postMatch.winner === 'bot' ? `${todaysOpponentName} Won` : 'Draw'}
        subtitle="Table updated from completed fixtures."
        contentClassName="screen-shell"
      >
        <div className="league-post-card">
          <div className="league-scoreline">
            <span>{profile?.username ? `@${profile.username}` : 'You'}</span>
            <strong>{postMatch.yourScore}</strong>
          </div>
          <div className="league-scoreline">
            <span>{todaysOpponentName}</span>
            <strong>{postMatch.botScore}</strong>
          </div>
          <p className="league-post-summary">
            {postMatch.winner === 'you' ? 'Win, +3 league points.' : postMatch.winner === 'bot' ? 'Loss, 0 league points.' : 'Draw, +1 league point.'}
          </p>
          <p className="league-post-summary">
            {movedUp && postMatch.currentPosition
              ? `You moved up to ${postMatch.currentPosition}${postMatch.currentPosition === 1 ? 'st' : postMatch.currentPosition === 2 ? 'nd' : postMatch.currentPosition === 3 ? 'rd' : 'th'} place.`
              : postMatch.currentPosition
                ? `Current table position: ${postMatch.currentPosition}.`
                : 'Table position pending.'}
          </p>
          <div className="league-actions-inline">
            <button className="mode-inline-btn" onClick={() => setStage('hub')}>View Table</button>
            <button className="mode-inline-btn" onClick={onBack}>Done</button>
          </div>
        </div>
      </LayoutScreen>
    );
  }

  return (
    <LayoutScreen
      className="screen mode-home-screen mode-subpage-screen mode-accent-league league-screen"
      badge="Your League"
      title={`Division ${state.league.division}`}
      subtitle={`Season ends in ${seasonEndsIn} day${seasonEndsIn === 1 ? '' : 's'}`}
      contentClassName="screen-shell"
    >
      <div className="league-hub">
        <div className="league-table-card">
          <div className="league-table-head">
            <span>#</span>
            <span>Player</span>
            <span>P</span>
            <span>W</span>
            <span>D</span>
            <span>L</span>
            <span>PF</span>
            <span>PA</span>
            <span>+/-</span>
            <span>Pts</span>
          </div>
          {state.standings.map((row) => {
            const isYou = row.memberId === state.you.id;
            const isFritz = state.members.find((member) => member.id === row.memberId)?.bot_id === 'fritz';
            const zoneClass = row.position <= 2 ? 'is-promo' : row.position >= 6 ? 'is-relegation' : '';
            return (
              <div key={row.memberId} className={`league-table-row ${zoneClass} ${isYou ? 'is-you' : ''} ${isFritz ? 'is-fritz' : ''}`}>
                <span>{row.position}</span>
                <span>{isYou ? `${row.displayName} ← You` : row.displayName}</span>
                <span>{row.played}</span>
                <span>{row.wins}</span>
                <span>{row.draws}</span>
                <span>{row.losses}</span>
                <span>{row.pointsFor}</span>
                <span>{row.pointsAgainst}</span>
                <span>{row.pointsDiff >= 0 ? `+${row.pointsDiff}` : row.pointsDiff}</span>
                <span>{row.leaguePoints}</span>
              </div>
            );
          })}
        </div>

        <div className="league-side-column">
          <div className="league-fixture-card">
            <p className="league-card-label">Today’s Match</p>
            {state.todaysFixture && state.todaysOpponent ? (
              <>
                <h3>{profile?.username ? `@${profile.username}` : 'You'} vs {state.todaysOpponent.displayName}</h3>
                {state.todaysFixture.status === 'scheduled' ? (
                  <button className="mode-option mode-option-primary mode-accent-league league-play-now" onClick={() => setStage('pre')}>
                    <span className="mode-option-title">Play Now</span>
                    <span className="mode-option-meta">First to 30 points</span>
                  </button>
                ) : (
                  <p className="league-fixture-result">{fixtureResultLabel(state.todaysFixture, state.you.id)}</p>
                )}
              </>
            ) : state.isByeDay ? (
              <>
                <h3>Rest Day</h3>
                <p className="league-fixture-result">No counted fixture today. Check the table and return tomorrow.</p>
              </>
            ) : (
              <>
                <h3>No Fixture Yet</h3>
                <p className="league-fixture-result">Season schedule is still settling.</p>
              </>
            )}
          </div>

          <div className="league-recent-card">
            <p className="league-card-label">Recent Results</p>
            {state.recentResults.length === 0 ? (
              <p className="league-fixture-result">No completed fixtures yet this season.</p>
            ) : (
              <div className="league-recent-list">
                {state.recentResults.map((fixture) => (
                  <div key={fixture.id} className="league-recent-item">
                    <span>MD{fixture.matchday}</span>
                    <strong>{fixtureResultLabel(fixture, state.you.id)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <details className="league-schedule-card">
            <summary>View Full Schedule</summary>
            <div className="league-schedule-list">
              {state.fullSchedule.map((fixture) => (
                <div key={fixture.id} className="league-schedule-item">
                  <span>MD{fixture.matchday}</span>
                  <span>{formatDate(fixture.scheduled_date)}</span>
                  <span>{fixture.home_member_id === state.you.id || fixture.away_member_id === state.you.id ? fixtureResultLabel(fixture, state.you.id) : fixture.status}</span>
                </div>
              ))}
            </div>
          </details>

          <div className="league-actions-inline">
            <button className="mode-inline-btn" onClick={() => void loadState()}>Refresh</button>
            <button className="mode-inline-btn" onClick={onBack}>Back to Home</button>
          </div>
        </div>
      </div>
    </LayoutScreen>
  );
}
