import { useEffect } from 'react';
import { sendReviewWrite, type PostGameReviewWriteBody } from './postGameReviewWrite.ts';
import { flushReviewWriteOutbox } from './reviewWriteOutbox.ts';

/**
 * Deliver any finished review that is still waiting in the outbox: on sign-in / app load, when the device comes back
 * online, and when the tab becomes visible again. Mount once, app-wide. Only the signed-in account's entries are sent.
 */
export function useReviewWriteOutboxFlush(userId: string | null | undefined, accessToken: string | null | undefined): void {
  useEffect(() => {
    if (!userId || !accessToken) return;
    const flush = () => { void flushReviewWriteOutbox<PostGameReviewWriteBody>(userId, sendReviewWrite); };
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
