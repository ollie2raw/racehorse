import React from 'react';
import { AnimatedScore } from '../components';
import type { BotMatchState } from '../modules/match/runtime/botEngine.ts';

export interface BotGuidedMatchPanelProps {
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: (show: boolean) => void;
  showFritzCoachingPanel: boolean;
  lessonCoachPanelContent: any;
  lessonCoachProgressLabel: string;
  lessonCoachProgressPct: number;
  showFullCoachTip: boolean;
  setShowFullCoachTip: (show: boolean) => void;
  showLessonCoachPanel: boolean;
  showRecommendation: boolean;
  setShowRecommendation: React.Dispatch<React.SetStateAction<boolean>>;
  canPlayCoachedMove: boolean;
  lessonCoachVm: any;
  playLessonBestMove: () => void;
  guidedFritzAnchorRef: React.RefObject<HTMLButtonElement | null>;
  setScoreTrackOpen: (open: boolean) => void;
  opponentLabel: string;
  match: BotMatchState;
  botTurn: boolean;
  turnLabel: string | null;
  openEndsSum: number;
  guidedBoneyardAnchorRef: React.RefObject<HTMLDivElement | null>;
  boardStage: React.ReactNode;
  handTray: React.ReactNode;
}

export const BotGuidedMatchPanel: React.FC<BotGuidedMatchPanelProps> = ({
  setShowLeaveConfirm,
  showFritzCoachingPanel,
  lessonCoachPanelContent,
  lessonCoachProgressLabel,
  lessonCoachProgressPct,
  showFullCoachTip,
  setShowFullCoachTip,
  showLessonCoachPanel,
  showRecommendation,
  setShowRecommendation,
  canPlayCoachedMove,
  lessonCoachVm,
  playLessonBestMove,
  guidedFritzAnchorRef,
  setScoreTrackOpen,
  opponentLabel,
  match,
  botTurn,
  turnLabel,
  openEndsSum,
  guidedBoneyardAnchorRef,
  boardStage,
  handTray,
}) => {
  return (
    <div className="walnut-match-layout game-layout-layer">
      <div className="learn-guided-pvf" data-ui="guided-cockpit">
        <div className="pvf-layout learn-guided-pvf__layout">
          <aside className="pvf-left-col learn-guided-pvf__left">
            <button
              type="button"
              className="pvf-back-btn learn-guided-pvf__exit rh-back-button"
              onClick={() => setShowLeaveConfirm(true)}
            >
              <span aria-hidden="true">←</span> Exit learn
            </button>

            <div className="pvf-header learn-guided-pvf__header">
              <div className="pvf-label">Learn Mode</div>
              <h1 className="pvf-title">Guided Match</h1>
              <p className="pvf-subtitle">Learn Racehorse by playing a real coached hand.</p>
            </div>

            <div className="learn-guided-hero-card">
              <div className="learn-guided-hero-card__content">
                <div className="learn-guided-hero-card__header">
                  <div className="learn-guided-hero-card__header-meta">
                    <p className="learn-guided-hero-card__eyebrow">Fritz Coach</p>
                    <div className="learn-guided-hero-card__progress-chip">
                      <span>{showFritzCoachingPanel ? 'Turn' : 'Move'}</span>
                      <strong>{lessonCoachPanelContent?.progressChipLabel ?? lessonCoachProgressLabel}</strong>
                    </div>
                  </div>
                  <h2 className="learn-guided-hero-card__title">
                    {lessonCoachPanelContent?.title ?? 'Hand Over'}
                  </h2>
                  <div className="learn-guided-hero-card__progress-rail" aria-hidden="true">
                    <div
                      className="learn-guided-hero-card__progress-fill"
                      style={{ width: `${lessonCoachProgressPct}%` }}
                    />
                  </div>
                </div>

                <div className="learn-guided-hero-card__divider" aria-hidden="true" />

                <div className="learn-guided-hero-card__body-wrap">
                  <div className="learn-guided-hero-card__body">
                    {lessonCoachPanelContent?.showMore ? (
                      <p className="learn-guided-hero-card__paragraph learn-guided-hero-card__paragraph--preview">
                        {lessonCoachPanelContent.previewText}
                      </p>
                    ) : (
                      (lessonCoachPanelContent?.bodyParagraphs ?? []).map((paragraph: string, index: number) => (
                        <p key={`${index}-${paragraph.slice(0, 24)}`} className="learn-guided-hero-card__paragraph">
                          {paragraph}
                        </p>
                      ))
                    )}
                  </div>
                  {lessonCoachPanelContent?.showMore ? (
                    <div className="learn-guided-hero-card__more-row">
                      <button
                        type="button"
                        className="learn-guided-hero-card__more-btn"
                        onClick={() => setShowFullCoachTip(true)}
                        aria-expanded={showFullCoachTip}
                        aria-haspopup="dialog"
                      >
                        More
                      </button>
                    </div>
                  ) : null}
                </div>
                {lessonCoachPanelContent?.showFooter ? (
                  <div className="learn-guided-hero-card__footer" aria-label="Lesson utilities">
                    <div className="learn-guided-hero-card__context-strip" aria-label="Decision context">
                      {(lessonCoachPanelContent.contextChips ?? []).map((chip: string) => (
                        <span key={chip}>{chip}</span>
                      ))}
                    </div>
                    <div className="learn-guided-hero-card__action-row">
                      {showLessonCoachPanel ? (
                        <button
                          type="button"
                          className="learn-guided-hero-card__action-secondary"
                          onClick={() => setShowRecommendation((prev) => !prev)}
                        >
                          {showRecommendation ? 'Hide Preview' : 'Show Preview'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="learn-guided-hero-card__action-primary"
                        disabled={!canPlayCoachedMove || !lessonCoachVm?.canBestMove}
                        onClick={playLessonBestMove}
                      >
                        Play Move
                      </button>
                    </div>
                  </div>
                ) : lessonCoachPanelContent?.contextChips?.length ? (
                  <div className="learn-guided-hero-card__footer learn-guided-hero-card__footer--compact" aria-label="Turn status">
                    <div className="learn-guided-hero-card__context-strip" aria-label="Turn context">
                      {lessonCoachPanelContent.contextChips.map((chip: string) => (
                        <span key={chip}>{chip}</span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </aside>

          <section className="pvf-control-panel learn-guided-pvf__panel" data-ui="guided-stage">
            <div className="learn-guided-panel-section learn-guided-panel-section--state">
              <div className="fritz-summary-strip learn-guided-summary-strip" data-ui="guided-match-state">
                <button
                  type="button"
                  ref={guidedFritzAnchorRef}
                  className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--score"
                  onClick={() => setScoreTrackOpen(true)}
                  aria-label="Open score track"
                  data-ui="guided-fritz-draw-anchor"
                >
                  <div>
                    <div className="fritz-summary-key">{opponentLabel}</div>
                    <div className="fritz-summary-value">
                      <AnimatedScore value={match.players.bot.score} className="learn-guided-summary-score" />
                    </div>
                    <span className="learn-guided-summary-tiles" aria-label={`${opponentLabel} has ${match.players.bot.hand.length} tiles remaining`}>
                      {match.players.bot.hand.length} {match.players.bot.hand.length === 1 ? 'tile' : 'tiles'}
                    </span>
                  </div>
                </button>
                <div className="fritz-summary-divider" aria-hidden />
                <button
                  type="button"
                  className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--score"
                  onClick={() => setScoreTrackOpen(true)}
                  aria-label="Open score track"
                >
                  <div>
                    <div className="fritz-summary-key">You</div>
                    <div className="fritz-summary-value">
                      <AnimatedScore value={match.players.you.score} className="learn-guided-summary-score" />
                    </div>
                    <span className="learn-guided-summary-tiles learn-guided-summary-tiles--you" aria-label={`You have ${match.players.you.hand.length} tiles remaining`}>
                      {match.players.you.hand.length} {match.players.you.hand.length === 1 ? 'tile' : 'tiles'}
                    </span>
                  </div>
                </button>
                <div className="fritz-summary-divider learn-guided-summary-divider--turn" aria-hidden />
                <div className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--turn">
                  <span className={`learn-guided-summary-turn ${botTurn ? 'is-opponent' : 'is-you'}`}>
                    {turnLabel || (botTurn ? `${opponentLabel} thinking` : 'Your move')}
                  </span>
                </div>
                <div className="fritz-summary-divider learn-guided-summary-divider--turn" aria-hidden />
                <div className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--meta">
                  <div>
                    <div className="fritz-summary-value">{openEndsSum}</div>
                    <div className="fritz-summary-key">Open Count</div>
                  </div>
                </div>
                <div className="fritz-summary-divider" aria-hidden />
                <div
                  ref={guidedBoneyardAnchorRef}
                  className="fritz-summary-item learn-guided-summary-item learn-guided-summary-item--meta"
                  data-ui="guided-boneyard-draw-anchor"
                >
                  <div>
                    <div className="fritz-summary-value">{match.boneyard.length}</div>
                    <div className="fritz-summary-key">Boneyard</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="learn-guided-panel-section learn-guided-panel-section--game">
              <div className="learn-guided-game-stage">
                <div className="rh-live-board-zone learn-guided-live-board-zone" data-ui="live-board-zone">
                  {!match.board?.mainLine?.length ? (
                    <div className="learn-guided-board-card__hint" aria-hidden="true">
                      <span className="learn-guided-board-card__hint-kicker">Opening move</span>
                      <strong className="learn-guided-board-card__hint-title">The board is waiting for the first coached tile.</strong>
                    </div>
                  ) : null}
                  {boardStage}
                </div>
                <div className="learn-guided-game-stage__hand">
                  <div className="rh-live-hand-deck learn-guided-live-hand-deck" data-ui="live-hand-deck">
                    {handTray}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
