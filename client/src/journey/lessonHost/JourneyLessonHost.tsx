import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { Board } from '../../components/Board.tsx';
import { DominoTile } from '../../components/DominoTile.tsx';
import { getLegalMoves } from '../../modules/match/runtime/botEngine.ts';
import { tileEquals } from '../../game/tileUtils.ts';
import type { BoardState, PlacementPosition, Tile } from '../../types.ts';
import {
  createJourneyLessonSession,
  transitionJourneyLessonSession,
  type JourneyLessonCommand,
  type JourneyLessonEffect,
  type JourneyLessonSessionState,
  type JourneyLessonTransitionResult,
} from '../journeyLessonController.ts';
import type { JourneyLessonDefinition } from '../journeyContentContract.ts';
import { applyJourneyEvidenceToStore, createEmptyJourneyEvidenceStore } from '../journeyEvidenceReducer.ts';
import { validateJourneyEvidenceEvent } from '../journeyEvidenceValidation.ts';
import type { JourneyEvidenceStore } from '../journeyEvidenceTypes.ts';
import { createJourneyScenarioState, type JourneyAuthoredMoveConsequence, type JourneyAuthoredScenario } from '../journeyAuthoredLessonBundle.ts';
import { getJourneyAuthoredLessonBundle, resolveJourneyAuthoredVariant } from '../journeyAuthoredLessonRegistry.ts';
import './JourneyLessonHost.css';

type LessonRuntime = {
  now: () => string;
  nextSessionId: () => string;
  nextExecutionId: () => string;
  nextAttemptId: () => string;
};

type JourneyLessonHostProps = {
  definition: JourneyLessonDefinition;
  onExit: () => void;
  onReplay?: () => void;
  onLessonCompleted: () => void;
  runtime?: Partial<LessonRuntime>;
};

const defaultRuntime: LessonRuntime = {
  now: () => new Date().toISOString(),
  nextSessionId: () => `journey-session-${crypto.randomUUID()}`,
  nextExecutionId: () => `journey-execution-${crypto.randomUUID()}`,
  nextAttemptId: () => `journey-attempt-${crypto.randomUUID()}`,
};

function assertNever(value: never): never {
  throw new Error(`Unhandled Journey lesson effect: ${String(value)}`);
}

function scenarioForStage(state: JourneyLessonSessionState, definition: JourneyLessonDefinition, scenarios: Readonly<Record<string, JourneyAuthoredScenario>>): JourneyAuthoredScenario | null {
  const stage = definition.stages[state.currentStageIndex];
  if (!stage || stage.kind === 'frame') return null;
  const id = state.activeScenarioRef ?? stage.scenarioRef;
  return scenarios[id] ?? null;
}

