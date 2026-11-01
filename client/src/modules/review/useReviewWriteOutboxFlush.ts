import { useEffect } from 'react';
import { sendGameRecord, type GameRecordBody } from './gameRecord.ts';
import { flushGameRecordOutbox } from './gameRecordOutbox.ts';
import { sendReviewWrite, type PostGameReviewWriteBody } from './postGameReviewWrite.ts';
import { flushReviewWriteOutbox } from './reviewWriteOutbox.ts';

/**
 * Deliver any finished game record or review that is still waiting in an outbox: on sign-in / app load, when the device
 * comes back online, and when the tab becomes visible again. Mount once, app-wide. Only the signed-in account's entries
 * are sent. The game record goes first: it is the source the review is derived from.
 */
export function useReviewWriteOutboxFlush(userId: string | null | undefined, accessToken: string | null | undefined): void {
  useEffect(() => {
    if (!userId || !accessToken) return;
    const flush = () => {
      void flushGameRecordOutbox<GameRecordBody>(userId, sendGameRecord)
        .finally(() => { void flushReviewWriteOutbox<PostGameReviewWriteBody>(userId, sendReviewWrite); });
    };
    flush();
    const onVisible = () => { if (document.visibilityState === 'visible') flush(); };
    window.addEventListener('online', flush);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId, accessToken]);
}
