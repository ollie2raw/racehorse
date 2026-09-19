import { useEffect, useState } from 'react';

type ReviewAccessResponse = { enabled: boolean };

/**
 * Reads the server-owned review cohort decision. The default is deliberately
 * false and every transport/shape failure stays false.
 *
 * Keep the API client dynamic: this hook is used by the eager match shell and
 * must not pull the Supabase client into plain-Node behavior-test runners.
 */
export function usePostGameReviewAccess(userId: string | null | undefined, authLoading = false): boolean {
  const [access, setAccess] = useState<{ userId: string; enabled: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (authLoading || !userId) return () => { cancelled = true; };

    void import('../../api/client.ts')
      .then(({ apiGet }) => apiGet<ReviewAccessResponse>('/api/game-reviews/access'))
      .then((result) => {
        if (!cancelled) {
          setAccess({
            userId,
            enabled: result.data?.enabled === true && !result.error,
          });
        }
      })
      .catch(() => {
        // Fail closed: access transport failures must not expose the review UI.
        if (!cancelled) setAccess({ userId, enabled: false });
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, userId]);

  return access?.userId === userId && access?.enabled === true;
}
