import { useMemo, useState } from 'react';
import { Board, DominoTile } from '../../components';
import { convertCandidateToGuidedMatchLesson } from './guidedMatchCandidateExport';
import {
  validateGuidedMatchCandidate,
  type GuidedMatchCandidateValidationResult,
} from './guidedMatchCandidateValidation';
import {
  downloadGuidedMatchLessonJson,
} from './guidedMatchExport';
import {
  restoreGuidedMatchRecorderState,
} from './guidedMatchRecorderEngine';
import type {
  GuidedMatchCandidate,
  GuidedMatchCandidatePlayerTilePlayEvent,
} from './guidedMatchCandidateTypes';
import type { GuidedMatchCoachingTag } from './guidedMatchTypes';
import type { Tile } from '../../types';
import { tileEquals } from '../../game/tileUtils';

function isPlayerTileEvent(event: GuidedMatchCandidate['events'][number]): event is GuidedMatchCandidatePlayerTilePlayEvent {
  return event.kind === 'tile-play' && event.actor === 'player';
}

function isAnnotated(event: GuidedMatchCandidatePlayerTilePlayEvent): boolean {
  return Boolean(event.coaching?.title?.trim() && event.coaching?.body?.trim());
}

function formatTile(event: GuidedMatchCandidatePlayerTilePlayEvent): string {
  return `${event.tile.low}-${event.tile.high}`;
}

function toTileId(tile: Tile): string {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return `${low}|${high}`;
}

function copyText(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
}

function updatePlayerEventCoaching(
  source: GuidedMatchCandidate,
  eventId: string,
  patch: Partial<NonNullable<GuidedMatchCandidatePlayerTilePlayEvent['coaching']>>,
): GuidedMatchCandidate {
  return {
    ...source,
    updatedAt: new Date().toISOString(),
    events: source.events.map((event) => {
      if (event.id !== eventId || !isPlayerTileEvent(event)) return event;
      return {
        ...event,
        coaching: {
          title: event.coaching?.title ?? '',
          body: event.coaching?.body ?? '',
          tags: event.coaching?.tags ?? [],
          ...patch,
        },
      };
    }),
  };
}

interface GuidedMatchSourceEditorProps {
  source: GuidedMatchCandidate;
  onSourceChange: (nextSource: GuidedMatchCandidate) => boolean;
  sourceSummary?: string | null;
}

