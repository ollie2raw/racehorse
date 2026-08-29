/**
 * useMatchUiChrome
 *
 * Manages UI chrome state for BotMatchScreen — fullscreen, mute,
 * score track overlay, leave confirm modal, and coach tip expansion.
 *
 * Contains no game logic and no mode branching.
 * All state here is pure UI preference/toggle state.
 */

import { useEffect, useState, type RefObject } from 'react';
import { logLayoutDebug } from '../match/layoutDebug';
import { useMutePreference } from '../utils/useMutePreference';

export type MatchUiChromeLayoutRefs = {
  rootRef: RefObject<HTMLDivElement | null>;
  boardStageRef: RefObject<HTMLDivElement | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
};

export function useMatchUiChrome(layoutRefs: MatchUiChromeLayoutRefs) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useMutePreference();
  const [scoreTrackOpen, setScoreTrackOpen] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showFullCoachTip, setShowFullCoachTip] = useState(false);

  useEffect(() => {
    logLayoutDebug(showLeaveConfirm ? 'leave-open' : 'leave-close', {
      rootRef: layoutRefs.rootRef,
      boardStageRef: layoutRefs.boardStageRef,
      handAreaRef: layoutRefs.handAreaRef,
    });
  }, [showLeaveConfirm, layoutRefs.rootRef, layoutRefs.boardStageRef, layoutRefs.handAreaRef]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    onChange();
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return {
    isFullscreen,
    isMuted,
    setIsMuted,
    scoreTrackOpen,
    setScoreTrackOpen,
    showLeaveConfirm,
    setShowLeaveConfirm,
    showFullCoachTip,
    setShowFullCoachTip,
  };
}
