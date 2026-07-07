import React, { useCallback, useEffect } from 'react';
import type { BotMatchState } from '../runtime/botEngine.ts';
import { abandonLocalBotMatch, startLocalBotMatch } from '../api/botMatchApi.ts';
import { resolveGameServerUrl } from '../../../lib/gameServerUrl';
import { supabase } from '../../../lib/supabase';

type UseStandaloneFritzRatingSessionArgs = {
  enabled: boolean;
  userId: string | null | undefined;
  preGameDrawActive: boolean;
  matchGameOver: boolean;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  fritzTier: string;
  activeLocalMatchId: string;
  accessTokenRef: React.MutableRefObject<string | null>;
  localPendingRegisteredRef: React.MutableRefObject<boolean>;
  localPendingResolvedRef: React.MutableRefObject<boolean>;
  matchRef: React.MutableRefObject<BotMatchState>;
  setVerifiedMatchId: (matchId: string) => void;
  setResultLoading: (loading: boolean) => void;
  setResultError: (error: string | null) => void;
};

type UseStandaloneFritzRatingSessionResult = {
  abandonStandaloneFritzMatch: (useBeacon?: boolean) => Promise<void>;
};

export function useStandaloneFritzRatingSession({
  enabled,
  userId,
  preGameDrawActive,
  matchGameOver,
  isGuidedMode,
  isAuthoringMode,
  fritzTier,
  activeLocalMatchId,
  accessTokenRef,
  localPendingRegisteredRef,
  localPendingResolvedRef,
  matchRef,
  setVerifiedMatchId,
  setResultLoading,
  setResultError,
}: UseStandaloneFritzRatingSessionArgs): UseStandaloneFritzRatingSessionResult {
  const abandonStandaloneFritzMatch = useCallback(
    async (useBeacon = false) => {
      if (!enabled || !userId || localPendingResolvedRef.current) return;
      const live = matchRef.current;
      const payload = {
        userId,
        localMatchId: activeLocalMatchId,
        accessToken: accessTokenRef.current,
        youScore: live.players.you.score,
        botScore: live.players.bot.score,
      };
      localPendingResolvedRef.current = true;
      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon(`${resolveGameServerUrl()}/api/bot-matches/local/abandon`, blob);
        return;
      }
      await abandonLocalBotMatch(payload, accessTokenRef.current, { keepalive: true });
    },
    [activeLocalMatchId, accessTokenRef, enabled, localPendingResolvedRef, matchRef, userId],
  );

  useEffect(() => {
    if (!enabled || !userId) return;
    if (preGameDrawActive) return;
    let cancelled = false;
    void (async () => {
      if (supabase) {
        try {
          const { data } = await supabase.auth.getSession();
          accessTokenRef.current = data.session?.access_token ?? null;
        } catch {
          accessTokenRef.current = null;
        }
      }
      if (cancelled || localPendingRegisteredRef.current) return;
      if (isGuidedMode || isAuthoringMode) return;
      try {
        const response = await startLocalBotMatch(
          {
            userId,
            fritzTier,
            localMatchId: activeLocalMatchId,
          },
          accessTokenRef.current,
        );
        localPendingRegisteredRef.current = true;
        const matchId = typeof response?.matchId === 'string' ? response.matchId : null;
        if (matchId) {
          setVerifiedMatchId(matchId);
        }
      } catch (err) {
        console.warn('[Fritz Pending] start failed', err);
        if (matchRef.current.gameOver) {
          setResultLoading(false);
          setResultError(err instanceof Error ? err.message : 'Rating session failed to start.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    accessTokenRef,
    activeLocalMatchId,
    enabled,
    fritzTier,
    isAuthoringMode,
    isGuidedMode,
    localPendingRegisteredRef,
    matchGameOver,
    matchRef,
    preGameDrawActive,
    setResultError,
    setResultLoading,
    setVerifiedMatchId,
    userId,
  ]);

  useEffect(() => {
    if (!enabled || matchGameOver) return;
    const handlePageHide = () => {
      void abandonStandaloneFritzMatch(true);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [abandonStandaloneFritzMatch, enabled, matchGameOver]);

  return { abandonStandaloneFritzMatch };
}