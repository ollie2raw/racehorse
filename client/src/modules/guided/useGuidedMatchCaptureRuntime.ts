import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotActionResult, BotMatchState } from '../match/runtime/botEngine.ts';
import {
  copyGuidedMatchCandidateJson,
  createGuidedMatchCapture,
  getGuidedMatchCaptureStatus,
  recordGuidedMatchCandidateAction,
  recordGuidedMatchCandidateNextHand,
  type GuidedMatchCaptureState,
} from '../../learn/guidedMatch/guidedMatchCapture.ts';
import { upsertGuidedMatchCandidate } from '../../learn/guidedMatch/guidedMatchCandidateStorage.ts';
import { validateGuidedMatchCandidate } from '../../learn/guidedMatch/guidedMatchCandidateValidation.ts';
import type { Move } from '../../types.ts';

export type UseGuidedMatchCaptureRuntimeArgs = {
  enableGuidedMatchCandidateCapture: boolean;
  activeLocalMatchId: string;
  match: BotMatchState;
  matchGameOver: boolean;
};

export type UseGuidedMatchCaptureRuntimeResult = {
  guidedMatchCaptureStatus: ReturnType<typeof getGuidedMatchCaptureStatus>;
  guidedMatchCandidateSaveStatus: string | null;
  setGuidedMatchCandidateSaveStatus: React.Dispatch<React.SetStateAction<string | null>>;
  captureGuidedMatchCandidateAction: (
    actor: 'player' | 'fritz',
    actionKind: 'tile-play' | 'draw' | 'pass',
    beforeState: BotMatchState,
    result: BotActionResult,
    move?: Move | null,
  ) => void;
  captureGuidedMatchCandidateNextHand: (
    previousState: BotMatchState,
    nextState: BotMatchState,
  ) => void;
  saveGuidedMatchCandidate: () => void;
  copyGuidedMatchCandidate: () => Promise<void>;
  canSaveGuidedMatchCandidate: boolean;
};

