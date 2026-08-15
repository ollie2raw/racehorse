import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import type { FritzTier } from '../modules/fritz/fritzConfig';
import { useDeferredAsset } from '../ui/useDeferredAsset';
import {
  DfIconSwords,
  DfIconTrophy,
  DfPvfIconCrown,
  DfPvfIconRobotNav,
} from '../dailyFritz/DailyFritzIcons';
import {
  getFritzChallenge,
  joinFritzChallenge,
  startFritzChallenge,
  type FritzChallengeView,
} from './api';
import { buildFritzChallengeShareUrl } from './fritzChallengeLinks';
import './fritzChallenge.css';

type FritzChallengeRoomProps = {
  code: string;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onStartChallenge?: (code: string) => Promise<void>;
};

const TIER_LABELS: Record<FritzTier, string> = {
  rookie: 'Rookie',
  standard: 'Standard',
  elite: 'Elite',
  master: 'Master',
};

function friendlyRoomError(error: unknown): string {
  if (!(error instanceof Error)) return 'This challenge is unavailable right now.';
  if ((error as Error & { status?: number }).status === 401) {
    return 'Sign in to accept this challenge.';
  }
  if (error.message === 'Failed to fetch' || error.message === 'Network error') {
    return 'Couldn’t reach the game server. Check your connection and try again.';
  }
  return error.message;
}

function formatExpiry(value: string): string {
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return 'Limited time';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(expiresAt);
}

