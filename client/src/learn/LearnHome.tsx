import { useState, type CSSProperties, type MouseEvent } from 'react';
import LayoutScreen from '../ui/LayoutScreen';
import { GlobalNav } from '../components';
import { Button } from '../components/primitives';
import type { AppMode } from '../types';
import '../screens/RacehorseHomeArt.css';
import '../screens/SinglePlayerModes.css';
import './learn.css';
import {
  freezeV2Lesson,
  loadV2AuthoringSession,
  loadV2FrozenLesson,
  resolveGuidedMatchStart,
  type LessonV2AuthoringSession,
} from './lessonV2';
import {
  upsertGuidedMatchCandidate,
} from './guidedMatch/guidedMatchCandidateStorage';
import {
  loadGuidedMatchSource,
  saveGuidedMatchSource,
} from './guidedMatch/guidedMatchSourceStorage';
import {
  type GuidedMatchCandidate,
} from './guidedMatch/guidedMatchCandidateTypes';
import {
  validateGuidedMatchCandidate,
  type GuidedMatchCandidateValidationIssue,
} from './guidedMatch/guidedMatchCandidateValidation';
import labScientistArt from '../assets/singlePlayerHub/fritzScientistLab.webp';
const themeVars = {
  '--rh-bg': '#050911',
  '--rh-panel': '#09101A',
  '--rh-panel-2': '#0B121D',
  '--rh-brass': '#D7A64A',
  '--rh-blue': '#4A8FD4',
  '--rh-green': '#67D957',
  '--rh-violet': '#8B5CF6',
  '--rh-cyan': '#20D1C7',
  '--rh-orange': '#F2A63A',
  '--rh-text': '#F2EEE8',
  '--rh-muted': '#7A778A',
} as CSSProperties;

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

type LearnCardAction = 'guided' | 'howToPlay' | 'noBrainer';

type LearnModeCard = {
  id: string;
  unlocked: boolean;
  containerClass: string;
  sectionRounded: string;
  title: string;
  titleColor: string;
  desc: string;
  badges?: string[];
  variant?: 'tier-elite' | 'tier-standard' | 'tier-master';
  chevronColor?: string;
  action?: LearnCardAction;
  ctaLabel?: string;
};

const LEARN_MODE_CARDS: LearnModeCard[] = [
  {
    id: 'howToPlay',
    unlocked: true,
    containerClass: 'learn-rules-card-container',
    sectionRounded: 'rounded-[20px] rounded-tr-[5px]',
    title: 'How to Play',
    titleColor: '#34D399',
    desc: 'Fritz walks you through rules and instincts before your first coached hand.',
    action: 'howToPlay',
    ctaLabel: 'Start',
  },
  {
    id: 'guided',
    unlocked: true,
    containerClass: 'daily-fritz-card-container',
    sectionRounded: 'rounded-[20px] rounded-tl-[5px]',
    title: 'Guided Match',
    titleColor: '#E7B64A',
    desc: 'One coached game. Oliver narrates every move.',
    badges: ['60 TURNS', 'COACHING EVERY MOVE', 'FIXED LESSON'],
    variant: 'tier-elite',
    chevronColor: '#FFD76A',
    action: 'guided',
    ctaLabel: 'Play',
  },
  {
    id: 'lab',
    unlocked: true,
    containerClass: 'sp-lab-mode-card-container learn-lab-card-container',
    sectionRounded: 'rounded-[20px] rounded-br-[5px]',
    title: 'The Lab',
    titleColor: '#C77DFF',
    desc: "Clear all 7 tiles in one turn. Chain them until it's automatic.",
    badges: ['NO-BRAINER COMBOS', 'ONE-TURN CLEARS'],
    variant: 'tier-master',
    chevronColor: '#E9D5FF',
    action: 'noBrainer',
    ctaLabel: 'Play',
  },
  {
    id: 'library',
    unlocked: false,
    containerClass: 'learn-library-card-container',
    sectionRounded: 'rounded-[20px] rounded-tr-[5px]',
    title: 'Lesson Library',
    titleColor: '#34D399',
    desc: 'Short focused lessons on strategy and scoring.',
  },
];

