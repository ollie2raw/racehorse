import { useEffect, useMemo, useState } from 'react';
import { Board, DominoTile, GlobalNav } from '../../components';
import type { AppMode, PlacementPosition, Tile } from '../../types';
import {
  applyPlayMove,
  computeOpenEndsSum,
  drawOne,
  getLegalMoves,
  passTurn,
  type BotActionResult,
  type BotMatchState,
} from '../../bot/botEngine';
import type {
  GuidedMatchLesson,
  GuidedMatchCoachingTag,
  GuidedMatchPlayerTilePlayEvent,
  GuidedMatchRecordedHandEnd,
  GuidedMatchRecorderCursor,
} from './guidedMatchTypes';
import {
  clearGuidedMatchRecorderDraft,
  loadGuidedMatchRecorderDraft,
  probeGuidedMatchRecorderDraftStorage,
  saveGuidedMatchRecorderDraft,
} from './guidedMatchRecorderStorage';
import {
  GUIDED_MATCH_RECORDER_DRAFT_VERSION,
} from './guidedMatchTypes';
import {
  GUIDED_MATCH_STANDARD_ROOT_SEED,
  GUIDED_MATCH_STANDARD_TARGET_SCORE,
  createGuidedMatchRecorderInitialState,
  resolveStandardFritzRecorderAction,
  restoreGuidedMatchRecorderState,
  serializeGuidedMatchRecorderState,
  startNextGuidedMatchRecorderHand,
} from './guidedMatchRecorderEngine';
import {
  appendGuidedMatchEvent,
  createDrawEvent,
  createFritzTilePlayEvent,
  createGuidedMatchHandStartEvent,
  createGuidedMatchRecorderLesson,
  createHandEndEvent,
  createNextHandEvent,
  createPassEvent,
  createPlayerTilePlayEvent,
  createScoreAwardEvent,
} from './guidedMatchEventCapture';
import { copyGuidedMatchLessonJson, downloadGuidedMatchLessonJson } from './guidedMatchExport';
import { validateGuidedMatchLesson, type GuidedMatchValidationResult } from './guidedMatchValidation';
import {
  loadGuidedMatchSource,
  saveGuidedMatchSource,
  GUIDED_MATCH_SOURCE_STORAGE_KEY,
} from './guidedMatchSourceStorage';
import type { GuidedMatchCandidate, GuidedMatchCandidateValidationStatus } from './guidedMatchCandidateTypes';
import { prepareGuidedMatchCandidateImport } from './guidedMatchCandidateImport';
import { validateGuidedMatchCandidate, type GuidedMatchCandidateValidationIssue } from './guidedMatchCandidateValidation';
import GuidedMatchSourceEditor from './GuidedMatchSourceEditor';
import './guidedMatchRecorder.css';

interface GuidedMatchRecorderScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
}

type PendingPlayerCoaching = {
  event: GuidedMatchPlayerTilePlayEvent;
  handEnded: GuidedMatchRecordedHandEnd | null;
};

function tileEquals(a: Tile | null | undefined, b: Tile | null | undefined): boolean {
  if (!a || !b) return false;
  return (a.low === b.low && a.high === b.high) || (a.low === b.high && a.high === b.low);
}

function currentActor(match: BotMatchState): 'player' | 'fritz' {
  return match.currentPlayer === 'you' ? 'player' : 'fritz';
}

function formatTileLabel(tile: Tile): string {
  return `${tile.low}-${tile.high}`;
}

function withNextEventCounter(cursor: GuidedMatchRecorderCursor): GuidedMatchRecorderCursor {
  return {
    ...cursor,
    eventCounter: cursor.eventCounter + 1,
  };
}

function nextCursorAfterAction(
  cursor: GuidedMatchRecorderCursor,
  actor: 'player' | 'fritz',
  actionKind: 'tile-play' | 'draw' | 'pass',
  nextState: BotMatchState,
): GuidedMatchRecorderCursor {
  // chainIndex tracks committed tile-play decisions within a continuing turn.
  // Draw/pass events do not advance the chain index even when the same actor keeps the turn.
  if (nextState.handOver) return cursor;
  if (currentActor(nextState) === actor) {
    return {
      currentTurnNumber: cursor.currentTurnNumber,
      currentChainIndex: actionKind === 'tile-play' ? cursor.currentChainIndex + 1 : cursor.currentChainIndex,
      eventCounter: cursor.eventCounter,
    };
  }
  return {
    currentTurnNumber: cursor.currentTurnNumber + 1,
    currentChainIndex: 0,
    eventCounter: cursor.eventCounter,
  };
}

