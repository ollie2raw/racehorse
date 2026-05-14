import { useEffect, useMemo, useState } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import type { Registration, ScheduledTournament } from './types';
import './tournamentHub.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentHubScreenProps {
  identity: Identity;
  upcoming: ScheduledTournament[];
  registrations: Registration[];
  error: string | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onBackHome: () => void;
  onOpenBracket: (tournamentId: string) => void;
  onRegister: (tournamentId: string) => void | Promise<void>;
  onWithdraw: (tournamentId: string) => void | Promise<void>;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatCountdown(ms: number): string {
  const safe = Math.max(0, ms);
  const totalS = Math.floor(safe / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatTimePst(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusFor(t: ScheduledTournament): { label: string; cls: string } {
  if (t.status === 'registration_open') return { label: 'Open', cls: 'th-card__status--open' };
  const startMs = Date.parse(t.scheduled_start);
  if (startMs - Date.now() < 30 * 60 * 1000) return { label: 'Starting Soon', cls: 'th-card__status--soon' };
  return { label: 'Upcoming', cls: 'th-card__status--upcoming' };
}

function Trophy() {
  return (
    <svg className="th-trophy-svg" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="th-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c45a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b8782b" />
        </linearGradient>
      </defs>
      <path d="M50 30h100v50a50 50 0 0 1-100 0V30z" fill="url(#th-gold)" />
      <path d="M50 50 H20 a20 20 0 0 0 30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <path d="M150 50 H180 a20 20 0 0 1 -30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <rect x="80" y="130" width="40" height="40" fill="url(#th-gold)" opacity="0.85" />
      <rect x="60" y="170" width="80" height="14" rx="3" fill="url(#th-gold)" />
      <rect x="50" y="184" width="100" height="20" rx="4" fill="url(#th-gold)" />
    </svg>
  );
}

export default function TournamentHubScreen(props: TournamentHubScreenProps) {
  const userId = props.identity?.userId ?? null;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const nextTournament = props.upcoming[0] ?? null;
  const countdown = nextTournament
    ? formatCountdown(Date.parse(nextTournament.scheduled_start) - now)
    : '--:--:--';

  const isRegistered = useMemo(() => {
    const ids = new Set(
      props.registrations
        .filter((r) => r.status === 'registered' || r.status === 'active')
        .map((r) => r.tournament_id),
    );
    return (t: ScheduledTournament) => ids.has(t.id);
  }, [props.registrations]);

  return (
    <div className="th-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        activeColor="var(--accent-amber)"
      />
      <div className="th-shell">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
        </div>

        <div className="th-layout">
          <div className="th-left">
            <div>
              <p className="th-kicker">Tournament</p>
              <h1 className="th-title">Compete</h1>
              <p className="th-desc">8-player bracket. First to 30 wins. One champion every two hours.</p>
            </div>
            <div className="th-trophy-stage" aria-hidden><Trophy /></div>
            <div className="th-features">
              <div className="th-feature">
                <div className="th-feature__header">8 Players</div>
                <div className="th-feature__desc">Single-elimination bracket.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">QF → SF → Final</div>
                <div className="th-feature__desc">Win three to take the crown.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">First to 30</div>
                <div className="th-feature__desc">Quick, decisive matches.</div>
              </div>
            </div>
          </div>

          <div className="th-panel">
            <div className="th-countdown">
              <span className="th-countdown__label">Next Tournament</span>
              <span className="th-countdown__time" aria-live="polite">{countdown}</span>
              <span className="th-countdown__sub">
                Tournaments run every 2 hours. Registration opens 30 minutes before start and closes 5 minutes before.
              </span>
            </div>

            <div className="th-panel-body">
              {props.upcoming.slice(0, 3).map((t) => {
                const reg = isRegistered(t);
                const open = t.status === 'registration_open';
                const status = statusFor(t);
                const count = t.registered_count ?? 0;
                return (
                  <div className="th-card" key={t.id}>
                    <div className="th-card__time">{formatTimePst(t.scheduled_start)}</div>
                    <div className="th-card__middle">
                      <div className="th-card__count">{count} / {t.max_players} Registered</div>
                      <div className="th-card__bar">
                        <span className="th-card__bar-fill" style={{ width: `${(count / t.max_players) * 100}%` }} />
                      </div>
                      <span className={`th-card__status ${status.cls}`}>{status.label}</span>
                    </div>
                    <div className="th-card__actions">
                      {reg ? (
                        <>
                          <span className="th-card__registered">Registered ✓</span>
                          <button
                            className="th-cta th-cta--ghost"
                            onClick={() => void props.onWithdraw(t.id)}
                          >
                            Withdraw
                          </button>
                          <button
                            className="th-cta th-cta--ghost"
                            onClick={() => props.onOpenBracket(t.id)}
                          >
                            View Bracket
                          </button>
                        </>
                      ) : (
                        <button
                          className="th-cta"
                          disabled={!open || !userId}
                          onClick={() => void props.onRegister(t.id)}
                        >
                          Register
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {props.upcoming.length === 0 ? (
                <p className="th-empty">No upcoming tournaments. Check back soon.</p>
              ) : null}
              {props.error ? <p className="th-err">{props.error}</p> : null}
            </div>

            <div className="th-summary-strip">
              <div className="th-summary-item">
                <span className="th-summary-key">Format</span>
                <span className="th-summary-value">7-Tile</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Win Target</span>
                <span className="th-summary-value">First to 30</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Cadence</span>
                <span className="th-summary-value">Every 2 hours</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
