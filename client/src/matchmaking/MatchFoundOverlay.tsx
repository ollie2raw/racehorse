import { useEffect, useMemo, useState } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import type { MatchFoundPayload } from './types';
import { fetchRankingProfile, fetchUserStatsByUserId } from '../stats/statsApi';
import './matchFoundOverlay.css';

type Props = {
  payload: MatchFoundPayload;
  onComplete: () => void;
  /** Signed-in display name for the local player (optional fallback: "You"). */
  yourUsername?: string | null;
  yourUserId?: string | null;
  /** Queue wait time at match — used for stake band label (same bands as search UI). */
  queueElapsedMs?: number;
};

function displayInitials(name: string): string {
  const t = name.trim().replace(/^@+/, '');
  if (!t) return '?';
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[1][0];
    if (a && b) return (a + b).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function ratingTierLabel(rating: number): string {
  const r = Math.round(rating);
  if (r >= 1600) return 'Master';
  if (r >= 1300) return 'Elite';
  if (r >= 1000) return 'Standard';
  return 'Rookie';
}

function formatElo(n: number): string {
  return Math.round(n).toLocaleString();
}

const STAKE_SEGMENTS = [
  { range: '±100' },
  { range: '±200' },
  { range: '±300' },
  { range: 'Any' },
] as const;

function stakeLabelFromElapsed(elapsedMs: number): string {
  const seg = Math.min(3, Math.floor(elapsedMs / 30_000));
  return STAKE_SEGMENTS[seg].range;
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Full-screen match-found layout: dual player columns, center countdown ring,
 * match facts row, footer parameters. Shown after `queue:matched`.
 */
export function MatchFoundOverlay({ payload, onComplete, yourUsername, yourUserId, queueElapsedMs = 0 }: Props) {
  const totalSeconds = useMemo(() => Math.max(1, Math.ceil(payload.countdownMs / 1000)), [payload.countdownMs]);
  const countdownKey = `${payload.roomCode}:${totalSeconds}`;
  const [trackedCountdownKey, setTrackedCountdownKey] = useState(countdownKey);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  if (countdownKey !== trackedCountdownKey) {
    setTrackedCountdownKey(countdownKey);
    setSecondsLeft(totalSeconds);
  }

  const [youStats, setYouStats] = useState<{ record: string; streak: number } | null>(null);
  const [oppStats, setOppStats] = useState<{ record: string; streak: number } | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onComplete();
      return;
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft, onComplete]);

  useEffect(() => {
    if (yourUserId) {
      Promise.all([
        fetchRankingProfile(yourUserId),
        fetchUserStatsByUserId(yourUserId),
      ]).then(([profileResp, statsResp]) => {
        const ratingProfile = profileResp.data;
        const stats = statsResp.data;
        if (ratingProfile || stats) {
          const record = stats ? `${stats.wins} · ${stats.losses} · 0` : '0 · 0 · 0';
          const streak = ratingProfile?.currentWinStreak ?? 0;
          setYouStats({ record, streak });
        }
      }).catch(() => {});
    }
  }, [yourUserId]);

  useEffect(() => {
    const oppId = payload.opponent.userId;
    if (oppId) {
      Promise.all([
        fetchRankingProfile(oppId),
        fetchUserStatsByUserId(oppId),
      ]).then(([profileResp, statsResp]) => {
        const ratingProfile = profileResp.data;
        const stats = statsResp.data;
        if (ratingProfile || stats) {
          const record = stats ? `${stats.wins} · ${stats.losses} · 0` : '0 · 0 · 0';
          const streak = ratingProfile?.currentWinStreak ?? 0;
          setOppStats({ record, streak });
        }
      }).catch(() => {});
    }
  }, [payload.opponent.userId]);

  const youName = yourUsername?.trim() || 'You';
  const oppName = payload.opponent.username.trim() || 'Opponent';
  const stakeLabel = stakeLabelFromElapsed(queueElapsedMs);
  const ringProgress = secondsLeft / totalSeconds;
  const dashOffset = RING_C * (1 - ringProgress);
  const winStreak = youStats ? youStats.streak : 0;

  return (
    <GameOverlayPortal>
    <div className="mm-found-overlay" role="dialog" aria-modal="true" aria-label="Match found">
      <div className="mm-found-shell">
        <header className="mm-found-top">
          <div className="mm-found-top__left">
            <span className="mm-found-pill mm-found-pill--live">
              <span className="mm-found-pill__dot" aria-hidden />
              Match found
            </span>
            <span className="mm-found-pill mm-found-pill--muted">Rated · Quick match · Best of 1</span>
          </div>
        </header>

        <div className="mm-found-grid">
          <section className="mm-found-seat mm-found-seat--you" aria-label="Your seat">
            <p className="mm-found-seat__kicker">Your seat</p>
            <div className="mm-found-seat__row">
              <div className="mm-found-avatar mm-found-avatar--gold" aria-hidden>
                <span>{displayInitials(youName)}</span>
              </div>
              <div className="mm-found-seat__body">
                <h3 className="mm-found-seat__name">{youName}</h3>
                <p className="mm-found-seat__meta">
                  <span>{ratingTierLabel(payload.yourRating)}</span>
                  <span className="mm-found-seat__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>Rated</span>
                </p>
                <p className="mm-found-seat__record" aria-label="Record placeholder">
                  {youStats ? youStats.record : '— · — · —'}
                </p>
                <p className="mm-found-seat__elo-row">
                  <span className="mm-found-seat__elo-num">{formatElo(payload.yourRating)}</span>
                </p>
                {winStreak > 1 ? (
                  <p className="mm-found-streak mm-found-streak--gold">
                    <svg className="mm-found-streak__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M8 1c0 2-1.5 3-2 5-.3 1.2 0 2.5.8 3.5L8 15l1.2-5.5c.8-1 .9-2.3.6-3.5C9.5 4 8 3 8 1z"
                      />
                    </svg>
                    {winStreak}-game win streak
                  </p>
                ) : null}
                <div className="mm-found-badge mm-found-badge--gold">Rated quick match · First to 60 pts</div>
              </div>
            </div>
          </section>

          <section className="mm-found-center" aria-live="assertive">
            <p className="mm-found-center__vs">VS</p>
            <div className="mm-found-ring-wrap">
              <svg className="mm-found-ring" viewBox="0 0 120 120" aria-hidden>
                <circle className="mm-found-ring__track" cx="60" cy="60" r={RING_R} />
                <circle
                  className="mm-found-ring__prog"
                  cx="60"
                  cy="60"
                  r={RING_R}
                  style={{ strokeDasharray: RING_C, strokeDashoffset: dashOffset }}
                />
              </svg>
              <span className="mm-found-ring__num">{secondsLeft}</span>
            </div>
            <h2 className="mm-found-center__title">Get ready.</h2>
            <p className="mm-found-center__sub">First move in {secondsLeft}s</p>
          </section>

          <section className="mm-found-seat mm-found-seat--opp" aria-label="Opponent">
            <p className="mm-found-seat__kicker mm-found-seat__kicker--blue">Opponent</p>
            <div className="mm-found-seat__row">
              <div className="mm-found-avatar mm-found-avatar--blue" aria-hidden>
                <span>{displayInitials(oppName)}</span>
              </div>
              <div className="mm-found-seat__body">
                <h3 className="mm-found-seat__name">{oppName}</h3>
                <p className="mm-found-seat__meta">
                  <span>{ratingTierLabel(payload.opponent.rating)}</span>
                  <span className="mm-found-seat__meta-sep" aria-hidden>
                    ·
                  </span>
                  <span>Rated</span>
                </p>
                <p className="mm-found-seat__record" aria-label="Record placeholder">
                  {oppStats ? oppStats.record : '— · — · —'}
                </p>
                <p className="mm-found-seat__elo-row">
                  <span className="mm-found-seat__elo-num mm-found-seat__elo-num--blue">
                    {formatElo(payload.opponent.rating)}
                  </span>
                </p>
                {oppStats && oppStats.streak > 1 ? (
                  <p className="mm-found-streak mm-found-streak--blue">
                    <svg className="mm-found-streak__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M8 1c0 2-1.5 3-2 5-.3 1.2 0 2.5.8 3.5L8 15l1.2-5.5c.8-1 .9-2.3.6-3.5C9.5 4 8 3 8 1z"
                      />
                    </svg>
                    {oppStats.streak}-game win streak
                  </p>
                ) : null}
                <div className="mm-found-badge mm-found-badge--blue">Skill-matched opponent</div>
              </div>
            </div>
          </section>
        </div>

        <section className="mm-found-stats" aria-label="Head to head">
          <div className="mm-found-stats__cell">
            <p className="mm-found-stats__label">Head-to-head</p>
            <p className="mm-found-stats__value mm-found-stats__value--split">
              <span className="mm-found-stats__you">—</span>
              <span className="mm-found-stats__sep" aria-hidden>
                ·
              </span>
              <span className="mm-found-stats__mid">—</span>
              <span className="mm-found-stats__sep" aria-hidden>
                ·
              </span>
              <span className="mm-found-stats__opp">—</span>
            </p>
            <div className="mm-found-stats__bar" aria-hidden>
              <span className="mm-found-stats__bar-you" />
              <span className="mm-found-stats__bar-opp" />
            </div>
            <p className="mm-found-stats__hint">No prior ranked meetings</p>
          </div>
          <div className="mm-found-stats__cell mm-found-stats__cell--mid">
            <p className="mm-found-stats__label">Last meeting</p>
            <p className="mm-found-stats__value">—</p>
            <p className="mm-found-stats__hint">History builds as you play</p>
          </div>
          <div className="mm-found-stats__cell">
            <p className="mm-found-stats__label">Avg margin</p>
            <p className="mm-found-stats__value">—</p>
            <p className="mm-found-stats__hint">Per-match stats coming soon</p>
          </div>
        </section>

        <footer className="mm-found-foot">
          <div className="mm-found-foot__item">
            <span className="mm-found-foot__lab">Target</span>
            <span className="mm-found-foot__val">60 pts</span>
          </div>
          <div className="mm-found-foot__item">
            <span className="mm-found-foot__lab">Time / move</span>
            <span className="mm-found-foot__val">Untimed</span>
          </div>
          <div className="mm-found-foot__item">
            <span className="mm-found-foot__lab">Stake</span>
            <span className="mm-found-foot__val mm-found-foot__val--stake">
              {stakeLabel === 'Any' ? 'Open window' : `${stakeLabel} rating`}
            </span>
          </div>
          <div className="mm-found-foot__item">
            <span className="mm-found-foot__lab">Region</span>
            <span className="mm-found-foot__val">Global</span>
          </div>
        </footer>
      </div>
    </div>
    </GameOverlayPortal>
  );
}