export default function GuidedMatchSourceEditor({
  source,
  onSourceChange,
  sourceSummary = null,
}: GuidedMatchSourceEditorProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [validation, setValidation] = useState<GuidedMatchCandidateValidationResult | null>(null);

  const playerEvents = useMemo(
    () => source.events.filter(isPlayerTileEvent),
    [source],
  );
  const activeEvent = playerEvents[activeIndex] ?? null;
  const annotatedCount = playerEvents.filter(isAnnotated).length;
  const boardState = useMemo(
    () => (activeEvent ? restoreGuidedMatchRecorderState(activeEvent.beforeSnapshot) : null),
    [activeEvent],
  );
  const beforeHand = boardState?.players.you.hand ?? [];
  const playedTileId = activeEvent?.tileId ?? null;
  const playableTileIdsBefore = activeEvent?.legalMoveMetadata.playableTileIdsBefore ?? [];
  const playableTilesBefore = useMemo(
    () => new Set(playableTileIdsBefore),
    [playableTileIdsBefore],
  );
  const sourceIssueCount = source.validationIssues?.length ?? 0;
  const finalValidationPreview = validateGuidedMatchCandidate(source, 'final');
  const continuedTurn = activeEvent.continuedTurnReason === 'score' || activeEvent.continuedTurnReason === 'double';

  const persistSource = (nextSource: GuidedMatchCandidate, status = 'Saved') => {
    const saved = onSourceChange(nextSource);
    setSaveStatus(saved ? status : 'Save failed');
  };

  const updateCoaching = (
    patch: Partial<NonNullable<GuidedMatchCandidatePlayerTilePlayEvent['coaching']>>,
  ) => {
    if (!activeEvent) return;
    persistSource(updatePlayerEventCoaching(source, activeEvent.id, patch), 'Auto-saved');
  };

  const jumpToNextUnannotated = () => {
    const next = playerEvents.findIndex((event, index) => index > activeIndex && !isAnnotated(event));
    if (next >= 0) {
      setActiveIndex(next);
      return;
    }
    const first = playerEvents.findIndex((event) => !isAnnotated(event));
    if (first >= 0) setActiveIndex(first);
  };

  const handleCopyDraft = async () => {
    const copied = await copyText(JSON.stringify(source, null, 2));
    setSaveStatus(copied ? 'Draft JSON copied.' : 'Draft copy failed.');
  };

  const handleExportFinal = () => {
    if (!finalValidationPreview.ok) {
      setValidation(finalValidationPreview);
      setSaveStatus('Final export blocked: final validation has not passed.');
      return;
    }
    const lesson = convertCandidateToGuidedMatchLesson(source);
    downloadGuidedMatchLessonJson(lesson);
    setSaveStatus('Final canonical JSON downloaded.');
  };

  if (!activeEvent) {
    return (
      <div className="guided-match-recorder__panel">
        <p className="guided-match-recorder__warning">No player tile-play events were found in the current source.</p>
      </div>
    );
  }

  return (
    <div className="guided-match-recorder__layout">
      <div className="guided-match-recorder__main">
        <div className="guided-match-recorder__panel guided-match-recorder__stage">
          <div className="guided-match-recorder__meta-rail">
            <span>Step {activeIndex + 1} / {playerEvents.length}</span>
            <span>Hand {activeEvent.handNumber}</span>
            <span>Turn {activeEvent.turnNumber}</span>
            <span>Chain {activeEvent.chainIndex}</span>
            <span>Open {activeEvent.openCountBefore} → {activeEvent.openCountAfter}</span>
          </div>

          <div className="guided-match-recorder__stage-header">
            <div>
              <div className="guided-match-recorder__section-label">Board Snapshot Before Move</div>
              <p className="guided-match-recorder__status-note">
                {sourceSummary ?? `Imported source · ${source.finalScore.player}-${source.finalScore.fritz} · ${source.eventCount} events`}
              </p>
            </div>
          </div>

          <div className="guided-match-recorder__board-card">
            <Board
              board={boardState?.board ?? null}
              legalMoves={[]}
              selectedTile={null}
              onPositionClick={() => {}}
              handNumber={activeEvent.handNumber}
              handOver={Boolean(boardState?.handOver)}
              gameOver={Boolean(boardState?.gameOver)}
              fitMode="guided"
              showOpenEndGlow
            />
          </div>

          <div className="guided-match-recorder__hand-section">
            <div className="guided-match-recorder__hand-header">
              <div className="guided-match-recorder__section-label">Your Hand Before Move</div>
              <div className="guided-match-recorder__last-played">
                Played tile marked · Playable alternatives highlighted
              </div>
            </div>
            <div className="guided-match-recorder__hand-row">
              {beforeHand.map((tile, index) => {
                const tileId = toTileId(tile);
                const isPlayed = playedTileId ? tileId === playedTileId : tileEquals(tile, activeEvent.tile);
                const isPlayable = playableTilesBefore.has(tileId);
                return (
                  <div key={`${tile.low}|${tile.high}-${index}`} className="guided-match-recorder__hand-tile-card">
                    <DominoTile
                      tile={tile}
                      size={52}
                      selected={isPlayed}
                      highlight={isPlayable}
                      unplayable={!isPlayable}
                      disabled
                    />
                    <div className={isPlayed ? 'guided-match-recorder__hand-tile-label is-played' : 'guided-match-recorder__hand-tile-label'}>
                      {isPlayed ? 'Played' : isPlayable ? 'Playable' : 'In hand'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="guided-match-recorder__hand-section">
            <div className="guided-match-recorder__hand-header">
              <div className="guided-match-recorder__section-label">Played Tile</div>
              <div className="guided-match-recorder__last-played">
                {activeEvent.pointsScored ? `${activeEvent.pointsScored} points` : 'No score'} · Continued: {continuedTurn ? 'Yes' : 'No'} ({activeEvent.continuedTurnReason})
              </div>
            </div>
            <div className="guided-match-recorder__hand-row">
              <DominoTile tile={activeEvent.tile} size={56} selected disabled />
              <div className="guided-match-recorder__idle-note">Tile {formatTile(activeEvent)}</div>
            </div>
          </div>

          <div className="guided-match-recorder__hand-section">
            <div className="guided-match-recorder__hand-header">
              <div className="guided-match-recorder__section-label">Move Facts</div>
            </div>
            <div className="guided-match-recorder__status-list guided-match-recorder__status-list--grid">
              <span>Hand #: {activeEvent.handNumber}</span>
              <span>Turn #: {activeEvent.turnNumber}</span>
              <span>Chain #: {activeEvent.chainIndex}</span>
              <span>Open Count: {activeEvent.openCountBefore} → {activeEvent.openCountAfter}</span>
              <span>Score: {activeEvent.pointsScored ? `${activeEvent.pointsScored} point${activeEvent.pointsScored === 1 ? '' : 's'}` : 'No score'}</span>
              <span>Continued: {continuedTurn ? 'Yes' : 'No'} ({activeEvent.continuedTurnReason})</span>
            </div>
          </div>
        </div>
      </div>

      <aside className="guided-match-recorder__sidebar">
        <div className="guided-match-recorder__panel">
          <div className="guided-match-recorder__sidebar-header">
            <div>
              <div className="guided-match-recorder__section-label">Imported Source Status</div>
              <p className="guided-match-recorder__status-note">{sourceSummary ?? 'Imported completed Standard Fritz match'}</p>
            </div>
            <div className="guided-match-recorder__chip">Annotated {annotatedCount}/{playerEvents.length}</div>
          </div>
          <div className="guided-match-recorder__status-list">
            <span>Source status: {source.validationStatus ?? 'not-run'}</span>
            <span>Result: {source.result}</span>
            <span>Final score: You {source.finalScore.player} / Fritz {source.finalScore.fritz}</span>
            <span>Events: {source.eventCount}</span>
            <span>Player moves: {source.playerTileEventCount}</span>
            <span>Hands: {source.handCount}</span>
          </div>
          {sourceIssueCount > 0 ? (
            <p className="guided-match-recorder__warning">
              Imported with {sourceIssueCount} source warnings. Annotation is allowed. Final publish may require resolving warnings.
            </p>
          ) : null}
          <div className="guided-match-recorder__controls guided-match-recorder__controls--compact">
            <button type="button" className="guided-match-recorder__button" onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}>
              Previous
            </button>
            <button type="button" className="guided-match-recorder__button" onClick={() => setActiveIndex(Math.min(playerEvents.length - 1, activeIndex + 1))}>
              Next
            </button>
            <button type="button" className="guided-match-recorder__button" onClick={jumpToNextUnannotated}>
              Jump to next unannotated
            </button>
            <button type="button" className="guided-match-recorder__button" onClick={() => persistSource(source, 'Saved')}>
              Save
            </button>
            <button type="button" className="guided-match-recorder__button" onClick={() => setValidation(validateGuidedMatchCandidate(source, 'final'))}>
              Validate Final
            </button>
            <button type="button" className="guided-match-recorder__button" onClick={handleCopyDraft}>
              Copy Draft JSON
            </button>
            <button
              type="button"
              className="guided-match-recorder__button"
              disabled={!finalValidationPreview.ok}
              onClick={handleExportFinal}
            >
              Export Final Canonical JSON
            </button>
          </div>
          {saveStatus ? <p className="guided-match-recorder__status-note">{saveStatus}</p> : null}
          {validation ? (
            <div className="guided-match-recorder__validation">
              <strong>
                {validation.ok ? 'Final validation passed.' : `${validation.issues.length} issue(s) found in final validation.`}
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
          <div className="guided-match-recorder__editor guided-match-recorder__editor--pending">
            <div className="guided-match-recorder__editor-banner">
              <div>
                <div className="guided-match-recorder__pending-title">Annotate the recorded player move</div>
                <p className="guided-match-recorder__status-note">
                  Step {activeIndex + 1} / {playerEvents.length} · Event {activeEvent.id}
                </p>
              </div>
              <div className="guided-match-recorder__chip">Player move</div>
            </div>
            <div className="guided-match-recorder__status-list" style={{ marginTop: 0, marginBottom: 0 }}>
              <span>Hand: {activeEvent.handNumber}</span>
              <span>Turn: {activeEvent.turnNumber}</span>
              <span>Chain: {activeEvent.chainIndex}</span>
              <span>Open count: {activeEvent.openCountBefore} → {activeEvent.openCountAfter}</span>
              <span>Score: {activeEvent.pointsScored ? `${activeEvent.pointsScored} point${activeEvent.pointsScored === 1 ? '' : 's'}` : 'No score'}</span>
              <span>Continued: {activeEvent.continuedTurnReason}</span>
            </div>
            <input
              value={activeEvent.coaching?.title ?? ''}
              onChange={(event) => updateCoaching({ title: event.target.value })}
              placeholder="Coaching title"
            />
            <textarea
              value={activeEvent.coaching?.body ?? ''}
              onChange={(event) => updateCoaching({ body: event.target.value })}
              placeholder="Explain why this exact tile is the correct decision"
            />
            <input
              value={activeEvent.coaching?.tags?.join(', ') ?? ''}
              onChange={(event) =>
                updateCoaching({
                  tags: event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean) as GuidedMatchCoachingTag[],
                })
              }
              placeholder="Optional tags, comma separated"
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