function buildFreshRecorderState() {
  const initialMatch = createGuidedMatchRecorderInitialState(GUIDED_MATCH_STANDARD_ROOT_SEED);
  const cursor: GuidedMatchRecorderCursor = { currentTurnNumber: 1, currentChainIndex: 0, eventCounter: 1 };
  const lessonBase = createGuidedMatchRecorderLesson(initialMatch, GUIDED_MATCH_STANDARD_ROOT_SEED);
  const handStart = createGuidedMatchHandStartEvent(initialMatch, cursor);
  const lesson = appendGuidedMatchEvent(lessonBase, handStart);
  return {
    lesson,
    match: initialMatch,
    cursor: withNextEventCounter(cursor),
    pending: null as PendingPlayerCoaching | null,
    activeEventId: handStart.id as string | null,
    draftCoachingTitle: '',
    draftCoachingBody: '',
    draftCoachingTags: '',
    draftRecovered: false,
  };
}

function loadGuidedMatchRecorderInitialState() {
  const draft = loadGuidedMatchRecorderDraft();
  if (!draft) return buildFreshRecorderState();
  const restored = restoreGuidedMatchRecorderState(draft.currentMatchSnapshot);
  if (!restored) return buildFreshRecorderState();
  return {
    lesson: draft.lesson,
    match: restored,
    cursor: draft.cursor,
    pending: draft.pendingPlayerEvent
      ? {
          event: draft.pendingPlayerEvent,
          handEnded: draft.pendingPlayerHandEnded,
        }
      : null,
    activeEventId: draft.activeEventId,
    draftCoachingTitle: draft.draftCoachingTitle ?? draft.pendingPlayerEvent?.coaching.title ?? '',
    draftCoachingBody: draft.draftCoachingBody ?? draft.pendingPlayerEvent?.coaching.body ?? '',
    draftCoachingTags:
      draft.draftCoachingTags ??
      draft.pendingPlayerEvent?.coaching.tags?.join(', ') ??
      '',
    draftRecovered: true,
  };
}

let guidedMatchRecorderInitialStateCache: ReturnType<typeof loadGuidedMatchRecorderInitialState> | null =
  null;

function getGuidedMatchRecorderInitialState() {
  if (!guidedMatchRecorderInitialStateCache) {
    guidedMatchRecorderInitialStateCache = loadGuidedMatchRecorderInitialState();
  }
  return guidedMatchRecorderInitialStateCache;
}

function summarizeImportedSource(source: GuidedMatchCandidate): string {
  return `Imported source: ${source.finalScore.player}-${source.finalScore.fritz} · ${source.eventCount} events · ${source.playerTileEventCount} player moves · ${source.handCount} hands`;
}

