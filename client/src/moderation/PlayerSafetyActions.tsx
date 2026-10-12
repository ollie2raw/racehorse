import { useEffect, useState } from 'react';
import { blockUser, fetchBlockedUserIds, reportUser, unblockUser } from './moderationApi';
import { REPORT_CATEGORIES, type ReportCategory } from './moderationTypes';

type Props = {
  /** The other player. Never rendered for the viewer's own profile. */
  subjectUserId: string;
  subjectUsername: string;
  onToast: (message: string) => void;
  onBlockedChange?: (blocked: boolean) => void;
};

type Panel = 'none' | 'report' | 'confirm-block';

/**
 * Report and Block for another player's profile — the App Store Guideline 1.2
 * controls. Reports are a fixed category (no typed text). Blocking stops friend
 * requests and invites between the two players, ends any friendship, keeps them
 * out of each other's Quick Match and private rooms, and hides the blocked
 * player from the viewer's activity feed.
 */
export function PlayerSafetyActions({ subjectUserId, subjectUsername, onToast, onBlockedChange }: Props) {
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchBlockedUserIds().then((ids) => {
      if (cancelled) return;
      const isBlocked = ids.includes(subjectUserId);
      setBlocked(isBlocked);
      onBlockedChange?.(isBlocked);
    });
    return () => {
      cancelled = true;
    };
  }, [subjectUserId, onBlockedChange]);

  const sendReport = async (category: ReportCategory) => {
    setBusy(true);
    const { error } = await reportUser({ reportedUserId: subjectUserId, category, source: 'profile' });
    setBusy(false);
    setPanel('none');
    onToast(error ? 'Couldn’t send the report. Try again later.' : 'Report sent. Thanks for letting us know.');
  };

  const toggleBlock = async () => {
    setBusy(true);
    const next = !blocked;
    const { error } = next ? await blockUser(subjectUserId) : await unblockUser(subjectUserId);
    setBusy(false);
    setPanel('none');
    if (error) {
      onToast(next ? 'Couldn’t block this player.' : 'Couldn’t unblock this player.');
      return;
    }
    setBlocked(next);
    onBlockedChange?.(next);
    onToast(next ? `${subjectUsername} is blocked.` : `${subjectUsername} is unblocked.`);
  };

  return (
    <section className="rh-pp-safety" aria-label="Player safety">
      {panel === 'none' && (
        <div className="rh-pp-safety__row">
          <button type="button" className="rh-pp-safety__link" onClick={() => setPanel('report')}>
            Report
          </button>
          {blocked !== null && (
            <button
              type="button"
              className="rh-pp-safety__link"
              disabled={busy}
              onClick={() => (blocked ? void toggleBlock() : setPanel('confirm-block'))}
            >
              {blocked ? 'Unblock' : 'Block'}
            </button>
          )}
        </div>
      )}

      {panel === 'report' && (
        <div className="rh-pp-safety__panel">
          <p className="rh-pp-safety__note">Why are you reporting {subjectUsername}?</p>
          <div className="rh-pp-safety__choices">
            {REPORT_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                className="rh-pp-safety__choice"
                disabled={busy}
                onClick={() => void sendReport(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" className="rh-pp-safety__link" onClick={() => setPanel('none')}>
            Cancel
          </button>
        </div>
      )}

      {panel === 'confirm-block' && (
        <div className="rh-pp-safety__panel">
          <p className="rh-pp-safety__note">
            Block {subjectUsername}? You won’t be friends, neither of you can send the other friend requests or
            invites, and you won’t be matched together in Quick Match. You can unblock later.
          </p>
          <div className="rh-pp-safety__choices">
            <button type="button" className="rh-pp-safety__choice" disabled={busy} onClick={() => void toggleBlock()}>
              Block
            </button>
            <button type="button" className="rh-pp-safety__link" onClick={() => setPanel('none')}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
