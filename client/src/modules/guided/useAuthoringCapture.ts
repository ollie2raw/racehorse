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

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Tile } from '../../types.ts';
import type { GhostResolvedMove } from '../ghost/ghostContracts.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import { serializeGhostBoardState } from '../ghost/ghostMoveLogic.ts';
import type { BotActionResult, BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import {
  AUTHORING_GAME_ID,
  AUTHORING_LESSON_ID,
  loadAuthoringSession,
  saveAuthoringSession,
  type AuthoredStep,
  type AuthoringSession,
} from '../../learn/guidedAuthoring.ts';
import type {
  LessonV2AuthoringSession,
  LessonV2Event,
  LessonV2HandStart,
} from '../../learn/lessonV2.ts';
import { reportOptionalChunkFailure } from '../../utils/optionalChunk';

type LessonV2Api = typeof import('../../learn/lessonV2.ts');
type CreateV2EventArgs = Parameters<LessonV2Api['createV2Event']>[0];

export type AuthoringFritzCapturePayload = {
  result: BotActionResult;
  captureAction: 'play' | 'draw' | 'pass';
  playedTileForHighlight: Tile | null;
  ghostChosen: GhostResolvedMove | null;
  chosen: BotChoice | null;
};

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

  const [authoringV2Events, setAuthoringV2Events] = useState<LessonV2Event[]>([]);
  const [authoringV2HandStarts, setAuthoringV2HandStarts] = useState<LessonV2HandStart[]>([]);
  const lessonV2ApiRef = useRef<LessonV2Api | null>(null);
  /**
   * Next event index to assign.  We keep this in a ref so capture callbacks
   * don't need it as a stale dependency (state reads are always current).
   * Initialised from saved session length so we don't reuse indices on reload.
   */
  const authoringV2NextEventIndexRef = useRef<number>(0);
  /**
   * Stable creation timestamp for the V2 authoring session.
   * Preserved from the saved session on resume so repeated saves don't
   * overwrite the original createdAt with the current time.
   */
  const authoringV2CreatedAtRef = useRef<string>('');
  /**
   * Mirror of authoringV2Events kept in a ref so the bot-effect capture
   * callback can always read the current length without a stale closure.
   */
  const authoringV2EventsRef = useRef<LessonV2Event[]>([]);

  useEffect(() => {
    if (!isAuthoringV2Mode) {
      lessonV2ApiRef.current = null;
      setAuthoringV2Events([]);
      setAuthoringV2HandStarts([]);
      authoringV2NextEventIndexRef.current = 0;
      authoringV2CreatedAtRef.current = '';
      return;
    }

    let cancelled = false;
    void import('../../learn/lessonV2.ts').then((api) => {
      if (cancelled) return;
      lessonV2ApiRef.current = api;
      const saved = api.loadV2AuthoringSession();
      setAuthoringV2Events(saved?.events ?? []);
      setAuthoringV2HandStarts(saved?.handStarts ?? []);
      authoringV2NextEventIndexRef.current = saved?.events.length ?? 0;
      authoringV2CreatedAtRef.current = saved?.createdAt ?? new Date().toISOString();
    })
      .catch((error) => reportOptionalChunkFailure('learn/lessonV2', error));

    return () => {
      cancelled = true;
    };
  }, [isAuthoringV2Mode]);

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
    const nextPlayerPlayEvent = lessonV2ApiRef.current?.nextPlayerEvent(
      authoringV2Events,
      authoringV2Events.length,
    );
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
    lessonV2ApiRef.current?.saveV2AuthoringSession(session);
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

  /**
   * Authoring: record the current player turn as an authored step.
   * Called whenever the player completes an action (play, draw-to-pass, pass).
   */
  const recordAuthoringStep = useCallback(
    (chosenMove: string | null) => {
      if (!isAuthoringMode) return;
      const pre = authoringPreMoveRef.current;
      const stepIdx = pre?.stepIdx ?? authoringSteps.length;
      const newStep: AuthoredStep = {
        stepIndex: stepIdx,
        handNumber: pre?.handNumber ?? match.handNumber,
        boardState: pre?.boardState ?? serializeGhostBoardState(match.board),
        playerHand: pre?.playerHand ?? match.players.you.hand.map(toTileKey),
        chosenMove,
        coachingText: authoringNoteText,
        fritzReplyEvents: [],
        matchStateJson: pre?.matchStateJson ?? null,
      };
      console.log('[guided-capture] authored step created', {
        stepIndex: stepIdx,
        chosenMove,
        handNumber: newStep.handNumber,
      });
      const pendingEvents =
        fritzSessionReplyRef.current.length > 0 ? [...fritzSessionReplyRef.current] : null;
      fritzSessionReplyRef.current = [];
      setAuthoringSteps((prev) => {
        let base = prev;
        if (pendingEvents) {
          let targetIdx = -1;
          for (let i = base.length - 1; i >= 0; i -= 1) {
            if (base[i]!.chosenMove !== null) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx !== -1) {
            const target = base[targetIdx]!;
            const updated: AuthoredStep = { ...target, fritzReplyEvents: pendingEvents };
            base = [...base];
            base[targetIdx] = updated;
            console.log('[guided-capture] pre-flush fritz reply events', {
              stepIndex: target.stepIndex,
              eventCount: pendingEvents.length,
            });
          }
        }
        const existingIdx = base.findIndex((s) => s.stepIndex === stepIdx);
        if (existingIdx >= 0) {
          const next = [...base];
          next[existingIdx] = {
            ...next[existingIdx],
            ...newStep,
            fritzReplyEvents: next[existingIdx]?.fritzReplyEvents ?? newStep.fritzReplyEvents,
          };
          return next;
        }
        return [...base, newStep];
      });
    },
    [isAuthoringMode, authoringSteps.length, authoringNoteText, match.handNumber, match.board, match.players.you.hand],
  );

  /** Authoring: save the current textarea note without recording a chosen move. */
  const saveAuthoringNoteOnly = useCallback(() => {
    if (!isAuthoringMode) return;
    const pre = authoringPreMoveRef.current;
    const stepIdx = pre?.stepIdx ?? authoringSteps.length;
    const draftStep: AuthoredStep = {
      stepIndex: stepIdx,
      handNumber: pre?.handNumber ?? match.handNumber,
      boardState: pre?.boardState ?? serializeGhostBoardState(match.board),
      playerHand: pre?.playerHand ?? match.players.you.hand.map(toTileKey),
      chosenMove: null,
      coachingText: authoringNoteText,
    };
    setAuthoringSteps((prev) => {
      const existingIdx = prev.findIndex((s) => s.stepIndex === stepIdx);
      if (existingIdx >= 0) {
        const next = [...prev];
        next[existingIdx] = draftStep;
        return next;
      }
      return [...prev, draftStep];
    });
  }, [isAuthoringMode, authoringSteps.length, authoringNoteText, match.handNumber, match.board, match.players.you.hand]);

  const handleAuthoringFritzActionCaptured = useCallback((capture: AuthoringFritzCapturePayload) => {
    const { result, captureAction, playedTileForHighlight, ghostChosen, chosen } = capture;
    fritzSessionReplyRef.current.push({
      type: captureAction,
      tile: playedTileForHighlight ? toTileKey(playedTileForHighlight) : undefined,
      position: ghostChosen?.position ?? (chosen?.move?.type === 'play' ? chosen.move.position : undefined),
      scoreDelta: result.scored?.points ?? 0,
      pointsScored: result.scored?.points ?? 0,
      runningScore: result.state.players.bot.score,
      turnContinues: result.state.currentPlayer === 'bot',
      handOver: result.state.handOver,
      gameOver: result.state.gameOver,
      boardAfter: serializeGhostBoardState(result.state.board),
      botHandAfter: result.state.players.bot.hand.map(toTileKey),
      playerHandAfter: result.state.players.you.hand.map(toTileKey),
      handEnded: result.handEnded ? {
        winner: result.handEnded.winner,
        reason: result.handEnded.reason,
        pointsAwarded: result.handEnded.pointsAwarded,
        loserPips: result.handEnded.loserPips,
        calcText: result.handEnded.calcText,
      } : undefined,
    });
    let targetStepIdx = -1;
    for (let i = authoringSteps.length - 1; i >= 0; i -= 1) {
      if (authoringSteps[i]!.chosenMove !== null) {
        targetStepIdx = authoringSteps[i]!.stepIndex;
        break;
      }
    }
    console.log('[guided-capture] push', {
      stepIndexTarget: targetStepIdx,
      currentPlayer: result.state.currentPlayer,
      action: captureAction,
      tile: playedTileForHighlight ? toTileKey(playedTileForHighlight) : undefined,
      pendingCount: fritzSessionReplyRef.current.length,
    });
  }, [authoringSteps, fritzSessionReplyRef]);

  const handleAuthoringV2FritzEvent = useCallback((capture: AuthoringFritzCapturePayload) => {
    const { result, captureAction, playedTileForHighlight, ghostChosen, chosen } = capture;
    const eventIndex = authoringV2NextEventIndexRef.current++;
    const api = lessonV2ApiRef.current;
    if (!api) return;
    const v2event = api.createV2Event({
      result,
      handNumber: matchRef.current.handNumber,
      actor: 'fritz',
      action: captureAction,
      tile: playedTileForHighlight ?? undefined,
      position: ghostChosen?.position ?? (chosen?.move?.type === 'play' ? chosen.move.position : undefined),
      eventIndex,
    });
    setAuthoringV2Events((prev) => [...prev, v2event]);
    console.log('[v2-capture] fritz', { eventIndex, action: captureAction, tile: v2event.tile });
  }, [matchRef, setAuthoringV2Events, authoringV2NextEventIndexRef]);

  const createV2Event = useCallback((args: CreateV2EventArgs) => {
    if (!isAuthoringV2Mode) {
      throw new Error('[useAuthoringCapture] createV2Event called outside authoring V2 mode');
    }
    const api = lessonV2ApiRef.current;
    if (!api) {
      throw new Error('[useAuthoringCapture] lessonV2 API is not loaded');
    }
    return api.createV2Event(args);
  }, [isAuthoringV2Mode]);

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
    recordAuthoringStep,
    saveAuthoringNoteOnly,
    handleAuthoringFritzActionCaptured,
    handleAuthoringV2FritzEvent,
    createV2Event,
  };
}