interface LearnHomeProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onStartGuidedGame?: () => void;
  onStartGuidedAuthoring?: () => void;
  onFreezeLesson?: () => void;
  isAdmin?: boolean;
  showAdminView?: boolean;
  onStartGuidedV2Game?: () => void;
  onStartAuthoringV2?: () => void;
  onStartGuidedMatchRecorder?: () => void;
  onOpenGuidedMatchAnnotator?: () => void;
  canOpenHowToPlay?: boolean;
  onOpenHowToPlay?: () => void;
}

export default function LearnHome({
  onBack,
  onNavigate,
  onOpenAuth,
  onOpenAccount,
  onStartGuidedGame,
  onStartGuidedAuthoring: _onStartGuidedAuthoring,
  onFreezeLesson: _onFreezeLesson,
  isAdmin,
  showAdminView = false,
  onStartGuidedV2Game,
  onStartAuthoringV2,
  onStartGuidedMatchRecorder,
  onOpenGuidedMatchAnnotator,
  canOpenHowToPlay = false,
  onOpenHowToPlay,
}: LearnHomeProps) {
  const [v2AuthoringSession, setV2AuthoringSession] = useState<LessonV2AuthoringSession | null>(() =>
    isAdmin && showAdminView ? loadV2AuthoringSession() : null,
  );
  const [_v2FrozenLesson, setV2FrozenLesson] = useState<ReturnType<typeof loadV2FrozenLesson>>(() =>
    loadV2FrozenLesson(),
  );
  const [v2FreezeFlash, setV2FreezeFlash] = useState(false);
  const [guidedV2StartError, setGuidedV2StartError] = useState<string | null>(null);
  const [candidateImportText, setCandidateImportText] = useState('');
  const [candidateImportStatus, setCandidateImportStatus] = useState<string | null>(null);
  const [candidateImportSummary, setCandidateImportSummary] = useState<string | null>(null);
  const [candidateImportIssues, setCandidateImportIssues] = useState<GuidedMatchCandidateValidationIssue[]>([]);
  const [currentGuidedMatchSource, setCurrentGuidedMatchSource] = useState<GuidedMatchCandidate | null>(() =>
    loadGuidedMatchSource(),
  );
  const [lastImportedCandidate, setLastImportedCandidate] = useState<GuidedMatchCandidate | null>(null);

  const adminContextKey = `${isAdmin}:${showAdminView}`;
  const [trackedAdminContextKey, setTrackedAdminContextKey] = useState(adminContextKey);
  if (adminContextKey !== trackedAdminContextKey) {
    setTrackedAdminContextKey(adminContextKey);
    setV2FrozenLesson(loadV2FrozenLesson());
    setV2AuthoringSession(isAdmin && showAdminView ? loadV2AuthoringSession() : null);
  }

  const handleFreezeV2 = () => {
    const session = loadV2AuthoringSession();
    if (!session) return;
    const frozen = freezeV2Lesson(session);
    setV2AuthoringSession(session);
    setV2FrozenLesson(frozen);
    setV2FreezeFlash(true);
    setTimeout(() => setV2FreezeFlash(false), 2000);
  };

  const parseCandidateImport = (): GuidedMatchCandidate | null => {
    try {
      const parsed = JSON.parse(candidateImportText) as Partial<GuidedMatchCandidate>;
      const imported = parsed as GuidedMatchCandidate;
      const errors: string[] = [];
      if (imported.version !== 1) errors.push('version must be 1');
      if (!imported.candidateId) errors.push('candidateId is required');
      if (imported.targetScore !== 60) errors.push('targetScore must be 60');
      if (imported.opponent !== 'standard-fritz') errors.push('opponent must be standard-fritz');
      if (imported.dealSize !== 7) errors.push('dealSize must be 7');
      if (imported.result !== 'won' && imported.result !== 'lost') errors.push('result must be won or lost');
      if (!imported.initialMatchSnapshot) errors.push('initialMatchSnapshot is required');
      if (!imported.finalMatchSnapshot) errors.push('finalMatchSnapshot is required');
      if (!Array.isArray(imported.events) || imported.events.length === 0) {
        errors.push('events must be a non-empty array');
      }
      if (errors.length > 0) {
        setCandidateImportStatus(`Import rejected: ${errors.join('; ')}`);
        setCandidateImportSummary(null);
        setCandidateImportIssues([]);
        return null;
      }

      const events = imported.events;
      const playerTileEventCount = events.filter(
        (event) => event.kind === 'tile-play' && event.actor === 'player',
      ).length;
      const handCount = new Set(events.map((event) => event.handNumber)).size;
      const now = new Date().toISOString();
      return {
        ...imported,
        createdAt: imported.createdAt || now,
        updatedAt: now,
        title: imported.title || 'Imported Guided Match Candidate',
        notes: imported.notes || '',
        fritzTier: imported.fritzTier || 'standard',
        rootSeed: imported.rootSeed ?? null,
        finalScore: imported.finalScore ?? { player: 0, fritz: 0 },
        eventCount: events.length,
        playerTileEventCount,
        handCount,
      };
    } catch (error) {
      setCandidateImportStatus(error instanceof Error ? `Import JSON parse failed: ${error.message}` : 'Import JSON parse failed.');
      setCandidateImportSummary(null);
      setCandidateImportIssues([]);
      return null;
    }
  };

  const summarizeCandidateImport = (
    candidate: GuidedMatchCandidate,
    issueCount: number,
    validationStatus: string,
  ) => {
    setCandidateImportSummary(
      `Score ${candidate.finalScore.player}-${candidate.finalScore.fritz} · ${candidate.eventCount} events · ${candidate.playerTileEventCount} player tile events · ${candidate.handCount} hands · ${validationStatus}${issueCount > 0 ? ` (${issueCount} issues)` : ''}`,
    );
  };

  const handleValidateCandidateImport = () => {
    const candidate = parseCandidateImport();
    if (!candidate) return;
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    setCandidateImportIssues(validation.issues);
    const validationStatus = validation.ok ? 'draft-valid' : 'draft-with-issues';
    setCandidateImportStatus(validation.ok ? 'Import is draft-valid.' : `Import has ${validation.issues.length} draft issues; import is still allowed.`);
    summarizeCandidateImport(candidate, validation.issues.length, validationStatus);
  };

  const handleImportCandidate = () => {
    const candidate = parseCandidateImport();
    if (!candidate) return;
    const validation = validateGuidedMatchCandidate(candidate, 'draft');
    const validationStatus = validation.ok ? 'draft-valid' as const : 'draft-with-issues' as const;
    const candidateToSave: GuidedMatchCandidate = {
      ...candidate,
      validationStatus,
      validationIssues: validation.issues,
    };
    const saved = upsertGuidedMatchCandidate(candidateToSave);
    if (saved) {
      setLastImportedCandidate(candidateToSave);
    }
    setCandidateImportIssues(validation.issues);
    setCandidateImportStatus(
      saved
        ? validation.ok
          ? 'Candidate imported.'
          : `Candidate imported with ${validation.issues.length} draft issues.`
        : 'Candidate import failed.',
    );
    summarizeCandidateImport(candidateToSave, validation.issues.length, validationStatus);
  };

  const setCandidateAsCurrentSource = (candidate: GuidedMatchCandidate | null) => {
    if (!candidate) {
      setCandidateImportStatus('No imported candidate is available to set as source.');
      return;
    }
    const source = {
      ...candidate,
      updatedAt: new Date().toISOString(),
    };
    const saved = saveGuidedMatchSource(source);
    if (saved) {
      setCurrentGuidedMatchSource(source);
      setCandidateImportStatus('Set as current Guided Match source.');
      setCandidateImportSummary(
        `Current source: ${source.finalScore.player}-${source.finalScore.fritz} · ${source.eventCount} events · ${source.playerTileEventCount} player moves · ${source.handCount} hands`,
      );
    } else {
      setCandidateImportStatus('Failed to set current Guided Match source.');
    }
  };

  const handleCandidateImportFile = async (file: File | null) => {
    if (!file) return;
    setCandidateImportText(await file.text());
    setCandidateImportStatus(`Loaded ${file.name}. Click Validate Import.`);
    setCandidateImportSummary(null);
    setCandidateImportIssues([]);
  };

  const canPreviewHowToPlay = canOpenHowToPlay;

  const handleLearnCardActivate = (mode: LearnModeCard) => {
    if (mode.action === 'howToPlay') {
      if (!canPreviewHowToPlay) return;
      onOpenHowToPlay?.();
      return;
    }
    if (mode.action === 'noBrainer') {
      onNavigate?.('noBrainer');
      return;
    }
    if (mode.action === 'guided') {
      const start = resolveGuidedMatchStart();
      if (!start.route) {
        setGuidedV2StartError(start.error);
        return;
      }
      setGuidedV2StartError(null);
      if (start.route === 'v2') {
        onStartGuidedV2Game?.();
        return;
      }
      onStartGuidedGame?.();
    }
  };

  if (!isAdmin || !showAdminView) {
    return (
      <div
        className="learn-hub-page learn-pvf-root pvf-root tier-rookie relative flex max-h-full min-h-0 flex-1 overflow-hidden bg-[#040b17] text-[var(--rh-text)] home-page-root"
        style={themeVars}
      >
        <div className="home-bg" aria-hidden="true">
          <div className="home-bg__halo" />
          <div className="home-bg__domino home-bg__domino--tl" />
          <div className="home-bg__domino home-bg__domino--tr" />
          <div className="home-bg__line home-bg__line--1" />
          <div className="home-bg__line home-bg__line--2" />
          <div className="home-bg__line home-bg__line--3" />
          <div className="home-bg__texture" />
        </div>

        <div className="home-shell relative mx-auto flex min-h-0 w-full max-w-[1580px] flex-1 flex-col">
          <GlobalNav
            currentMode="learn"
            activeColor="#34D399"
            onNavigate={(mode) => {
              if (mode === 'home') {
                onBack();
                return;
              }
              onNavigate?.(mode);
            }}
            onOpenAuth={onOpenAuth}
            onOpenAccount={onOpenAccount}
          />

          <main className="sp-solo-main learn-hub-main relative flex min-h-0 flex-1 flex-col overflow-hidden px-0 pb-5 pt-10 home-main">
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[linear-gradient(180deg,rgba(7,12,22,0.26)_0%,transparent_100%)]"
              aria-hidden="true"
            />

            <Button
              variant="ghost"
              className="absolute left-14 top-10 z-20 rh-back-button"
              onClick={onBack}
              type="button"
              aria-label="Back to Home"
            >
              ← Back to Home
            </Button>

            <div className="relative z-10 text-center">
              <h1
                className="text-[64px] font-black leading-[0.9] tracking-[-0.05em] text-[var(--rh-text)]"
                style={{ textShadow: '0 0 48px rgba(160,200,255,0.13), 0 2px 0 rgba(0,0,0,0.3)' }}
              >
                Learn
              </h1>
              <p className="mt-5 text-[20px] font-normal text-[#727083] opacity-90">
                Coach-led practice modes to sharpen your Racehorse strategy.
              </p>
              {guidedV2StartError ? (
                <p className="mt-4 text-[15px] text-[#f0a8a8]" role="alert">
                  {guidedV2StartError}
                </p>
              ) : null}
            </div>

            <div className="relative z-10 mt-[42px] learn-hub-grid--modes rh-mode-card-grid min-h-0 w-full flex-1 px-14 pb-2">
              {LEARN_MODE_CARDS.map((mode) => {
                const isLocked =
                  mode.id === 'howToPlay'
                    ? !canPreviewHowToPlay || !onOpenHowToPlay
                    : !mode.unlocked;
                const cardDesc = mode.desc;
                const cardBadges = mode.badges;

                return (
                  <section
                    key={mode.id}
                    className={`sp-solo-mode-card learn-mode-card ${mode.containerClass} relative box-border flex flex-col overflow-hidden ${mode.sectionRounded}${isLocked ? ' sp-solo-mode-card--locked' : ' cursor-pointer'}`}
                    onClick={isLocked ? undefined : () => handleLearnCardActivate(mode)}
                    aria-disabled={isLocked || undefined}
                  >
                    {isLocked ? (
                      <div className="learn-mode-card__lock" aria-hidden="true">
                        <LockIcon />
                      </div>
                    ) : null}

                    <div
                      className={`sp-solo-mode-card__art-slot learn-art-slice learn-art-slice--${mode.id}`}
                      aria-hidden
                    />
                    {mode.id === 'lab' ? (
                      <img
                        src={labScientistArt}
                        alt=""
                        className="learn-lab-scientist"
                        draggable={false}
                        decoding="async"
                        loading="lazy"
                        aria-hidden
                      />
                    ) : null}
                    <div className="learn-mode-card__art-tint" aria-hidden="true" />
                    <div className="home-card-scrim learn-mode-card__read-scrim" aria-hidden="true" />
                    <div className="learn-mode-card__bottom-vignette" aria-hidden="true" />
                    {isLocked ? <div className="learn-mode-card__locked-overlay" aria-hidden="true" /> : null}

                    <div className="home-card-content learn-mode-card__content">
                      <div className="learn-mode-card__body">
                        <div className="sp-solo-mode-card__text">
                          <h2
                            className="learn-mode-card__title"
                            style={isLocked ? undefined : { color: mode.titleColor }}
                          >
                            {mode.title}
                          </h2>
                          <p className={`learn-mode-card__desc ${isLocked ? 'is-muted' : ''}`}>{cardDesc}</p>
                        </div>

                        {cardBadges && cardBadges.length > 0 ? (
                          <div className="learn-mode-card__badges">
                            {cardBadges.map((badge) => (
                              <span
                                key={badge}
                                className={`learn-mode-card__badge${badge === 'AVAILABLE' ? ' learn-mode-card__badge--available' : ''}`}
                              >
                                {badge}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className={`learn-mode-card__footer${isLocked ? ' learn-mode-card__footer--locked' : ''}`}>
                        {isLocked ? (
                          <div className="learn-mode-card__soon">COMING SOON</div>
                        ) : mode.action === 'howToPlay' ? (
                          <button
                            type="button"
                            className="pvf-start-btn learn-mode-card__rules-cta rh-mode-card__cta"
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation();
                              onOpenHowToPlay?.();
                            }}
                            disabled={!onOpenHowToPlay}
                          >
                            <span>{mode.ctaLabel ?? 'Learn Rules'}</span>
                            <span className="pvf-start-arrow" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        ) : mode.action === 'noBrainer' ? (
                          <button
                            type="button"
                            className="pvf-start-btn learn-mode-card__play learn-mode-card__lab-cta rh-mode-card__cta"
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation();
                              handleLearnCardActivate(mode);
                            }}
                            disabled={!onNavigate}
                          >
                            <span>{mode.ctaLabel ?? 'Play'}</span>
                            <span className="pvf-start-arrow" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="pvf-start-btn learn-mode-card__play rh-mode-card__cta"
                            onClick={(e: MouseEvent) => {
                              e.stopPropagation();
                              handleLearnCardActivate({ ...mode, action: 'guided' });
                            }}
                            disabled={!onStartGuidedV2Game && !onStartGuidedGame}
                          >
                            <span>{mode.ctaLabel ?? 'Play'}</span>
                            <span className="pvf-start-arrow" aria-hidden="true">
                              ›
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Build one fixed coached match cleanly."
      contentClassName="multiplayer-menu-card screen-shell learn-pvf-root pvf-root tier-rookie"
    >
      <div className="learn-columns">
        <div className="learn-col">
          <h3 className="learn-col-heading">AUTHOR</h3>
          <button className="learn-start-guided-btn" onClick={onStartAuthoringV2}>
            Start V2 Authoring Session
          </button>
          <p className="learn-cta-sub">Build the event timeline for the new guided match system.</p>
          <button className="learn-start-guided-btn" onClick={onStartGuidedMatchRecorder} style={{ marginTop: 12 }}>
            Open Canonical Recorder
          </button>
          <p className="learn-cta-sub">Record the fixed Standard Fritz match into exportable canonical guided lesson JSON.</p>
        </div>
        <div className="learn-col">
          {isAdmin ? (
            <>
              <h3 className="learn-col-heading">PUBLISH</h3>
              <button
                className="learn-start-guided-btn"
                onClick={handleFreezeV2}
                disabled={!v2AuthoringSession}
                style={{
                  background: v2FreezeFlash
                    ? 'rgba(60,220,120,0.22)'
                    : 'rgba(60,180,120,0.14)',
                  border: v2FreezeFlash
                    ? '1.5px solid rgba(60,220,120,0.5)'
                    : '1.5px solid rgba(60,180,120,0.32)',
                  color: v2FreezeFlash
                    ? 'rgba(100,255,160,0.95)'
                    : 'rgba(120,230,170,0.88)',
                  opacity: v2AuthoringSession ? 1 : 0.6,
                }}
              >
                {v2FreezeFlash ? '✓ Lesson Frozen' : '❄️ Freeze Fixed Lesson'}
              </button>
              <p className="learn-cta-sub">Promotes the authored event timeline to the live guided lesson</p>
            </>
          ) : null}
        </div>
      </div>
      {isAdmin ? (
        <div className="learn-columns" style={{ marginTop: 18 }}>
          <div className="learn-col" style={{ flex: 1 }}>
            <h3 className="learn-col-heading">GUIDED MATCH CANDIDATE IMPORT</h3>
            <p className="learn-cta-sub">
              Import a completed raw candidate JSON. Draft validation issues are stored on the candidate and final export still blocks.
            </p>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                void handleCandidateImportFile(event.target.files?.[0] ?? null);
              }}
              style={{ margin: '8px 0 10px', color: 'rgba(242,238,232,0.78)' }}
            />
            <textarea
              value={candidateImportText}
              onChange={(event) => {
                setCandidateImportText(event.target.value);
                setCandidateImportStatus(null);
                setCandidateImportSummary(null);
                setCandidateImportIssues([]);
              }}
              placeholder="Paste Guided Match Candidate JSON here"
              rows={8}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                borderRadius: 14,
                border: '1px solid rgba(103,217,87,0.24)',
                background: 'rgba(6,12,20,0.72)',
                color: 'rgba(242,238,232,0.92)',
                padding: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 12,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button className="learn-start-guided-btn" type="button" onClick={handleValidateCandidateImport}>
                Validate Import
              </button>
              <button className="learn-start-guided-btn" type="button" onClick={handleImportCandidate}>
                Import Candidate
              </button>
              <button
                className="learn-start-guided-btn"
                type="button"
                onClick={() => setCandidateAsCurrentSource(lastImportedCandidate)}
                disabled={!lastImportedCandidate}
              >
                Set as Current Guided Match Source
              </button>
              <button
                className="learn-start-guided-btn"
                type="button"
                onClick={onOpenGuidedMatchAnnotator}
                disabled={!currentGuidedMatchSource}
              >
                Open Annotator
              </button>
            </div>
            {candidateImportStatus ? <p className="learn-cta-sub">{candidateImportStatus}</p> : null}
            {candidateImportSummary ? <p className="learn-cta-sub">{candidateImportSummary}</p> : null}
            {candidateImportIssues.length > 0 ? (
              <div className="learn-cta-sub">
                {candidateImportIssues.slice(0, 6).map((issue) => (
                  <div key={`${issue.path}-${issue.message}`}>
                    {issue.path}: {issue.message}
                  </div>
                ))}
                {candidateImportIssues.length > 6 ? <div>+{candidateImportIssues.length - 6} more issues stored on import.</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </LayoutScreen>
  );
}
