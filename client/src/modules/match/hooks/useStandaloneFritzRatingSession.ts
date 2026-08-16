import React, { useCallback, useEffect } from 'react';
import { createDeterministicDoubleSixDeal } from '@racehorse/game-core';
import type { BotMatchState } from '../runtime/botEngine.ts';
import { createBotMatchWithStarter, createFixedBotMatchWithStarter } from '../runtime/botEngine.ts';
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
  winningScore: number;
  dealSize: 7 | 14;
  activeLocalMatchId: string;
  accessTokenRef: React.MutableRefObject<string | null>;
  localPendingRegisteredRef: React.MutableRefObject<boolean>;
  localPendingResolvedRef: React.MutableRefObject<boolean>;
  matchRef: React.MutableRefObject<BotMatchState>;
  setMatch: (state: BotMatchState) => void;
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
  winningScore,
  dealSize,
  activeLocalMatchId,
  accessTokenRef,
  localPendingRegisteredRef,
  localPendingResolvedRef,
  matchRef,
  setMatch,
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
            winningScore,
            dealSize,
            matchStarter: matchRef.current.matchStarter ?? 'you',
          },
          accessTokenRef.current,
        );
        localPendingRegisteredRef.current = true;
        const matchId = typeof response?.matchId === 'string' ? response.matchId : null;
        if (matchId) {
          setVerifiedMatchId(matchId);
        }
        const seed = typeof response?.seed === 'string' ? response.seed.trim() : '';
        if (seed && !cancelled) {
          const live = matchRef.current;
          if (!live.handOpen && !live.gameOver) {
            const dealt = createDeterministicDoubleSixDeal({
              seed: `${seed}:h1`,
              tilesPerPlayer: dealSize,
              deadTileCount: dealSize === 14 ? 0 : 2,
            });
            setMatch({
              ...createFixedBotMatchWithStarter(
                {
                  player_tiles: dealt.playerTiles,
                  fritz_tiles: dealt.opponentTiles,
                  boneyard: dealt.boneyard,
                  locked: dealt.deadTiles,
                },
                live.matchStarter ?? 'you',
                winningScore,
                dealSize,
              ),
              dealSeed: seed,
            });
          }
        }
      } catch (err) {
        console.warn('[Fritz Pending] start failed', err);
        const live = matchRef.current;
        if (live.pendingDrawDeck && live.pendingDrawDeck.length === 26 && dealSize === 7) {
          setMatch(createBotMatchWithStarter(
            live.pendingDrawDeck,
            live.matchStarter ?? 'you',
            winningScore,
            dealSize,
          ));
        }
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
    winningScore,
    dealSize,
    isAuthoringMode,
    isGuidedMode,
    localPendingRegisteredRef,
    matchGameOver,
    matchRef,
    preGameDrawActive,
    setMatch,
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