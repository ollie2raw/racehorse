import { ArenaRings } from './ArenaRings';
import { IconFlame, IconPlus, IconUserBust } from './MultiplayerDuelIcons';
import type { PrivateLobbyDuelViewModel } from './privateMatchLobbyViewModel';
import type { PendingChallenge, PrivateMatchLobbyPhase } from './privateMatchLobbyScreenTypes';
import type { UsePrivateMatchLobbyGuestProfileResult } from './usePrivateMatchLobbyGuestProfile';

export interface PrivateMatchLobbyMatchupViewProps {
  phase: PrivateMatchLobbyPhase;
  duelViewModel: PrivateLobbyDuelViewModel;
  hostWinStreak?: number | null;
  guestProfile: UsePrivateMatchLobbyGuestProfileResult;
  pendingInviteActive: boolean;
  pendingInviteName: string | null;
  pendingChallenge?: PendingChallenge | null;
}

export function PrivateMatchLobbyMatchupView({
  phase,
  duelViewModel,
  hostWinStreak,
  guestProfile,
  pendingInviteActive,
  pendingInviteName,
  pendingChallenge = null,
}: PrivateMatchLobbyMatchupViewProps) {
  const { leftPlainName, leftCardIsCurrentUser, leftRatingStr, guestPresent, guestDisplayName } =
    duelViewModel;
  const { guestRankedLoading, guestRating, guestWinStreak } = guestProfile;

  return (
    <div className={`pml-room-stage${phase === 'room' ? ' pml-room-stage--shrink' : ''}`}>
      <div className="pml-room-stage__scroll">
        <div className="pml-matchup">
          <ArenaRings />
          <div className="pml-duel-card pml-duel-card--host">
            <div className="pml-duel-avatar-frame">
              <div className="pml-duel-avatar" aria-hidden>
                <IconUserBust gradientId="pml-bust-host" />
              </div>
            </div>
            <div className="pml-duel-name">
              <span className="pml-duel-name-text">{leftPlainName}</span>
            </div>
            <div
              className="pml-duel-rating"
              aria-label={leftRatingStr !== '—' ? `Rating ${leftRatingStr}` : undefined}
            >
              {leftRatingStr !== '—' ? (
                <>
                  <span className="pml-duel-star" aria-hidden>
                    ★
                  </span>
                  <span className="pml-duel-rating-num">{leftRatingStr}</span>
                </>
              ) : (
                <span className="pml-duel-rating-num">—</span>
              )}
            </div>
            <div
              className={`pml-duel-streak-wrap${
                leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0 ? '' : ' pml-duel-spacer'
              }`}
              aria-hidden={!(leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0)}
            >
              {leftCardIsCurrentUser && hostWinStreak != null && hostWinStreak > 0 ? (
                <div className="pml-duel-streak">
                  <span className="pml-duel-streak-flame" aria-hidden>
                    <IconFlame />
                  </span>
                  <span>Win Streak: {hostWinStreak}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="pml-vs-column">
            <span className="pml-vs-text">VS</span>
          </div>
          <div
            className={`pml-duel-card pml-duel-card--guest${guestPresent ? '' : ' pml-duel-card--awaiting'}`}
          >
            {guestPresent ? (
              <>
                <div className="pml-duel-avatar-frame">
                  <div className="pml-duel-avatar" aria-hidden>
                    <IconUserBust gradientId="pml-bust-guest" />
                  </div>
                </div>
                <div className="pml-duel-name">
                  <span className="pml-duel-name-text">{guestDisplayName}</span>
                </div>
                <div
                  className="pml-duel-rating"
                  aria-label={
                    !guestRankedLoading && guestRating != null
                      ? `Rating ${guestRating.toLocaleString()}`
                      : undefined
                  }
                >
                  {guestRankedLoading ? (
                    <span className="pml-duel-rating-num">—</span>
                  ) : guestRating != null ? (
                    <>
                      <span className="pml-duel-star" aria-hidden>
                        ★
                      </span>
                      <span className="pml-duel-rating-num">{guestRating.toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="pml-duel-rating-num">—</span>
                  )}
                </div>
                <div
                  className={`pml-duel-streak-wrap${
                    !guestRankedLoading && guestWinStreak != null && guestWinStreak > 0 ? '' : ' pml-duel-spacer'
                  }`}
                  aria-hidden={!(!guestRankedLoading && guestWinStreak != null && guestWinStreak > 0)}
                >
                  {!guestRankedLoading && guestWinStreak != null && guestWinStreak > 0 ? (
                    <div className="pml-duel-streak">
                      <span className="pml-duel-streak-flame" aria-hidden>
                        <IconFlame />
                      </span>
                      <span>Win Streak: {guestWinStreak}</span>
                    </div>
                  ) : null}
                </div>
              </>
            ) : pendingInviteActive && pendingInviteName ? (
              <>
                <div className="pml-duel-avatar-frame">
                  <div className="pml-duel-avatar pml-duel-avatar--pending" aria-hidden>
                    {pendingInviteName.slice(0, 2).toUpperCase()}
                  </div>
                </div>
                <div className="pml-duel-name pml-duel-name--awaiting">
                  <span className="pml-duel-name-text">@{pendingInviteName}</span>
                  <span className="pml-duel-awaiting-hint pml-duel-awaiting-hint--challenge">
                    Invite sent · waiting to join
                  </span>
                </div>
                <div className="pml-duel-rating pml-duel-spacer" aria-hidden />
                <div className="pml-duel-streak-wrap">
                  <span className="pml-duel-challenge-pill">{pendingChallenge?.matchSummary}</span>
                </div>
              </>
            ) : (
              <>
                <div className="pml-duel-avatar-frame">
                  <div className="pml-duel-avatar pml-duel-avatar--invite" aria-hidden>
                    <IconUserBust gradientId="pml-bust-invite" />
                    <span className="pml-duel-avatar-plus" aria-hidden>
                      <IconPlus />
                    </span>
                  </div>
                </div>
                <div className="pml-duel-name pml-duel-name--awaiting">
                  <span className="pml-duel-name-text">Invite Opponent</span>
                  <span className="pml-duel-awaiting-hint">Waiting for player…</span>
                </div>
                <div className="pml-duel-rating pml-duel-spacer" aria-hidden />
                <div className="pml-duel-streak-wrap pml-duel-spacer" aria-hidden />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}