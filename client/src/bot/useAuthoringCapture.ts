/**
 * useAuthoringCapture
 *
 * Manages lesson authoring capture state and persistence for BotMatchScreen.
 * Handles both V1 (step-based) and V2 (event-based) authoring pipelines.
 *
 * Activated only when isAuthoringMode or isAuthoringV2Mode is true.
 * When both are false, this hook is a no-op (all effects return early).
 *
 * Does not own game state — reads match as input, writes authoring
 * artifacts (steps, events, notes) as output.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { BotMatchState } from './botEngine';
import { serializeGhostBoardState, toTileKey } from '../ghost/logic';
import {
  AUTHORING_GAME_ID,
  AUTHORING_LESSON_ID,
  loadAuthoringSession,
  saveAuthoringSession,
  type AuthoredStep,
  type AuthoringSession,
} from '../learn/guidedAuthoring';
import {
  loadV2AuthoringSession,
  nextPlayerEvent,
  saveV2AuthoringSession,
  type LessonV2AuthoringSession,
  type LessonV2Event,
  type LessonV2HandStart,
} from '../learn/lessonV2';

export type UseAuthoringCaptureParams = {
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  match: BotMatchState;
  matchRef: RefObject<BotMatchState>;
  fritzSessionReplyRef: RefObject<Required<AuthoredStep>['fritzReplyEvents']>;
};

export function useAuthoringCapture({
  isAuthoringMode,
  isAuthoringV2Mode,
  match,
  matchRef,
  fritzSessionReplyRef,
}: UseAuthoringCaptureParams) {
  const [authoringSteps, setAuthoringSteps] = useState<AuthoredStep[]>(() => {
    if (!isAuthoringMode) return [];
    return loadAuthoringSession()?.steps ?? [];
  });
  const [authoringNoteText, setAuthoringNoteText] = useState('');
  /**
   * Snapshot captured at the START of each player turn.
   * stepIdx is locked here so Save-Note presses (which lengthen authoringSteps)
   * cannot shift the stepIndex used when the tile is eventually played.
   */
  const authoringPreMoveRef = useRef<{
    boardState: string;
    playerHand: string[];
    handNumber: number;
    matchStateJson: string;
    /** Step index frozen at turn-start — do NOT recompute from authoringSteps.length */
    stepIdx: number;
  } | null>(null);

  const [authoringV2Events, setAuthoringV2Events] = useState<LessonV2Event[]>(() => {
    if (!isAuthoringV2Mode) return [];
    return loadV2AuthoringSession()?.events ?? [];
  });
  const [authoringV2HandStarts, setAuthoringV2HandStarts] = useState<LessonV2HandStart[]>(() => {
    if (!isAuthoringV2Mode) return [];
    return loadV2AuthoringSession()?.handStarts ?? [];
  });
  /**
   * Next event index to assign.  We keep this in a ref so capture callbacks
   * don't need it as a stale dependency (state reads are always current).
   * Initialised from saved session length so we don't reuse indices on reload.
   */
  const authoringV2NextEventIndexRef = useRef<number>(
    isAuthoringV2Mode ? (loadV2AuthoringSession()?.events.length ?? 0) : 0,
  );
  /**
   * Stable creation timestamp for the V2 authoring session.
   * Preserved from the saved session on resume so repeated saves don't
   * overwrite the original createdAt with the current time.
   */
  const authoringV2CreatedAtRef = useRef<string>(
    isAuthoringV2Mode
      ? (loadV2AuthoringSession()?.createdAt ?? new Date().toISOString())
      : '',
  );
  /**
   * Mirror of authoringV2Events kept in a ref so the bot-effect capture
   * callback can always read the current length without a stale closure.
   */
  const authoringV2EventsRef = useRef<LessonV2Event[]>([]);

  // ── Authoring: capture pre-move snapshot when player's turn starts ────────
  useEffect(() => {
    if (!isAuthoringMode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    // IMPORTANT: compute stepIdx HERE (at turn-start) and lock it into the ref.
    // Both recordAuthoringStep and saveAuthoringNoteOnly must use pre.stepIdx,
    // NOT authoringSteps.length at call-time — which shifts after every Save-Note press.
    const stepIdx = authoringSteps.length;
    authoringPreMoveRef.current = {
      boardState: serializeGhostBoardState(match.board),
      playerHand: match.players.you.hand.map(toTileKey),
      handNumber: match.handNumber,
      matchStateJson: JSON.stringify(match),
      stepIdx,
    };
    // Load any existing note for this step index (handles reload mid-session)
    const existing = authoringSteps.find((s) => s.stepIndex === stepIdx);
    setAuthoringNoteText(existing?.coachingText ?? '');
    // NOTE: Do NOT clear fritzSessionReplyRef here. The ref holds Fritz's reply
    // events from the bot turn that just finished, and those events need to be
    // flushed into the PREVIOUS authored step by the flush effect below.
  }, [isAuthoringMode, match.currentPlayer, match.handNumber, match.handOver, match.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isAuthoringV2Mode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return;
    const nextPlayerPlayEvent = nextPlayerEvent(authoringV2Events, authoringV2Events.length);
    setAuthoringNoteText(nextPlayerPlayEvent?.actor === 'player' && nextPlayerPlayEvent.action === 'play'
      ? nextPlayerPlayEvent.coachingText ?? ''
      : '');
  }, [
    isAuthoringV2Mode,
    authoringV2Events,
    match.currentPlayer,
    match.handOver,
    match.gameOver,
  ]);

  // ── Authoring: flush captured Fritz reply events into the previous step ──
  // When player's turn resumes after Fritz played, the fritzSessionReplyRef
  // holds the complete sequence of Fritz's reply events. Those events belong
  // to the most recently recorded authored step (the step whose move Fritz
  // was responding to). We attach them here and then clear the ref so the
  // next Fritz chain starts fresh.
  useEffect(() => {
    if (!isAuthoringMode) return;
    if (match.currentPlayer !== 'you') return;
    if (fritzSessionReplyRef.current.length === 0) return;
    const events = [...fritzSessionReplyRef.current];
    fritzSessionReplyRef.current = [];
    setAuthoringSteps((prev) => {
      if (prev.length === 0) return prev;
      // Find the most recent real (non-draft) step and attach the events there.
      let targetIdx = -1;
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i]!.chosenMove !== null) {
          targetIdx = i;
          break;
        }
      }
      if (targetIdx === -1) return prev;
      const target = prev[targetIdx]!;
      const updated: AuthoredStep = { ...target, fritzReplyEvents: events };
      const next = [...prev];
      next[targetIdx] = updated;
      console.log('[guided-capture] flush', {
        flushedToStepIndex: target.stepIndex,
        count: events.length,
        stepHasEventsAfterFlush:
          Array.isArray(updated.fritzReplyEvents) && updated.fritzReplyEvents.length > 0,
      });
      return next;
    });
  }, [isAuthoringMode, match.currentPlayer, match.handNumber, match.handOver, match.gameOver]);

  // ── Authoring V1: persist session to localStorage on every steps change ─────
  useEffect(() => {
    if (!isAuthoringMode) return;
    const session: AuthoringSession = {
      lessonId: AUTHORING_LESSON_ID,
      fixedGameId: AUTHORING_GAME_ID,
      steps: authoringSteps,
      currentStepIndex: authoringSteps.length,
      matchSnapshot: JSON.stringify(matchRef.current),
    };
    saveAuthoringSession(session);
  }, [isAuthoringMode, authoringSteps]);

  // ── Authoring V2: keep events ref in sync ────────────────────────────────
  useEffect(() => {
    authoringV2EventsRef.current = authoringV2Events;
  }, [authoringV2Events]);

  // ── Authoring V2: persist session to localStorage on every events change ──
  useEffect(() => {
    if (!isAuthoringV2Mode) return;
    const session: LessonV2AuthoringSession = {
      lessonId: AUTHORING_LESSON_ID,
      gameId: AUTHORING_GAME_ID,
      // Preserve the original createdAt; only update updatedAt on each save
      createdAt: authoringV2CreatedAtRef.current,
      updatedAt: new Date().toISOString(),
      handStarts: authoringV2HandStarts,
      events: authoringV2Events,
      matchSnapshot: JSON.stringify(matchRef.current),
      lastEventIndex: authoringV2Events.length - 1,
    };
    saveV2AuthoringSession(session);
  }, [isAuthoringV2Mode, authoringV2Events, authoringV2HandStarts, match]);

  // ── Authoring V2: capture LessonV2HandStart when a new hand begins ───────
  // Fires when match.handNumber changes and the hand is live (not over).
  // Uses match directly since matchRef is updated in a separate effect.
  useEffect(() => {
    if (!isAuthoringV2Mode || match.handOver || match.gameOver) return;
    setAuthoringV2HandStarts((prev) => {
      if (prev.some((h) => h.handNumber === match.handNumber)) return prev;
      const handStart: LessonV2HandStart = {
        handNumber: match.handNumber,
        matchStateJson: JSON.stringify(match),
        firstEventIndex: authoringV2EventsRef.current.length,
      };
      console.log('[v2-capture] hand start', { handNumber: match.handNumber, firstEventIndex: handStart.firstEventIndex });
      return [...prev, handStart];
    });
  }, [isAuthoringV2Mode, match.handNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Authoring V2: capture LessonV2HandStart when a new hand begins ───────
  // Fires when match.handNumber changes and the hand is live (not over).
  // Uses match directly since matchRef is updated in a separate effect.
  useEffect(() => {
    if (!isAuthoringV2Mode || match.handOver || match.gameOver) return;
    setAuthoringV2HandStarts((prev) => {
      if (prev.some((h) => h.handNumber === match.handNumber)) return prev;
      const handStart: LessonV2HandStart = {
        handNumber: match.handNumber,
        matchStateJson: JSON.stringify(match),
        firstEventIndex: authoringV2EventsRef.current.length,
      };
      console.log('[v2-capture] hand start', { handNumber: match.handNumber, firstEventIndex: handStart.firstEventIndex });
      return [...prev, handStart];
    });
  }, [isAuthoringV2Mode, match.handNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    authoringSteps,
    setAuthoringSteps,
    authoringNoteText,
    setAuthoringNoteText,
    authoringV2Events,
    setAuthoringV2Events,
    authoringV2HandStarts,
    setAuthoringV2HandStarts,
    authoringPreMoveRef,
    authoringV2NextEventIndexRef,
  };
}