export function JourneyLessonHost({ definition, onExit, onReplay, onLessonCompleted, runtime }: JourneyLessonHostProps) {
  const bundle = getJourneyAuthoredLessonBundle(String(definition.id));
  if (!bundle || bundle.definition !== definition) throw new Error(`Missing authored Journey lesson bundle for ${definition.id}.`);
  const ids = useMemo(() => ({ ...defaultRuntime, ...runtime }), [runtime]);
  const initializedRef = useRef(false);
  const completedCallback = useRef(false);
  const sessionRef = useRef<JourneyLessonSessionState | null>(null);
  const automaticExecutionRef = useRef<string | null>(null);
  const automaticRetryRef = useRef<string | null>(null);
  const feedbackFocusRef = useRef<HTMLDivElement>(null);
  const boardFocusRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<JourneyLessonSessionState | null>(null);
  const [evidenceStore, setEvidenceStore] = useState<JourneyEvidenceStore>(() => createEmptyJourneyEvidenceStore());
  const [error, setError] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<PlacementPosition | null>(null);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [resultBoard, setResultBoard] = useState<BoardState | null>(null);
  const [demoStep, setDemoStep] = useState(0);
  const [lastConsequence, setLastConsequence] = useState<JourneyAuthoredMoveConsequence | null>(null);

  const applyEffects = useCallback((effects: JourneyLessonEffect[]) => {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'emit_evidence': {
          const validationErrors = validateJourneyEvidenceEvent(effect.event);
          if (validationErrors.length > 0) {
            setError(validationErrors.join(' '));
            return;
          }
          setEvidenceStore((current) => applyJourneyEvidenceToStore(current, effect.event));
          break;
        }
        case 'present_stage':
        case 'stage_ready':
        case 'execute_stage':
        case 'present_feedback':
        case 'retry_available':
        case 'request_fresh_variant':
          break;
        case 'request_controller_retry':
        case 'request_scorecard_evaluation':
          setError('This lesson does not use controller-defined retry or scorecard evaluation.');
          break;
        case 'lesson_completed':
          break;
        case 'lesson_ended':
          break;
        default:
          assertNever(effect);
      }
    }
  }, []);

  const transition = useCallback((command: JourneyLessonCommand) => {
    const current = sessionRef.current;
    if (!current) return;
    const result: JourneyLessonTransitionResult = transitionJourneyLessonSession(current, command, definition);
    if (result.kind === 'rejected') {
      setError(result.error.message);
      return;
    }
    sessionRef.current = result.state;
    setSession(result.state);
    setError(null);
    applyEffects(result.effects);
  }, [applyEffects, definition]);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    const sessionId = ids.nextSessionId();
    const startedAt = ids.now();
    const initial = createJourneyLessonSession(definition, { sessionId, startedAt });
    const result = transitionJourneyLessonSession(initial, { kind: 'start', sessionId, timestamp: startedAt }, definition);
    if (result.kind === 'rejected') setError(result.error.message);
    else {
      sessionRef.current = result.state;
      setSession(result.state);
      applyEffects(result.effects);
    }
  }, [applyEffects, definition, ids]);

  useEffect(() => {
    if (session?.phase === 'feedback') feedbackFocusRef.current?.focus();
    if (session?.phase === 'awaiting_result') boardFocusRef.current?.focus();
  }, [session?.phase]);

  useEffect(() => {
    if (session?.status !== 'completed' || completedCallback.current) return;
    completedCallback.current = true;
    onLessonCompleted();
  }, [onLessonCompleted, session?.status]);

  const stage = session ? definition.stages[session.currentStageIndex] : null;
  const scenario = session ? scenarioForStage(session, definition, bundle.scenarios) : null;
  const activeScenario = scenario;
  const stateForScenario = activeScenario ? createJourneyScenarioState(activeScenario) : null;
  const legalMoves = stateForScenario ? getLegalMoves(stateForScenario, 'you') : [];
  const selectedMoves = selectedTile ? legalMoves.filter((move) => move.type === 'play' && move.tile && tileEquals(move.tile, selectedTile)) : [];
  const activeExecution = session?.activeExecution;
  const feedback = session?.feedback ? bundle.feedback[session.feedback.outcomeKey] ?? null : null;
  const currentScenarioBoard = resultBoard ?? activeScenario?.board ?? null;
  const demoSteps = activeScenario?.demonstrationSteps ?? [];
  const activeDemoStep = demoSteps[demoStep] ?? null;
  const sessionEvidenceCount = Object.keys(evidenceStore.recordsByContentId).length;

  const activeIdentity = activeExecution ? {
    sessionId: activeExecution.sessionId,
    stageId: activeExecution.stageId,
    executionId: activeExecution.executionId,
    attemptId: activeExecution.attemptId,
  } : null;

  const beginInteractive = () => {
    if (!session || !stage || !activeScenario || stage.kind === 'frame' || stage.kind === 'board_demo') return;
    transition({ kind: 'begin_execution', identity: { sessionId: session.sessionId, stageId: stage.id, executionId: ids.nextExecutionId(), attemptId: ids.nextAttemptId() as never }, startedAt: ids.now(), scenarioRef: activeScenario.id });
    setSelectedTile(null);
    setSelectedPosition(null);
    setResultBoard(null);
    setLastConsequence(null);
    setDemoStep(0);
  };

  const submitAction = () => {
    if (!session || !stage || !activeScenario || !activeIdentity || !selectedTile || !selectedPosition) return;
    const response = activeScenario.interaction.kind === 'move'
      ? { kind: 'move' as const, action: { tile: selectedTile, position: selectedPosition } }
      : { kind: 'pip_count_then_move' as const, predictedUnseenCount: selectedCount ?? -1, action: { tile: selectedTile, position: selectedPosition } };
    const evaluated = bundle.evaluateResponse(activeScenario, response);
    if (evaluated.kind === 'illegal') {
      setError('Choose a legal tile and open end.');
      return;
    }
    if (!evaluated.result) return;
    setResultBoard(evaluated.nextBoard);
    setLastConsequence(evaluated.consequence ?? null);
    transition({
      kind: 'submit_result',
      identity: activeIdentity,
      completedAt: ids.now(),
      outcome: evaluated.result,
      feedbackOutcomeKey: evaluated.feedbackOutcomeKey,
      decisionSummary: evaluated.decisionSummary,
      mistakeCategoryIds: evaluated.mistakeCategoryIds,
      score: null,
    });
  };

  const submitCount = () => {
    if (!activeScenario || selectedCount === null || activeScenario.interaction.kind !== 'pip_count') return;
    const evaluated = bundle.evaluateResponse(activeScenario, { kind: 'pip_count', predictedUnseenCount: selectedCount });
    if (!activeIdentity || !evaluated.result) return;
    transition({ kind: 'submit_result', identity: activeIdentity, completedAt: ids.now(), outcome: evaluated.result, feedbackOutcomeKey: evaluated.feedbackOutcomeKey, decisionSummary: evaluated.decisionSummary, mistakeCategoryIds: evaluated.mistakeCategoryIds, score: null });
  };

  const acknowledgeFeedback = () => {
    if (!session || !activeIdentity) return;
    transition({ kind: 'acknowledge_feedback', identity: activeIdentity, timestamp: ids.now() });
  };

  useEffect(() => {
    if (session?.phase !== 'presenting' || !stage || stage.kind === 'frame' || stage.kind === 'board_demo') return;
    const key = `${session.sessionId}:${stage.id}:${session.currentStageIndex}`;
    if (session.activeExecution || automaticExecutionRef.current === key || sessionRef.current?.phase !== 'presenting') return;
    automaticExecutionRef.current = key;
    beginInteractive();
  // The stage transition is the intentional trigger; beginInteractive creates the execution.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase, session?.currentStageId]);

  useEffect(() => {
    if (session?.phase !== 'awaiting_retry' || !session.pendingRetry || !stage) return;
    const retryKey = `${session.sessionId}:${stage.id}:${session.pendingRetry.ordinal}:${session.pendingRetry.priorScenarioRefs.join(',')}`;
    if (automaticRetryRef.current === retryKey || sessionRef.current?.phase !== 'awaiting_retry') return;
    automaticRetryRef.current = retryKey;
    const previous = session.pendingRetry.priorScenarioRefs;
    const resolved = session.pendingRetry.policy.kind === 'fresh_variant'
      ? resolveJourneyAuthoredVariant(bundle, session.pendingRetry.policy.variantSetId, previous)
      : { kind: 'resolved' as const, scenario: bundle.scenarios[previous[previous.length - 1]] ?? activeScenario };
    if (resolved.kind !== 'resolved' || !resolved.scenario) {
      setError('There are no unused authored positions left for this retry.');
      return;
    }
    transition({ kind: 'retry_stage', identity: { sessionId: session.sessionId, stageId: stage.id, executionId: ids.nextExecutionId(), attemptId: ids.nextAttemptId() as never }, startedAt: ids.now(), scenarioRef: resolved.scenario.id });
    setSelectedTile(null);
    setSelectedPosition(null);
    setSelectedCount(null);
    setResultBoard(null);
    setLastConsequence(null);
    setDemoStep(0);
  // Feedback acknowledgement creates this retry phase; the effect performs the explicit retry command.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.phase, session?.pendingRetry, session?.sessionId, stage?.id]);

  if (!session || !stage) return null;

  if (session.status === 'completed') return <CompletionView onExit={onExit} onReplay={onReplay ?? onExit} evidenceRecorded={sessionEvidenceCount > 0} completionLine={bundle.presentation.completionLine} />;
  if (session.status === 'abandoned' || session.status === 'ended') return <EndedView onExit={onExit} />;

  const continueStage = () => transition({ kind: 'continue_stage', stageId: stage.id, timestamp: ids.now() });

  return (
    <div className="journey-lesson-host">
      <header className="journey-lesson-host__header">
        <button type="button" className="journey-lesson-host__exit" onClick={() => { if (session.status === 'active') transition({ kind: 'abandon', timestamp: ids.now(), reason: 'Player exited the lesson.' }); onExit(); }} aria-label="Exit lesson"><ArrowLeft size={18} aria-hidden="true" /> Back to Journey</button>
        <div><p className="journey-lesson-host__eyebrow">{bundle.presentation.tableTitle}</p><h1>{bundle.presentation.lessonTitle}</h1></div>
        <p className="journey-lesson-host__progress" aria-label={`Lesson stage ${session.currentStageIndex + 1} of ${definition.stages.length}`}>Stage {session.currentStageIndex + 1} / {definition.stages.length}</p>
      </header>
      <main className="journey-lesson-host__main">
        {stage.kind === 'frame' ? <section className="journey-lesson-host__frame"><p className="journey-lesson-host__fritz-line">{bundle.presentation.framingLine}</p><p>{bundle.presentation.framingInstruction}</p><button type="button" onClick={continueStage}>Take a seat <ArrowLeft size={16} aria-hidden="true" /></button></section> : null}
        {stage.kind === 'board_demo' && activeScenario ? <section className="journey-lesson-host__lesson-stage" aria-live="polite"><p className="journey-lesson-host__instruction">{activeDemoStep?.caption ?? (activeScenario.interaction.kind === 'move' ? 'Read the two playable ends before choosing a tile.' : `Count every known ${activeScenario.interaction.targetPip}-tile on the board and in your hand. The rest are unseen, not automatically Fritz’s.`)}</p>{activeDemoStep?.boardDescription ? <p className="journey-lesson-host__demo-description">{activeDemoStep.boardDescription}</p> : null}<div className="journey-lesson-host__board"><Board board={activeDemoStep?.board ?? activeScenario.board} legalMoves={[]} selectedTile={null} highlightedEnds={activeDemoStep?.highlightedEnds ?? [activeScenario.board.leftEnd, activeScenario.board.rightEnd]} onPositionClick={() => undefined} fitMode="guided" showZoomTray={false} staticView tileSize={78} /></div>{demoSteps.length > 0 ? <div className="journey-lesson-host__demo-controls"><span aria-label={`Demonstration step ${demoStep + 1} of ${demoSteps.length}`}>Step {demoStep + 1} / {demoSteps.length}</span><button type="button" disabled={demoStep === 0} onClick={() => setDemoStep((step) => Math.max(0, step - 1))}>Back</button>{demoStep < demoSteps.length - 1 ? <button type="button" onClick={() => setDemoStep((step) => step + 1)}>Next</button> : <button type="button" onClick={continueStage}>Continue to Decision</button>}</div> : <button type="button" onClick={continueStage}>{activeScenario.interaction.kind === 'move' ? 'I see the open ends' : 'I see the known tiles'}</button>}</section> : null}
        {stage.kind !== 'frame' && stage.kind !== 'board_demo' && activeScenario ? <section className="journey-lesson-host__lesson-stage" ref={boardFocusRef} tabIndex={-1} data-stage-id={stage.id} data-scenario-id={activeScenario.id}><p className="journey-lesson-host__instruction">{activeScenario.interaction.kind === 'move' ? (stage.kind === 'mastery' ? 'Read the whole position. Choose the move you can defend.' : 'What does your move leave open?') : activeScenario.interaction.prompt}</p><div className="journey-lesson-host__board"><Board board={currentScenarioBoard} legalMoves={legalMoves} selectedTile={selectedTile} highlightedPosition={selectedPosition} highlightedEnds={[activeScenario.board.leftEnd, activeScenario.board.rightEnd]} onPositionClick={setSelectedPosition} fitMode="guided" showZoomTray={false} tileSize={78} /></div>{activeScenario.interaction.kind !== 'move' ? <div className="journey-lesson-host__count" role="radiogroup" aria-label={`Count tiles containing ${activeScenario.interaction.targetPip}`}><p>How many {activeScenario.interaction.targetPip}-tiles remain unseen?</p>{activeScenario.interaction.options.map((count) => <button key={count} type="button" role="radio" aria-checked={selectedCount === count} className={selectedCount === count ? 'is-selected' : ''} onClick={() => setSelectedCount(count)}>{count}</button>)}</div> : null}{activeScenario.interaction.kind !== 'pip_count' ? <><div className="journey-lesson-host__hand" aria-label="Your hand">{activeScenario.playerHand.map((tile) => { const playable = legalMoves.some((move) => move.type === 'play' && move.tile && tileEquals(move.tile, tile)); return <DominoTile key={`${tile.low}-${tile.high}`} tile={tile} size={64} selected={Boolean(selectedTile && tileEquals(selectedTile, tile))} unplayable={!playable} disabled={!playable} onClick={() => setSelectedTile(tile)} />; })}</div>{selectedTile ? <div className="journey-lesson-host__placement" aria-label="Choose an open end">{selectedMoves.map((move) => move.type === 'play' && move.position ? <button key={move.position} type="button" aria-pressed={selectedPosition === move.position} className={selectedPosition === move.position ? 'is-selected' : ''} onClick={() => setSelectedPosition(move.position!)}>Play on {move.position === 'left' ? 'left end' : 'right end'}</button> : null)}</div> : null}</> : null}<button type="button" className="journey-lesson-host__submit" disabled={(activeScenario.interaction.kind === 'pip_count' ? selectedCount === null : !selectedTile || !selectedPosition || (activeScenario.interaction.kind === 'pip_count_then_move' && selectedCount === null)) || session.phase !== 'awaiting_result'} onClick={activeScenario.interaction.kind === 'pip_count' ? submitCount : submitAction}>{activeScenario.interaction.kind === 'pip_count' ? 'Submit count' : 'Submit move'}</button></section> : null}
        {session.phase === 'feedback' && feedback ? <section className="journey-lesson-host__feedback" ref={feedbackFocusRef} tabIndex={-1} aria-live="polite"><p className="journey-lesson-host__feedback-label">Board consequence</p><h2>{feedback.heading}</h2><p>{feedback.explanation}</p>{feedback.fritzRemark ? <p className="journey-lesson-host__fritz-line">{feedback.fritzRemark}</p> : null}{resultBoard ? <div className="journey-lesson-host__consequence" aria-label="Move consequence"><span>Resulting open ends: {resultBoard.leftEnd} and {resultBoard.rightEnd}</span>{lastConsequence ? <><span>Played: {lastConsequence.action.tile.low}-{lastConsequence.action.tile.high}</span><span>Playable tiles remaining: {lastConsequence.remainingPlayableTileCount}</span><span>Immediate score: {lastConsequence.immediateScoreDelta}</span>{lastConsequence.handExited ? <span>Hand exited: Yes</span> : null}</> : null}</div> : null}<button type="button" onClick={acknowledgeFeedback}>{session.feedback?.outcome === 'failed' && stage.kind !== 'frame' && stage.kind !== 'board_demo' ? (stage.retry.kind === 'fresh_variant' ? 'New Position' : 'Try Again') : 'Continue'} <RotateCcw size={16} aria-hidden="true" /></button></section> : null}
        {error ? <p className="journey-lesson-host__error" role="alert">{error}</p> : null}
      </main>
    </div>
  );
}

function CompletionView({ onExit, onReplay, evidenceRecorded, completionLine }: { onExit: () => void; onReplay: () => void; evidenceRecorded: boolean; completionLine: string }) { return <main className="journey-lesson-host journey-lesson-host--terminal" aria-labelledby="lesson-complete-title"><section className="journey-lesson-host__completion-card"><Check size={34} aria-hidden="true" /><h1 id="lesson-complete-title">Proof challenge passed</h1><p>{completionLine}</p>{evidenceRecorded ? <p className="journey-lesson-host__eyebrow">Evidence recorded for this session only</p> : null}<div><button type="button" onClick={onExit}>Return to Journey</button><button type="button" onClick={onReplay}>Replay Lesson</button></div></section></main>; }
function EndedView({ onExit }: { onExit: () => void }) { return <main className="journey-lesson-host journey-lesson-host--terminal"><section className="journey-lesson-host__completion-card"><h1>Lesson ended</h1><p>Your progress on the campaign map is unchanged.</p><button type="button" onClick={onExit}>Return to Journey</button></section></main>; }