export function useGuidedMatchCaptureRuntime(
  args: UseGuidedMatchCaptureRuntimeArgs,
): UseGuidedMatchCaptureRuntimeResult {
  const {
    enableGuidedMatchCandidateCapture,
    activeLocalMatchId,
    match,
    matchGameOver,
  } = args;

  const guidedMatchCaptureRef = useRef<GuidedMatchCaptureState | null>(null);
  const [guidedMatchCaptureStatus, setGuidedMatchCaptureStatus] = useState(() =>
    getGuidedMatchCaptureStatus(null),
  );
  const [guidedMatchCandidateSaveStatus, setGuidedMatchCandidateSaveStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!enableGuidedMatchCandidateCapture) {
      guidedMatchCaptureRef.current = null;
      setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(null));
      setGuidedMatchCandidateSaveStatus(null);
      return;
    }
    const capture = createGuidedMatchCapture(match);
    guidedMatchCaptureRef.current = capture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(capture));
    setGuidedMatchCandidateSaveStatus(null);
  }, [activeLocalMatchId, enableGuidedMatchCandidateCapture]); // eslint-disable-line react-hooks/exhaustive-deps

  const captureGuidedMatchCandidateAction = useCallback((
    actor: 'player' | 'fritz',
    actionKind: 'tile-play' | 'draw' | 'pass',
    beforeState: BotMatchState,
    result: BotActionResult,
    move?: Move | null,
  ) => {
    if (!enableGuidedMatchCandidateCapture || !guidedMatchCaptureRef.current) return;
    const nextCapture = recordGuidedMatchCandidateAction(
      guidedMatchCaptureRef.current,
      actor,
      actionKind,
      beforeState,
      result,
      move,
    );
    guidedMatchCaptureRef.current = nextCapture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(nextCapture));
    if (result.state.gameOver) {
      const validation = validateGuidedMatchCandidate(nextCapture.candidate, 'draft');
      if (!validation.ok && import.meta.env.DEV) {
        console.warn('[guided-match-capture] draft validation issues', validation.issues);
      }
    }
  }, [enableGuidedMatchCandidateCapture]);

  const captureGuidedMatchCandidateNextHand = useCallback((
    previousState: BotMatchState,
    nextState: BotMatchState,
  ) => {
    if (!enableGuidedMatchCandidateCapture || !guidedMatchCaptureRef.current) return;
    const nextCapture = recordGuidedMatchCandidateNextHand(
      guidedMatchCaptureRef.current,
      previousState,
      nextState,
    );
    guidedMatchCaptureRef.current = nextCapture;
    setGuidedMatchCaptureStatus(getGuidedMatchCaptureStatus(nextCapture));
  }, [enableGuidedMatchCandidateCapture]);

  const isEmergencySaveableGuidedMatchCandidate = useCallback((
    candidate: GuidedMatchCaptureState['candidate'],
  ) => Boolean(
    candidate.candidateId &&
      candidate.initialMatchSnapshot &&
      candidate.finalMatchSnapshot &&
      candidate.events.length > 0 &&
      candidate.targetScore === 60 &&
      candidate.opponent === 'standard-fritz' &&
      candidate.dealSize === 7 &&
      (candidate.result === 'won' || candidate.result === 'lost'),
  ), []);

  const saveGuidedMatchCandidate = useCallback(() => {
    const candidate = guidedMatchCaptureRef.current?.candidate ?? null;
    if (!candidate) {
      setGuidedMatchCandidateSaveStatus('No candidate captured.');
      return;
    }
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    if (!validation.ok && !isEmergencySaveableGuidedMatchCandidate(candidate)) {
      setGuidedMatchCandidateSaveStatus(`Candidate has ${validation.issues.length} draft issue(s).`);
      if (import.meta.env.DEV) {
        console.warn('[guided-match-capture] save blocked by draft validation', validation.issues);
      }
      return;
    }
    const candidateToSave = {
      ...candidate,
      updatedAt: new Date().toISOString(),
      validationStatus: validation.ok ? 'draft-valid' as const : 'draft-with-issues' as const,
      validationIssues: validation.issues,
    };
    const saved = upsertGuidedMatchCandidate(candidateToSave);
    setGuidedMatchCandidateSaveStatus(
      saved
        ? validation.ok
          ? 'Guided Match candidate saved.'
          : `Saved with ${validation.issues.length} draft issues`
        : 'Candidate save failed.',
    );
    if (!validation.ok && import.meta.env.DEV) {
      console.warn('[guided-match-capture] saved raw candidate with draft validation issues', validation.issues);
    }
  }, [isEmergencySaveableGuidedMatchCandidate]);

  const copyGuidedMatchCandidate = useCallback(async () => {
    const candidate = guidedMatchCaptureRef.current?.candidate ?? null;
    if (!candidate) {
      setGuidedMatchCandidateSaveStatus('No candidate captured.');
      return;
    }
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    if (!validation.ok && import.meta.env.DEV) {
      console.warn('[guided-match-capture] draft copy validation issues', validation.issues);
    }
    const copied = await copyGuidedMatchCandidateJson(candidate);
    setGuidedMatchCandidateSaveStatus(copied ? 'Draft candidate JSON copied.' : 'Candidate copy failed.');
  }, []);

  const canSaveGuidedMatchCandidate =
    enableGuidedMatchCandidateCapture &&
    matchGameOver &&
    guidedMatchCaptureStatus.enabled &&
    guidedMatchCaptureStatus.candidateStatus === 'complete';

  return {
    guidedMatchCaptureStatus,
    guidedMatchCandidateSaveStatus,
    setGuidedMatchCandidateSaveStatus,
    captureGuidedMatchCandidateAction,
    captureGuidedMatchCandidateNextHand,
    saveGuidedMatchCandidate,
    copyGuidedMatchCandidate,
    canSaveGuidedMatchCandidate,
  };
}