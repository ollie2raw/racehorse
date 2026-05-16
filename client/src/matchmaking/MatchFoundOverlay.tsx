import { useEffect, useMemo, useState } from 'react';
import type { MatchFoundPayload } from './types';
import './matchFoundOverlay.css';

type Props = {
  payload: MatchFoundPayload;
  onComplete: () => void;
  /** Signed-in display name for the local player (optional fallback: "You"). */
  yourUsername?: string | null;
  /** Queue wait time at match — used for stake band label (same bands as search UI). */
  queueElapsedMs?: number;
};

/** Placeholder until match history is wired from the API. */
const PLACEHOLDER_FORM_YOU = 0;
const PLACEHOLDER_FORM_OPP = 0;
const PLACEHOLDER_LAST_5_YOU: Array<'W' | 'L' | 'D'> = ['W', 'L', 'W', 'W', 'D'];
const PLACEHOLDER_LAST_5_OPP: Array<'W' | 'L' | 'D'> = ['W', 'W', 'L', 'L', 'W'];
const PLACEHOLDER_RECORD_YOU = '28 · 12 · 4';
const PLACEHOLDER_RECORD_OPP = '16 · 9 · 3';
/** Shown on the left card when greater than 1; replace with live streak from API. */
const PLACEHOLDER_WIN_STREAK = 4;

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

function formatForm(n: number): string {
  if (n === 0) return 'FORM +0';
  const sign = n > 0 ? '+' : '';
  return `FORM ${sign}${n}`;
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

function LastFivePills({ results }: { results: Array<'W' | 'L' | 'D'> }) {
  return (
    <div className="mm-found-last5">
      <span className="mm-found-last5__label">Last 5</span>
      <div className="mm-found-last5__pills" role="list">
        {results.map((r, i) => (
          <span
            key={i}
            className={`mm-found-wld mm-found-wld--${r.toLowerCase()}`}
            role="listitem"
          >
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Full-screen match-found layout: dual player columns, center countdown ring,
 * match facts row, footer parameters. Shown after `queue:matched`.
 */
export function MatchFoundOverlay({ payload, onComplete, yourUsername, queueElapsedMs = 0 }: Props) {
  const totalSeconds = useMemo(() => Math.max(1, Math.ceil(payload.countdownMs / 1000)), [payload.countdownMs]);
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  useEffect(() => {
    setSecondsLeft(totalSeconds);
  }, [totalSeconds, payload.roomCode]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onComplete();
      return;
    }
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft, onComplete]);

  const youName = yourUsername?.trim() || 'You';
  const oppName = payload.opponent.username.trim() || 'Opponent';
  const stakeLabel = stakeLabelFromElapsed(queueElapsedMs);
  const ringProgress = secondsLeft / totalSeconds;
  const dashOffset = RING_C * (1 - ringProgress);
  const winStreak = PLACEHOLDER_WIN_STREAK;

  return (
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
                  {PLACEHOLDER_RECORD_YOU}
                </p>
                <p className="mm-found-seat__elo-row">
                  <span className="mm-found-seat__elo-num">{formatElo(payload.yourRating)}</span>
                  <span className="mm-found-seat__form">{formatForm(PLACEHOLDER_FORM_YOU)}</span>
                </p>
                <LastFivePills results={PLACEHOLDER_LAST_5_YOU} />
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
                  {PLACEHOLDER_RECORD_OPP}
                </p>
                <p className="mm-found-seat__elo-row">
                  <span className="mm-found-seat__elo-num mm-found-seat__elo-num--blue">
                    {formatElo(payload.opponent.rating)}
                  </span>
                  <span className="mm-found-seat__form">{formatForm(PLACEHOLDER_FORM_OPP)}</span>
                </p>
                <LastFivePills results={PLACEHOLDER_LAST_5_OPP} />
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
  );
}