export default function FritzChallengeRoom({
  code,
  onBack,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  onStartChallenge,
}: FritzChallengeRoomProps) {
  const [challenge, setChallenge] = useState<FritzChallengeView | null>(null);
  const [pending, setPending] = useState(true);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const loadHeroAsset = useCallback(
    () => import('../assets/dailyFritz/playvsfritzdone.webp'),
    [],
  );
  const heroSrc = useDeferredAsset('fritz-challenge-hero', loadHeroAsset);

  const loadChallenge = useCallback(async (quiet = false) => {
    if (!quiet) setPending(true);
    try {
      const loaded = await getFritzChallenge(code);
      setChallenge(loaded);
      setError(null);
    } catch (requestError) {
      if (!quiet) setError(friendlyRoomError(requestError));
    } finally {
      if (!quiet) setPending(false);
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    void getFritzChallenge(code)
      .then((loaded) => {
        if (cancelled) return;
        setChallenge(loaded);
        setError(null);
      })
      .catch((requestError) => {
        if (!cancelled) setError(friendlyRoomError(requestError));
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    const isParticipant = challenge?.viewer_role === 'creator'
      || challenge?.viewer_role === 'opponent';
    if (!challenge || !isParticipant || !['open', 'active'].includes(challenge.status)) return;
    const intervalId = window.setInterval(() => {
      void loadChallenge(true);
    }, 8_000);
    return () => window.clearInterval(intervalId);
  }, [challenge, loadChallenge]);

  const shareUrl = useMemo(
    () => typeof window !== 'undefined'
      ? buildFritzChallengeShareUrl(code, window.location)
      : '',
    [code],
  );

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }, [shareUrl]);

  const handleShare = useCallback(async () => {
    if (!challenge || !shareUrl) return;
    if (navigator.share) {
      await navigator.share({
        title: 'Racehorse Fritz Challenge',
        text: `Play my ${TIER_LABELS[challenge.fritz_tier]} Fritz best-of-three challenge.`,
        url: shareUrl,
      });
      return;
    }
    await handleCopy();
  }, [challenge, handleCopy, shareUrl]);

  const handleJoin = useCallback(async () => {
    if (!challenge || joining) return;
    setJoining(true);
    setError(null);
    try {
      setChallenge(await joinFritzChallenge(challenge.share_code));
    } catch (requestError) {
      if ((requestError as Error & { status?: number })?.status === 401) {
        onOpenAuth?.();
      }
      setError(friendlyRoomError(requestError));
    } finally {
      setJoining(false);
    }
  }, [challenge, joining, onOpenAuth]);

  const handleStart = useCallback(async () => {
    if (!challenge || !['creator', 'opponent'].includes(challenge.viewer_role ?? '') || starting) return;
    setStarting(true);
    setError(null);
    try {
      if (onStartChallenge) await onStartChallenge(challenge.share_code);
      else await startFritzChallenge(challenge.share_code);
    } catch (requestError) {
      setError(friendlyRoomError(requestError));
    } finally {
      setStarting(false);
    }
  }, [challenge, onStartChallenge, starting]);

  const canJoin = challenge?.viewer_role === 'opponent'
    && challenge.status === 'open'
    && !challenge.recipient_accepted;
  const isParticipant = challenge?.viewer_role === 'creator'
    || challenge?.viewer_role === 'opponent';
  const attemptCompleted = challenge?.attempt?.status === 'completed';
  const attemptStarted = challenge?.attempt?.status === 'started';
  const canStart = challenge?.viewer_role === 'creator'
    ? challenge.invite_sent && challenge.recipient_accepted && !attemptCompleted
    : challenge?.viewer_role === 'opponent'
      ? challenge.recipient_accepted && !attemptCompleted
      : false;
  const recordedGames = challenge?.attempt?.set_result?.games ?? [];
  const setWinner = challenge?.attempt?.set_result?.setWinner;

  return (
    <div className="fritz-challenge-room">
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__texture" />
      </div>

      <GlobalNav
        currentMode="botSetup"
        onNavigate={onNavigate ?? ((mode) => mode === 'home' ? onBack() : undefined)}
        onOpenAuth={onOpenAuth}
        onOpenAccount={onOpenAccount}
        activeColor="#e7b64a"
      />

      <main className="fritz-challenge-hub">
        <section className="fritz-challenge-hub__left">
          <button className="rh-back-button fritz-challenge-hub__back" onClick={onBack}>
            <span>←</span> Back to Play vs Fritz
          </button>

          <header className="fritz-challenge-hub__header">
            <span className="fritz-challenge-eyebrow">FRITZ CHALLENGE</span>
            <h1>Shared best of three.</h1>
            <p>Send one friend the same fixed set. They can play whenever they’re ready.</p>
          </header>

          <article className="fritz-challenge-hub__hero">
            {heroSrc ? (
              <img src={heroSrc} alt="Fritz at the domino table" decoding="async" />
            ) : null}
            <div className="fritz-challenge-hub__hero-shade" aria-hidden />
            <div className="fritz-challenge-hub__hero-copy">
              <span>YOUR SHARED OPPONENT</span>
              <h2>Fritz</h2>
              <p>Both players face the same difficulty and the same deals.</p>
            </div>
            <div className="fritz-challenge-hub__hero-badges">
              <div><strong>Same set</strong><span>Identical fixed deals</span></div>
              <div><strong>Play anytime</strong><span>No live lobby required</span></div>
              <div><strong>Verified</strong><span>Results reveal together</span></div>
            </div>
          </article>
        </section>

        <section className="fritz-challenge-hub__panel" aria-label="Fritz Challenge">
          {pending && !challenge ? (
            <div className="fritz-challenge-room__loading" aria-live="polite">
              Loading challenge…
            </div>
          ) : null}

          {error ? (
            <div className="fritz-challenge-error fritz-challenge-room__error" role="alert">
              {error}
              {!challenge ? <button onClick={() => void loadChallenge()}>Try again</button> : null}
            </div>
          ) : null}

          {challenge ? (
            <>
              <div className="fritz-challenge-hub__section">
                <span className="fritz-challenge-hub__section-label">1. CHALLENGE DETAILS</span>
                <div className="fritz-challenge-hub__overview">
                  <article>
                    <span className="fritz-challenge-hub__overview-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none">
                        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1" />
                        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
                      </svg>
                    </span>
                    <div><strong>{code}</strong><span>Challenge code</span></div>
                  </article>
                  <article className="is-highlighted">
                    <span className="fritz-challenge-hub__overview-icon" aria-hidden>
                      <DfPvfIconCrown color="#e7b64a" />
                    </span>
                    <div><strong>{TIER_LABELS[challenge.fritz_tier]}</strong><span>Fritz tier</span></div>
                  </article>
                  <article>
                    <span className="fritz-challenge-hub__overview-icon" aria-hidden>
                      <DfIconSwords />
                    </span>
                    <div><strong>Best of 3</strong><span>Format</span></div>
                  </article>
                  <article>
                    <span className="fritz-challenge-hub__overview-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                    </span>
                    <div><strong>{formatExpiry(challenge.expires_at)}</strong><span>Expires</span></div>
                  </article>
                </div>
              </div>

              <div className="fritz-challenge-hub__section">
                <span className="fritz-challenge-hub__section-label">2. YOUR BEST OF 3</span>
                <div className="fritz-challenge-hub__games" aria-label="Best of three games">
                  {[1, 2, 3].map((gameNumber) => (
                    <article
                      className={`fritz-challenge-hub__game${gameNumber === 1 && canStart ? ' is-active' : ''}`}
                      key={gameNumber}
                    >
                      <span className="fritz-challenge-hub__game-number">{gameNumber}</span>
                      <div>
                        <span>GAME {gameNumber}</span>
                        <h3>Game {gameNumber}</h3>
                        <strong>
                          {recordedGames.find((game) => game.gameNumber === gameNumber)
                            ? `${recordedGames.find((game) => game.gameNumber === gameNumber)?.playerWon ? 'You won' : 'Fritz won'}`
                            : gameNumber === 1 && canStart ? 'Ready to play' : 'Fixed deal'}
                        </strong>
                        <small>
                          {recordedGames.find((game) => game.gameNumber === gameNumber)
                            ? `${recordedGames.find((game) => game.gameNumber === gameNumber)?.playerScore ?? 0}–${recordedGames.find((game) => game.gameNumber === gameNumber)?.fritzScore ?? 0}`
                            : gameNumber === 1 ? `First to ${challenge.winning_score}` : 'Unlocks in sequence'}
                        </small>
                        <em>
                          {recordedGames.find((game) => game.gameNumber === gameNumber)
                            ? 'COMPLETE'
                            : gameNumber === 1 && canStart ? 'READY' : 'LOCKED'}
                        </em>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="fritz-challenge-hub__section fritz-challenge-hub__section--action">
                <span className="fritz-challenge-hub__section-label">3. SET SUMMARY</span>
                <div className="fritz-challenge-hub__summary">
                  <div>
                    <span className="fritz-challenge-hub__summary-icon" aria-hidden>
                      <DfPvfIconRobotNav color="#e7b64a" />
                    </span>
                    <div><strong>Fritz {TIER_LABELS[challenge.fritz_tier]}</strong><span>Opponent</span></div>
                  </div>
                  <div>
                    <span className="fritz-challenge-hub__summary-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none">
                        <rect x="3" y="7" width="18" height="10" rx="3" />
                        <path d="M12 7v10" />
                      </svg>
                    </span>
                    <div><strong>First to {challenge.winning_score}</strong><span>Scoring</span></div>
                  </div>
                  <div>
                    <span className="fritz-challenge-hub__summary-icon" aria-hidden>
                      <DfIconTrophy />
                    </span>
                    <div><strong>{challenge.recipient_accepted ? 'Accepted' : 'Invite sent'}</strong><span>Status</span></div>
                  </div>
                  <div>
                    <span className="fritz-challenge-hub__summary-icon" aria-hidden>
                      <svg viewBox="0 0 24 24" fill="none">
                        <rect x="6" y="2.5" width="12" height="19" rx="2" />
                        <path d="M6 12h12" />
                        <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
                        <circle cx="14" cy="16.5" r="1" fill="currentColor" stroke="none" />
                      </svg>
                    </span>
                    <div><strong>{challenge.deal_size} tiles</strong><span>Deal size</span></div>
                  </div>
                </div>

                {canJoin ? (
                  <button
                    className="fritz-challenge-primary"
                    disabled={joining}
                    onClick={handleJoin}
                  >
                    {joining ? 'Accepting…' : 'Accept Challenge'}
                  </button>
                ) : challenge.viewer_role === 'creator' && !challenge.recipient_accepted ? (
                  <div className="fritz-challenge-hub__actions">
                    <button className="fritz-challenge-primary" onClick={handleShare}>
                      Share Challenge
                    </button>
                    <button className="fritz-challenge-room__secondary" onClick={handleCopy}>
                      {copied ? 'Link copied' : 'Copy invite link →'}
                    </button>
                    <span className="fritz-challenge-room__secondary fritz-challenge-room__secondary--disabled">
                      Waiting for your friend to accept
                    </span>
                  </div>
                ) : attemptCompleted ? (
                  <div className="fritz-challenge-room__ready-note">
                    <strong>Verified set complete.</strong>
                    <span>Your result is saved and shown above. This challenge cannot be replayed.</span>
                  </div>
                ) : isParticipant && canStart ? (
                  <div className="fritz-challenge-room__ready-note">
                    <strong>{challenge.recipient_accepted ? 'Your friend accepted the challenge.' : 'Your invite is sent.'}</strong>
                    <span>This link stays active, so either player can return and continue later.</span>
                    <button className="fritz-challenge-primary" disabled={starting} onClick={() => void handleStart()}>
                      {starting ? 'Loading game…' : attemptStarted ? 'Resume Challenge' : 'Start Game 1'}
                    </button>
                  </div>
                ) : (
                  <div className="fritz-challenge-room__ready-note">
                    <strong>This challenge has already been accepted.</strong>
                    <span>Only the invited player and challenge creator can take part.</span>
                  </div>
                )}
                {setWinner ? (
                  <div className="fritz-challenge-room__ready-note" role="status">
                    <strong>{setWinner === 'player' ? 'You won the set.' : 'Fritz won the set.'}</strong>
                    <span>Verified games: {recordedGames.length} of 3.</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      </main>
    </div>
  );
}