export default function GuidedMatchRecorderScreen({
  onBack,
  onNavigate,
}: GuidedMatchRecorderScreenProps) {
  const [lesson, setLesson] = useState<GuidedMatchLesson>(() => getGuidedMatchRecorderInitialState().lesson);
  const [match, setMatch] = useState<BotMatchState>(() => getGuidedMatchRecorderInitialState().match);
  const [cursor, setCursor] = useState<GuidedMatchRecorderCursor>(() => getGuidedMatchRecorderInitialState().cursor);
  const [pending, setPending] = useState<PendingPlayerCoaching | null>(
    () => getGuidedMatchRecorderInitialState().pending,
  );
  const [activeEventId, setActiveEventId] = useState<string | null>(
    () => getGuidedMatchRecorderInitialState().activeEventId,
  );
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [coachingTitle, setCoachingTitle] = useState(() => getGuidedMatchRecorderInitialState().draftCoachingTitle);
  const [coachingBody, setCoachingBody] = useState(() => getGuidedMatchRecorderInitialState().draftCoachingBody);
  const [coachingTags, setCoachingTags] = useState(() => getGuidedMatchRecorderInitialState().draftCoachingTags);
  const [validation, setValidation] = useState<GuidedMatchValidationResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftRecovered] = useState(() => getGuidedMatchRecorderInitialState().draftRecovered);
  const [debugOpen, setDebugOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importIssues, setImportIssues] = useState<GuidedMatchCandidateValidationIssue[]>([]);
  const [importPreview, setImportPreview] = useState<GuidedMatchCandidate | null>(null);
  const [source, setSource] = useState<GuidedMatchCandidate | null>(() => loadGuidedMatchSource());

  const legalPlayerMoves = useMemo(() => getLegalMoves(match, 'you'), [match]);
  const playableMoves = useMemo(
    () => legalPlayerMoves.filter((move) => move.type === 'play'),
    [legalPlayerMoves],
  );
  const draftProbe = probeGuidedMatchRecorderDraftStorage();
  const openCount = match.board ? computeOpenEndsSum(match.board) : 0;
  const canForcePlayerAction = match.currentPlayer === 'you' && playableMoves.length === 0 && !pending && !match.handOver && !match.gameOver;
  const forcedPlayerActionLabel = match.boneyard.length > 2 ? 'Force Draw' : 'Auto Pass';
  const currentEventNumber = lesson.events.length + (pending ? 1 : 0);
  const displayedTurnNumber = pending?.event.turnNumber ?? cursor.currentTurnNumber;
  const displayedChainIndex = pending?.event.chainIndex ?? cursor.currentChainIndex;
  const pendingTileLabel = pending ? formatTileLabel(pending.event.tile) : null;
  const draftStorageStatus = draftProbe.present ? (draftProbe.parseable ? 'Draft saved' : 'Draft unreadable') : 'New draft';
  const canSelectPlayerMove = match.currentPlayer === 'you' && !pending && !match.handOver && !match.gameOver;
  const isMatchComplete = match.gameOver === true && !pending;
  const draftStatus = isMatchComplete ? 'Complete' : 'Partial';
  const finalValidationPreview = validateGuidedMatchLesson(lesson, {
    mode: 'final',
    pendingPlayerEvent: pending?.event ?? null,
  });
  const validationStatus =
    validation == null
      ? 'Not run'
      : validation.ok
        ? validation.mode === 'final'
          ? 'Final valid'
          : 'Draft valid'
        : 'Issues found';
  const nextRequiredAction = pending
    ? 'Write coaching'
    : match.gameOver
      ? 'Match complete'
      : match.currentPlayer === 'bot'
        ? 'Waiting for Fritz'
        : selectedTile
          ? 'Choose a placement'
          : playableMoves.length > 0
            ? 'Choose a move'
            : match.boneyard.length > 2
              ? 'Draw from boneyard'
              : 'Pass turn';
  const lastCommittedEvent = lesson.events.at(-1)?.id ?? '-';
  const activeSelectedTile = useMemo(() => {
    if (!selectedTile || !canSelectPlayerMove) return null;
    if (playableMoves.every((move) => !move.tile || !tileEquals(move.tile, selectedTile))) return null;
    return selectedTile;
  }, [canSelectPlayerMove, playableMoves, selectedTile]);
  const selectedTileLegalMoves = useMemo(
    () =>
      canSelectPlayerMove && activeSelectedTile
        ? playableMoves.filter((move) => move.tile && tileEquals(move.tile, activeSelectedTile))
        : [],
    [canSelectPlayerMove, playableMoves, activeSelectedTile],
  );

  useEffect(() => {
    if (source) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const saved = saveGuidedMatchRecorderDraft({
        version: GUIDED_MATCH_RECORDER_DRAFT_VERSION,
        savedAt: new Date().toISOString(),
        lesson,
        currentMatchSnapshot: serializeGuidedMatchRecorderState(match),
        cursor,
        draftCoachingTitle: coachingTitle,
        draftCoachingBody: coachingBody,
        draftCoachingTags: coachingTags,
        pendingPlayerEvent: pending?.event ?? null,
        pendingPlayerHandEnded: pending?.handEnded ?? null,
        activeEventId,
        source: 'recorder',
      });
      setDraftSaved(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeEventId, coachingBody, coachingTags, coachingTitle, cursor, lesson, match, pending, source]);

  const finalizeHandTransition = (
    currentLesson: GuidedMatchLesson,
    resolvedState: BotMatchState,
    result: BotActionResult,
    startCursor: GuidedMatchRecorderCursor,
  ): { lesson: GuidedMatchLesson; match: BotMatchState; cursor: GuidedMatchRecorderCursor } => {
    let workingCursor = startCursor;
    let workingLesson = appendGuidedMatchEvent(currentLesson, createHandEndEvent(resolvedState, result, workingCursor));
    workingCursor = withNextEventCounter(workingCursor);
    workingLesson = appendGuidedMatchEvent(workingLesson, createScoreAwardEvent(resolvedState, result, workingCursor));
    workingCursor = withNextEventCounter(workingCursor);
    if (resolvedState.gameOver) {
      return { lesson: workingLesson, match: resolvedState, cursor: workingCursor };
    }
    const nextHandState = startNextGuidedMatchRecorderHand(resolvedState, lesson.rootSeed);
    workingLesson = appendGuidedMatchEvent(workingLesson, createNextHandEvent(resolvedState, nextHandState, workingCursor));
    workingCursor = withNextEventCounter(workingCursor);
    const nextCursor: GuidedMatchRecorderCursor = {
      currentTurnNumber: 1,
      currentChainIndex: 0,
      eventCounter: workingCursor.eventCounter,
    };
    workingLesson = appendGuidedMatchEvent(workingLesson, createGuidedMatchHandStartEvent(nextHandState, nextCursor));
    return { lesson: workingLesson, match: nextHandState, cursor: withNextEventCounter(nextCursor) };
  };

  const runFritzLoop = (baseLesson: GuidedMatchLesson, baseMatch: BotMatchState, baseCursor: GuidedMatchRecorderCursor) => {
    let workingLesson = baseLesson;
    let workingMatch = baseMatch;
    let workingCursor = baseCursor;

    while (workingMatch.currentPlayer === 'bot' && !workingMatch.handOver && !workingMatch.gameOver) {
      const legalBefore = getLegalMoves(workingMatch, 'bot');
      const action = resolveStandardFritzRecorderAction(workingMatch);
      if (action.kind === 'tile-play') {
        workingLesson = appendGuidedMatchEvent(
          workingLesson,
          createFritzTilePlayEvent(workingMatch, action.result, action.move, legalBefore, workingCursor),
        );
        workingCursor = withNextEventCounter(workingCursor);
      } else if (action.kind === 'draw') {
        workingLesson = appendGuidedMatchEvent(
          workingLesson,
          createDrawEvent('fritz', workingMatch, action.result, workingCursor),
        );
        workingCursor = withNextEventCounter(workingCursor);
      } else {
        workingLesson = appendGuidedMatchEvent(
          workingLesson,
          createPassEvent('fritz', workingMatch, action.result, workingCursor),
        );
        workingCursor = withNextEventCounter(workingCursor);
      }

      workingMatch = action.result.state;
      if (action.result.handEnded) {
        const finalized = finalizeHandTransition(workingLesson, workingMatch, action.result, workingCursor);
        workingLesson = finalized.lesson;
        workingMatch = finalized.match;
        workingCursor = finalized.cursor;
        if (workingMatch.currentPlayer !== 'bot') break;
        continue;
      }
      workingCursor = nextCursorAfterAction(workingCursor, 'fritz', action.kind, workingMatch);
    }

    setLesson(workingLesson);
    setMatch(workingMatch);
    setCursor(workingCursor);
    setActiveEventId(workingLesson.events.at(-1)?.id ?? null);
  };

  const commitNonPlayerAction = (kind: 'draw' | 'pass', result: BotActionResult) => {
    const beforeState = match;
    const nextLesson =
      kind === 'draw'
        ? appendGuidedMatchEvent(lesson, createDrawEvent('player', beforeState, result, cursor))
        : appendGuidedMatchEvent(lesson, createPassEvent('player', beforeState, result, cursor));
    const eventCursor = withNextEventCounter(cursor);

    setLesson(nextLesson);
    setActiveEventId(nextLesson.events.at(-1)?.id ?? null);

    if (result.handEnded) {
      const finalized = finalizeHandTransition(nextLesson, result.state, result, eventCursor);
      setLesson(finalized.lesson);
      setMatch(finalized.match);
      setCursor(finalized.cursor);
      setActiveEventId(finalized.lesson.events.at(-1)?.id ?? null);
      if (finalized.match.currentPlayer === 'bot' && !finalized.match.gameOver) {
        runFritzLoop(finalized.lesson, finalized.match, finalized.cursor);
      }
      return;
    }

    const nextRecorderCursor = nextCursorAfterAction(eventCursor, 'player', kind, result.state);
    setMatch(result.state);
    setCursor(nextRecorderCursor);
    if (result.state.currentPlayer === 'bot') {
      runFritzLoop(nextLesson, result.state, nextRecorderCursor);
    }
  };

  const handleForcedPlayerAction = () => {
    if (!canForcePlayerAction) return;
    if (match.boneyard.length > 2) {
      commitNonPlayerAction('draw', drawOne(match, 'you'));
      return;
    }
    commitNonPlayerAction('pass', passTurn(match, 'you'));
  };

  const handleTilePositionClick = (position: PlacementPosition) => {
    if (!activeSelectedTile || pending || !canSelectPlayerMove || match.currentPlayer !== 'you') return;
    const move = selectedTileLegalMoves.find((candidate) => candidate.position === position);
    if (!move) return;
    const beforeState = match;
    const legalBefore = getLegalMoves(beforeState, 'you');
    const result = applyPlayMove(beforeState, 'you', move);
    const event: GuidedMatchPlayerTilePlayEvent = {
      ...createPlayerTilePlayEvent(beforeState, result, move, legalBefore, cursor),
      coaching: { title: '', body: '', tags: [] },
    };
    setPending({
      event,
      handEnded: result.handEnded ?? null,
    });
    setSelectedTile(null);
    setCoachingTitle('');
    setCoachingBody('');
    setCoachingTags('');
    setValidation(null);
    setCopyStatus(null);
  };

  const handleSaveCoaching = () => {
    if (!pending) return;
    const title = coachingTitle.trim();
    const body = coachingBody.trim();
    if (!title || !body) return;
    const appliedState = restoreGuidedMatchRecorderState(pending.event.afterSnapshot);
    if (!appliedState) return;
    const event: GuidedMatchPlayerTilePlayEvent = {
      ...pending.event,
      coaching: {
        title,
        body,
        tags: coachingTags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean) as GuidedMatchCoachingTag[],
      },
    };

    const nextLesson = appendGuidedMatchEvent(lesson, event);
    const eventCursor = withNextEventCounter(cursor);
    setLesson(nextLesson);
    setActiveEventId(event.id);
    setPending(null);
    setMatch(appliedState);
    setCoachingTitle('');
    setCoachingBody('');
    setCoachingTags('');

    if (pending.handEnded) {
      const result: BotActionResult = {
        state: appliedState,
        handEnded: pending.handEnded,
      };
      const finalized = finalizeHandTransition(nextLesson, appliedState, result, eventCursor);
      setLesson(finalized.lesson);
      setMatch(finalized.match);
      setCursor(finalized.cursor);
      setActiveEventId(finalized.lesson.events.at(-1)?.id ?? null);
      if (finalized.match.currentPlayer === 'bot' && !finalized.match.gameOver) {
        runFritzLoop(finalized.lesson, finalized.match, finalized.cursor);
      }
      return;
    }

    const nextRecorderCursor = nextCursorAfterAction(eventCursor, 'player', 'tile-play', appliedState);
    setCursor(nextRecorderCursor);
    if (appliedState.currentPlayer === 'bot') {
      runFritzLoop(nextLesson, appliedState, nextRecorderCursor);
    }
  };

  const handleCopy = async () => {
    if (pending) {
      setCopyStatus('Export blocked: pending player coaching event has not been committed.');
      return;
    }
    const ok = await copyGuidedMatchLessonJson(lesson);
    setCopyStatus(ok ? 'Copied JSON to clipboard.' : 'Clipboard copy failed.');
  };

  const handleClearDraft = () => {
    if (!window.confirm('Clear the Guided Match recorder draft and start over?')) return;
    clearGuidedMatchRecorderDraft();
    const fresh = buildFreshRecorderState();
    setLesson(fresh.lesson);
    setMatch(fresh.match);
    setCursor(fresh.cursor);
    setPending(null);
    setActiveEventId(fresh.activeEventId);
    setSelectedTile(null);
    setCoachingTitle('');
    setCoachingBody('');
    setCoachingTags('');
    setValidation(null);
    setCopyStatus(null);
  };

  const handleExport = () => {
    if (pending) {
      setCopyStatus('Export blocked: pending player coaching event has not been committed.');
      return;
    }
    if (!finalValidationPreview.ok) {
      setValidation(finalValidationPreview);
      setCopyStatus('Final export blocked: canonical validation has not passed.');
      return;
    }
    downloadGuidedMatchLessonJson(lesson);
    setCopyStatus('Final canonical JSON downloaded.');
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImportText(await file.text());
    setImportStatus(`Loaded ${file.name}. Click Validate Import.`);
    setImportSummary(null);
    setImportIssues([]);
    setImportPreview(null);
  };

  const validateImportedCandidate = (): GuidedMatchCandidate | null => {
    const prepared = prepareGuidedMatchCandidateImport(importText);
    if (!prepared.candidate) {
      setImportStatus(`Import rejected: ${prepared.errors.join('; ')}`);
      setImportSummary(null);
      setImportIssues([]);
      setImportPreview(null);
      return null;
    }
    const validation = validateGuidedMatchCandidate(prepared.candidate, 'draft');
    const validationStatus: GuidedMatchCandidateValidationStatus = validation.ok ? 'draft-valid' : 'draft-with-issues';
    const candidate = {
      ...prepared.candidate,
      validationStatus,
      validationIssues: validation.issues,
    };
    setImportPreview(candidate);
    setImportIssues(validation.issues);
    setImportStatus(
      validation.ok
        ? 'Import is draft-valid.'
        : `Import has ${validation.issues.length} source warning(s). Annotation is allowed.`,
    );
    setImportSummary(summarizeImportedSource(candidate));
    return candidate;
  };

  const handleReplaceWithImportedCandidate = () => {
    const candidate = importPreview ?? validateImportedCandidate();
    if (!candidate) return;
    clearGuidedMatchRecorderDraft();
    const saved = saveGuidedMatchSource({
      ...candidate,
      updatedAt: new Date().toISOString(),
    });
    if (!saved) {
      setImportStatus('Failed to save imported source.');
      return;
    }
    setSource({
      ...candidate,
      updatedAt: new Date().toISOString(),
    });
    setImportStatus('Imported candidate replaced the current recorder draft.');
    setCopyStatus(null);
    setValidation(null);
  };

  const persistSource = (nextSource: GuidedMatchCandidate): boolean => {
    const saved = saveGuidedMatchSource({
      ...nextSource,
      updatedAt: new Date().toISOString(),
    });
    if (saved) {
      setSource({
        ...nextSource,
        updatedAt: new Date().toISOString(),
      });
    }
    return saved;
  };

  return (
    <div className="guided-match-recorder">
      <div className="guided-match-recorder__shell">
        <GlobalNav
          currentMode="learn"
          activeColor="#67D957"
          onNavigate={(mode) => {
            if (mode === 'home') {
              onBack();
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="guided-match-recorder__top">
          <div className="guided-match-recorder__hero">
            <button type="button" className="guided-match-recorder__back" onClick={onBack}>
              ← Back to Learn
            </button>
            <div className="guided-match-recorder__eyebrow">Dev Recorder</div>
            <h1>Guided Match Recorder</h1>
            <p>{source ? 'Annotate Imported Match' : `Standard Fritz · 7 tiles · First to ${GUIDED_MATCH_STANDARD_TARGET_SCORE}`}</p>
          </div>
          <div className="guided-match-recorder__header-meta">
            {source ? <div className="guided-match-recorder__chip">Imported source active</div> : <div className="guided-match-recorder__chip">Draft {draftStatus}</div>}
            {!source ? <div className="guided-match-recorder__chip">{draftStorageStatus}</div> : null}
            {!source && draftRecovered ? <div className="guided-match-recorder__chip">Draft restored</div> : null}
            {!source && pending ? <div className="guided-match-recorder__chip guided-match-recorder__chip--paused">Paused for coaching</div> : null}
            {source ? <div className="guided-match-recorder__chip">{source.playerTileEventCount} player moves</div> : null}
          </div>
        </div>
        <div className="guided-match-recorder__panel">
          <div className="guided-match-recorder__sidebar-header">
            <div>
              <div className="guided-match-recorder__section-label">Import Candidate JSON</div>
              <p className="guided-match-recorder__status-note">
                Import a completed Standard Fritz 7-tile match and replace the current seeded recorder draft with this imported source.
              </p>
            </div>
            <button
              type="button"
              className="guided-match-recorder__button guided-match-recorder__button--small"
              onClick={() => setImportOpen((value) => !value)}
            >
              {importOpen ? 'Hide Import' : 'Show Import'}
            </button>
          </div>
          {importOpen ? (
            <div className="guided-match-recorder__editor">
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  void handleImportFile(event.target.files?.[0] ?? null);
                }}
              />
              <textarea
                value={importText}
                onChange={(event) => {
                  setImportText(event.target.value);
                  setImportStatus(null);
                  setImportSummary(null);
                  setImportIssues([]);
                  setImportPreview(null);
                }}
                placeholder="Paste completed Guided Match candidate JSON here"
              />
              <div className="guided-match-recorder__controls guided-match-recorder__controls--compact">
                <button type="button" className="guided-match-recorder__button" onClick={validateImportedCandidate}>
                  Validate Import
                </button>
                <button type="button" className="guided-match-recorder__continue" onClick={handleReplaceWithImportedCandidate}>
                  Replace Current Draft With Imported Match
                </button>
                {source ? (
                  <button
                    type="button"
                    className="guided-match-recorder__button"
                    onClick={() => onNavigate?.('guidedMatchAnnotator')}
                  >
                    Open Annotator
                  </button>
                ) : null}
              </div>
              <p className="guided-match-recorder__warning">
                Source key: {GUIDED_MATCH_SOURCE_STORAGE_KEY}. Import allows draft/source warnings and stores them for later review.
              </p>
              {importStatus ? <p className="guided-match-recorder__status-note">{importStatus}</p> : null}
              {importSummary ? <p className="guided-match-recorder__status-note">{importSummary}</p> : null}
              {importIssues.length > 0 ? (
                <div className="guided-match-recorder__validation">
                  <strong>{importIssues.length} source warning(s) found.</strong>
                  <div className="guided-match-recorder__issues">
                    {importIssues.map((issue) => (
                      <div key={`${issue.path}-${issue.message}`} className="guided-match-recorder__issue">
                        <span className="guided-match-recorder__issue-path">{issue.path}</span>
                        <span>{issue.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {source ? (
          <GuidedMatchSourceEditor
            source={source}
            onSourceChange={persistSource}
            sourceSummary={summarizeImportedSource(source)}
          />
        ) : (
          <>
            {pending ? (
              <div className="guided-match-recorder__panel guided-match-recorder__pending-banner">
                <div>
                  <div className="guided-match-recorder__pending-title">Coaching required before move is committed</div>
                  <p className="guided-match-recorder__status-note">
                    You selected <strong>{pendingTileLabel}</strong>. Add coaching for this tile, then commit the move.
                  </p>
                </div>
                <div className="guided-match-recorder__chip guided-match-recorder__chip--paused">Paused for coaching</div>
              </div>
            ) : match.currentPlayer === 'you' && !match.gameOver ? (
              <div className="guided-match-recorder__panel guided-match-recorder__pending-banner">
                <div>
                  <div className="guided-match-recorder__pending-title">Select the move, then author the coaching</div>
                  <p className="guided-match-recorder__status-note">
                    Choose the intended tile and placement first. The move stays uncommitted until you save coaching.
                  </p>
                </div>
                <div className="guided-match-recorder__chip">Choose move</div>
              </div>
            ) : null}

            <div className="guided-match-recorder__layout">
              <div className="guided-match-recorder__main">
                <div className="guided-match-recorder__panel guided-match-recorder__stage">
                  <div className="guided-match-recorder__meta-rail">
                    <span>Event {currentEventNumber}</span>
                    <span>Hand {match.handNumber}</span>
                    <span>Turn {displayedTurnNumber}</span>
                    <span>Chain {displayedChainIndex}</span>
                    <span>Open {openCount}</span>
                    <span>Boneyard {match.boneyard.length}</span>
                  </div>

                  <div className="guided-match-recorder__stage-header">
                    <div>
                      <div className="guided-match-recorder__section-label">Board</div>
                      <p className="guided-match-recorder__status-note">
                        {match.currentPlayer === 'you' ? 'Your move' : 'Standard Fritz'} · You {match.players.you.score} / Fritz {match.players.bot.score}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="guided-match-recorder__button guided-match-recorder__button--small"
                      disabled={!canForcePlayerAction}
                      onClick={handleForcedPlayerAction}
                    >
                      {forcedPlayerActionLabel}
                    </button>
                  </div>

                  <div className={`guided-match-recorder__board-card${pending ? ' is-locked' : ''}`}>
                    <Board
                      board={match.board}
                      legalMoves={pending ? [] : selectedTileLegalMoves}
                      selectedTile={pending ? null : activeSelectedTile}
                      onPositionClick={handleTilePositionClick}
                      handNumber={match.handNumber}
                      handOver={match.handOver}
                      gameOver={match.gameOver}
                      fitMode="guided"
                    />
                    {pending ? <div className="guided-match-recorder__board-lock" aria-hidden="true" /> : null}
                  </div>

                  <div className="guided-match-recorder__hand-section">
                    <div className="guided-match-recorder__hand-header">
                      <div className="guided-match-recorder__section-label">Your Hand</div>
                      {pendingTileLabel ? (
                        <div className="guided-match-recorder__last-played">Pending move: {pendingTileLabel}</div>
                      ) : null}
                    </div>
                    <div className={`guided-match-recorder__hand-row${pending ? ' is-locked' : ''}`}>
                      {match.players.you.hand.map((tile, index) => {
                        const playable = playableMoves.some((move) => move.tile && tileEquals(move.tile, tile));
                        return (
                          <DominoTile
                            key={`${tile.low}|${tile.high}-${index}`}
                            tile={tile}
                            size={46}
                            selected={activeSelectedTile != null && tileEquals(activeSelectedTile, tile)}
                            highlight={playable}
                            disabled={pending != null || match.currentPlayer !== 'you' || !playable}
                            unplayable={!playable}
                            onClick={() => setSelectedTile(tile)}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <aside className="guided-match-recorder__sidebar">
                <div className="guided-match-recorder__panel">
                  <div className="guided-match-recorder__sidebar-header">
                    <div>
                      <div className="guided-match-recorder__section-label">Recorder Status</div>
                      <p className="guided-match-recorder__status-note">Lesson {lesson.lessonId}</p>
                    </div>
                    {pending ? <div className="guided-match-recorder__chip guided-match-recorder__chip--paused">Paused for coaching</div> : null}
                  </div>
                  <div className="guided-match-recorder__status-list">
                    <span>Draft status: {draftStatus}</span>
                    {draftRecovered ? <span>Recovered existing draft</span> : <span>Fresh session</span>}
                    <span>{draftSaved ? 'Autosave active' : 'Autosave unavailable'}</span>
                    <span>Validation: {validationStatus}</span>
                    <span>Pending coaching: {pending ? 'yes' : 'no'}</span>
                    <span>Last committed event: {lastCommittedEvent}</span>
                    <span>Next required action: {nextRequiredAction}</span>
                  </div>
                  <div className="guided-match-recorder__controls guided-match-recorder__controls--compact">
                    <button
                      type="button"
                      className="guided-match-recorder__button"
                      disabled={pending != null || !finalValidationPreview.ok}
                      onClick={handleExport}
                    >
                      Export Final Canonical JSON
                    </button>
                    <button
                      type="button"
                      className="guided-match-recorder__button"
                      disabled={pending != null}
                      onClick={handleCopy}
                    >
                      Copy Draft JSON
                    </button>
                    <button
                      type="button"
                      className="guided-match-recorder__button"
                      disabled={pending != null}
                      onClick={() => setValidation(validateGuidedMatchLesson(lesson, { mode: 'draft', pendingPlayerEvent: pending?.event ?? null }))}
                    >
                      Validate Draft
                    </button>
                    <button
                      type="button"
                      className="guided-match-recorder__button"
                      disabled={pending != null}
                      onClick={() => setValidation(validateGuidedMatchLesson(lesson, { mode: 'final', pendingPlayerEvent: pending?.event ?? null }))}
                    >
                      Validate Final
                    </button>
                    <button type="button" className="guided-match-recorder__danger" onClick={handleClearDraft}>
                      Clear Draft
                    </button>
                  </div>
                  <p className="guided-match-recorder__warning">
                    localStorage draft is backup only; export and commit canonical JSON.
                  </p>
                  {!isMatchComplete ? (
                    <p className="guided-match-recorder__warning">
                      This is a partial draft unless the match is complete.
                    </p>
                  ) : null}
                  {!finalValidationPreview.ok ? (
                    <p className="guided-match-recorder__warning">
                      Final canonical export stays disabled until final validation passes.
                    </p>
                  ) : null}
                  {copyStatus ? <p className="guided-match-recorder__status-note">{copyStatus}</p> : null}
                  {validation ? (
                    <div className="guided-match-recorder__validation">
                      <strong>
                        {validation.ok
                          ? validation.mode === 'final'
                            ? 'Final validation passed.'
                            : 'Draft validation passed.'
                          : `${validation.issues.length} issue(s) found in ${validation.mode} validation.`}
                      </strong>
                      {!validation.ok ? (
                        <div className="guided-match-recorder__issues">
                          {validation.issues.map((issue) => (
                            <div key={`${issue.path}-${issue.message}`} className="guided-match-recorder__issue">
                              <span className="guided-match-recorder__issue-path">{issue.path}</span>
                              <span>{issue.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div className="guided-match-recorder__panel">
                  <div className="guided-match-recorder__section-label">Coaching Editor</div>
                  <div className={`guided-match-recorder__editor${pending ? ' guided-match-recorder__editor--pending' : ''}`}>
                    {pending ? (
                      <div className="guided-match-recorder__editor-banner">
                        <div>
                          <div className="guided-match-recorder__pending-title">Coaching required before move is committed</div>
                          <p className="guided-match-recorder__status-note">
                            You selected <strong>{pendingTileLabel}</strong>. Save coaching for <strong>{pending.event.id}</strong>.
                          </p>
                        </div>
                        <div className="guided-match-recorder__chip guided-match-recorder__chip--paused">Paused for coaching</div>
                      </div>
                    ) : (
                      <p className="guided-match-recorder__status-note">
                        Choose the next tile and placement first. Then author coaching before the move is committed.
                      </p>
                    )}
                    <input
                      value={coachingTitle}
                      onChange={(event) => setCoachingTitle(event.target.value)}
                      placeholder="Coaching title"
                      disabled={!pending}
                    />
                    <textarea
                      value={coachingBody}
                      onChange={(event) => setCoachingBody(event.target.value)}
                      placeholder="Explain why this exact tile is the correct decision"
                      disabled={!pending}
                    />
                    <input
                      value={coachingTags}
                      onChange={(event) => setCoachingTags(event.target.value)}
                      placeholder="Optional tags, comma separated"
                      disabled={!pending}
                    />
                    {pending ? (
                      <button
                        type="button"
                        className="guided-match-recorder__continue"
                        disabled={!coachingTitle.trim() || !coachingBody.trim()}
                        onClick={handleSaveCoaching}
                      >
                        Save Coaching & Commit Move
                      </button>
                    ) : match.currentPlayer === 'you' ? (
                      <div className="guided-match-recorder__idle-note">
                        {selectedTile
                          ? 'Select a highlighted board target to capture the intended move. Coaching opens after the move is selected.'
                          : 'Choose a playable tile and board target. The move will pause for coaching before it is committed.'}
                      </div>
                    ) : (
                      <div className="guided-match-recorder__idle-note">
                        Waiting for the next player tile event.
                      </div>
                    )}
                  </div>
                </div>

                <div className="guided-match-recorder__panel">
                  <div className="guided-match-recorder__sidebar-header">
                    <div className="guided-match-recorder__section-label">Debug</div>
                    <button
                      type="button"
                      className="guided-match-recorder__button guided-match-recorder__button--small"
                      onClick={() => setDebugOpen((value) => !value)}
                    >
                      {debugOpen ? 'Hide Debug' : 'Show Debug'}
                    </button>
                  </div>
                  {debugOpen ? (
                    <div className="guided-match-recorder__debug-grid">
                      <div><span>Event count</span><strong>{lesson.events.length}</strong></div>
                      <div><span>Next event</span><strong>{cursor.eventCounter}</strong></div>
                      <div><span>Hand</span><strong>{match.handNumber}</strong></div>
                      <div><span>Turn</span><strong>{displayedTurnNumber}</strong></div>
                      <div><span>Chain</span><strong>{displayedChainIndex}</strong></div>
                      <div><span>Actor</span><strong>{currentActor(match)}</strong></div>
                      <div><span>Pending coaching</span><strong>{pending ? 'yes' : 'no'}</strong></div>
                      <div><span>Last event</span><strong>{activeEventId ?? '-'}</strong></div>
                      <div><span>Draft saved</span><strong>{draftSaved ? 'yes' : 'no'}</strong></div>
                      <div><span>Validation</span><strong>{validationStatus}</strong></div>
                      <div><span>Draft</span><strong>{draftStatus}</strong></div>
                      <div><span>Next action</span><strong>{nextRequiredAction}</strong></div>
                    </div>
                  ) : (
                    <p className="guided-match-recorder__status-note">Hidden by default while authoring.</p>
                  )}
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
