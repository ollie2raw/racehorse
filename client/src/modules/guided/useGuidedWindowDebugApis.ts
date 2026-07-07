import { useEffect } from 'react';
import {
  applyPlayMove,
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import { parseTileKey } from '../../game/tileKeys.ts';
import { tileEquals } from '../../game/tileUtils.ts';
import {
  exportFrozenLessonAudit,
  exportFrozenLessonBoardDiffs,
  buildOriginalTranscriptDraftFromFrozenLesson,
  saveOriginalGuidedTranscript,
  saveOriginalGuidedTranscriptDraft,
  clearOriginalGuidedTranscriptDraft,
  loadOriginalGuidedTranscriptDraft,
  type FrozenLesson,
  type FrozenLessonAudit,
  type FrozenLessonBoardDiff,
  type GuidedReplyEvent,
  type GuidedTranscript,
  type GuidedTranscriptDraft,
  type GuidedTranscriptMove,
  type GuidedTurn,
} from '../../learn/guidedAuthoring.ts';
import { logger } from '../../utils/logger.ts';
import { playTileSound, queueSound } from '../../utils/sound.ts';
import type { Move, Tile } from '../../types.ts';

export type UseGuidedWindowDebugApisArgs = {
  isLearnAcademyMode: boolean;
  isAuthoringMode: boolean;
  isGuidedMode: boolean;
  frozenLesson: FrozenLesson | null;
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  guidedInitSourceRef: React.MutableRefObject<
    'full-matchStateJson' | 'reduced-snapshot' | 'seeded-deal' | 'random' | null
  >;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  notifyBotActionResult: (result: BotActionResult) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  isMuted: boolean;
  userPlayMoves: Move[];
};

export function useGuidedWindowDebugApis(args: UseGuidedWindowDebugApisArgs): void {
  const {
    isLearnAcademyMode,
    isAuthoringMode,
    isGuidedMode,
    frozenLesson,
    match,
    matchRef,
    guidedInitSourceRef,
    setMatch,
    notifyBotActionResult,
    flashLastPlayed,
    isMuted,
    userPlayMoves,
  } = args;

  useEffect(() => {
    if (typeof window === 'undefined' || !isLearnAcademyMode) return;

    type GuidedFrozenAuditApi = {
      exportFrozenLessonAudit: () => FrozenLessonAudit | null;
      printFrozenLessonAudit: () => FrozenLessonAudit | null;
      exportFrozenLessonBoardDiffs: () => FrozenLessonBoardDiff[];
      printFrozenLessonBoardDiffs: () => FrozenLessonBoardDiff[];
      exportFrozenLessonTranscriptSkeleton: () => GuidedTranscriptDraft | null;
    };

    const win = window as typeof window & {
      __guidedFrozenAudit?: GuidedFrozenAuditApi;
    };

    const api: GuidedFrozenAuditApi = {
      exportFrozenLessonAudit: () => exportFrozenLessonAudit(frozenLesson),
      printFrozenLessonAudit: () => {
        const audit = exportFrozenLessonAudit(frozenLesson);
        console.log('[guided-frozen-audit]', audit);
        return audit;
      },
      exportFrozenLessonBoardDiffs: () => exportFrozenLessonBoardDiffs(frozenLesson),
      printFrozenLessonBoardDiffs: () => {
        const diffs = exportFrozenLessonBoardDiffs(frozenLesson);
        console.log('[guided-frozen-board-diffs]', diffs);
        return diffs;
      },
      exportFrozenLessonTranscriptSkeleton: () => {
        const draft = buildOriginalTranscriptDraftFromFrozenLesson(frozenLesson);
        console.log('[guided-frozen-transcript-skeleton]', draft);
        return draft;
      },
    };

    win.__guidedFrozenAudit = api;
    console.log('[guided-frozen-audit] ready on window.__guidedFrozenAudit');

    return () => {
      delete win.__guidedFrozenAudit;
    };
  }, [isLearnAcademyMode, frozenLesson]);

  useEffect(() => {
    if (typeof window === 'undefined' || !isAuthoringMode) return;

    type GuidedTranscriptAuthoringApi = {
      startFromCurrentMatch: (lessonId?: string) => GuidedTranscriptDraft;
      beginTurn: (input: { expectedPlayerMove: GuidedTranscriptMove; coachingText: string }) => GuidedTranscriptDraft | null;
      capturePlayerStateAfter: () => GuidedTranscriptDraft | null;
      recordFritzReply: (input: Omit<GuidedReplyEvent, 'runningPlayerScore' | 'runningFritzScore' | 'stateAfter'>) => GuidedTranscriptDraft | null;
      applyScriptedFritzMove: (input: { tile: string; position?: string }) => GuidedTranscriptDraft | null;
      applyScriptedFritzPass: () => GuidedTranscriptDraft | null;
      finishTurn: () => GuidedTranscriptDraft | null;
      exportDraft: () => GuidedTranscript | null;
      publishDraft: () => GuidedTranscript | null;
      clearDraft: () => void;
    };

    const win = window as typeof window & {
      __guidedTranscriptAuthoring?: GuidedTranscriptAuthoringApi;
    };

    const getDraft = (): GuidedTranscriptDraft | null => loadOriginalGuidedTranscriptDraft();
    const saveDraft = (draft: GuidedTranscriptDraft): GuidedTranscriptDraft => {
      saveOriginalGuidedTranscriptDraft(draft);
      return draft;
    };
    const recordReplyIntoDraft = (
      input: Omit<GuidedReplyEvent, 'runningPlayerScore' | 'runningFritzScore' | 'stateAfter'>,
      stateAfter: BotMatchState,
    ): GuidedTranscriptDraft | null => {
      const draft = getDraft();
      if (!draft || draft.activeStepIndex == null) return null;
      const reply: GuidedReplyEvent = {
        ...input,
        runningPlayerScore: stateAfter.players.you.score,
        runningFritzScore: stateAfter.players.bot.score,
        stateAfter: JSON.stringify(stateAfter),
      };
      draft.transcript.turns = draft.transcript.turns.map((turn) =>
        turn.stepIndex === draft.activeStepIndex
          ? { ...turn, fritzReplies: [...turn.fritzReplies, reply] }
          : turn,
      );
      return saveDraft(draft);
    };

    win.__guidedTranscriptAuthoring = {
      startFromCurrentMatch: (lessonId = 'original-coached') => {
        const draft: GuidedTranscriptDraft = {
          transcript: {
            lessonId,
            version: 'v1-explicit',
            initialState: JSON.stringify(matchRef.current),
            turns: [],
          },
          activeStepIndex: null,
        };
        return saveDraft(draft);
      },
      beginTurn: ({ expectedPlayerMove, coachingText }) => {
        const draft = getDraft();
        if (!draft) return null;
        const nextStepIndex = draft.transcript.turns.length;
        const turn: GuidedTurn = {
          stepIndex: nextStepIndex,
          handNumber: matchRef.current.handNumber,
          coachingText,
          stateBefore: JSON.stringify(matchRef.current),
          expectedPlayerMove,
          playerStateAfter: '',
          fritzReplies: [],
        };
        draft.transcript.turns = [...draft.transcript.turns, turn];
        draft.activeStepIndex = nextStepIndex;
        return saveDraft(draft);
      },
      capturePlayerStateAfter: () => {
        const draft = getDraft();
        if (!draft || draft.activeStepIndex == null) return null;
        draft.transcript.turns = draft.transcript.turns.map((turn) =>
          turn.stepIndex === draft.activeStepIndex
            ? { ...turn, playerStateAfter: JSON.stringify(matchRef.current) }
            : turn,
        );
        return saveDraft(draft);
      },
      recordFritzReply: (input) => recordReplyIntoDraft(input, matchRef.current),
      applyScriptedFritzMove: ({ tile, position }) => {
        const parsedTile = parseTileKey(tile);
        if (!parsedTile) return null;
        const botState: BotMatchState = {
          ...matchRef.current,
          currentPlayer: 'bot',
        };
        const move =
          asPlayMoves(getLegalMoves(botState, 'bot')).find(
            (candidate) =>
              candidate.tile &&
              tileEquals(candidate.tile, parsedTile) &&
              (position ? candidate.position === position : true),
          ) ?? null;
        if (!move?.tile) return null;
        const result = applyPlayMove(botState, 'bot', move);
        setMatch(result.state);
        notifyBotActionResult(result);
        flashLastPlayed(move.tile);
        queueSound(() => playTileSound('deal', isMuted), 0);
        return recordReplyIntoDraft({
          type: 'play',
          tile,
          position: move.position ?? undefined,
          pointsScored: result.scored?.player === 'bot' ? result.scored.points : 0,
          handEnded: result.handEnded,
        }, result.state);
      },
      applyScriptedFritzPass: () => {
        const botState: BotMatchState = {
          ...matchRef.current,
          currentPlayer: 'bot',
        };
        const result = passTurn(botState, 'bot');
        setMatch(result.state);
        notifyBotActionResult(result);
        return recordReplyIntoDraft({
          type: 'pass',
          pointsScored: 0,
          handEnded: result.handEnded,
        }, result.state);
      },
      finishTurn: () => {
        const draft = getDraft();
        if (!draft) return null;
        draft.activeStepIndex = null;
        return saveDraft(draft);
      },
      exportDraft: () => getDraft()?.transcript ?? null,
      publishDraft: () => {
        const draft = getDraft();
        if (!draft) return null;
        saveOriginalGuidedTranscript(draft.transcript);
        return draft.transcript;
      },
      clearDraft: () => {
        clearOriginalGuidedTranscriptDraft();
      },
    };

    console.log('[guided-transcript-authoring] ready on window.__guidedTranscriptAuthoring');

    return () => {
      delete win.__guidedTranscriptAuthoring;
    };
  }, [isAuthoringMode, flashLastPlayed, isMuted, matchRef, setMatch, userPlayMoves, notifyBotActionResult]);

  useEffect(() => {
    if (!isGuidedMode) return;
    console.log(
      '[guided-debug] final rendered match hand =',
      match.players.you.hand.map((t) => `${t.low}|${t.high}`),
    );
    console.log(
      '[guided-debug] init source =', guidedInitSourceRef.current,
      '| currentPlayer =', match.currentPlayer,
    );
    if (frozenLesson) {
      const frozenStep0 = frozenLesson.steps[0]?.playerHand ?? [];
      const renderedKeys = match.players.you.hand.map((t) => `${t.low}|${t.high}`).slice().sort().join(',');
      const frozenKeys = frozenStep0.slice().sort().join(',');
      if (renderedKeys !== frozenKeys) {
        logger.error('BotMatchScreen.tsx', new Error('[guided-debug] HAND MISMATCH — rendered hand does NOT match frozen step0 hand.'), {
          rendered: match.players.you.hand.map((t) => `${t.low}|${t.high}`),
          frozenStep0,
          source: guidedInitSourceRef.current,
        });
      } else {
        console.log('[guided-debug] ✓ hands match — rendered hand matches frozen step0 hand');
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}