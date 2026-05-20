import { Fragment, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DominoTile, GlobalNav } from '../components';
import { GlassCard } from '../components/primitives';
import type { AppMode, Tile } from '../types';
import '../screens/RacehorseHomeArt.css';
import '../screens/SinglePlayerModes.css';
import './learn.css';
import './learnHowToPlayRacehorse.css';
import { ChainRoadmapDiagram, DoublesCompareDiagram, MiniChainDiagram, OpenCountCalc } from './LearnHowToPlayDiagrams';

const MATCH_RACE_TARGET = 60;
const BONEYARD_DRAWABLE = 12;
const BONEYARD_LOCKED = 2;

const themeVars = {
  '--rh-bg': '#050911',
  '--rh-panel': '#09101A',
  '--rh-brass': '#D7A64A',
  '--rh-green': '#67D957',
  '--rh-text': '#F2EEE8',
} as CSSProperties;

const PAGE_LABELS = [
  'Welcome',
  'Turn Loop',
  'Matching',
  'Open Count',
  'Score & Play',
  'Doubles',
  'Forced Draws',
  'Chains',
  'Going Out',
  'Ready',
] as const;

const PAGE_COUNT = PAGE_LABELS.length;

const WELCOME_CARDS = [
  {
    variant: 'green' as const,
    icon: 'must-play' as const,
    lead: 'If you can play,',
    accent: 'you must play.',
  },
  {
    variant: 'gold' as const,
    icon: 'double' as const,
    lead: 'Score or double?',
    accent: 'Keep your turn.',
  },
  {
    variant: 'green' as const,
    icon: 'draw' as const,
    lead: 'Blocked?',
    accent: 'Racehorse draws for you.',
  },
  {
    variant: 'gold' as const,
    icon: 'race' as const,
    lead: `First to ${MATCH_RACE_TARGET}`,
    accent: 'wins the match.',
  },
] as const;

const TURN_LOOP_STEPS = [
  {
    variant: 'green' as const,
    icon: 'must-play' as const,
    title: 'Can you play?',
    lead: 'If yes,',
    accent: 'you must play.',
  },
  {
    variant: 'gold' as const,
    icon: 'double' as const,
    title: 'Did you score or play a double?',
    lead: 'If yes,',
    accent: 'your turn continues.',
  },
  {
    variant: 'green' as const,
    icon: 'draw' as const,
    title: 'Blocked?',
    lead: '',
    accent: 'Racehorse draws for you.',
  },
  {
    variant: 'gold' as const,
    icon: 'autopass' as const,
    title: 'Still blocked when the pile locks?',
    lead: '',
    accent: 'Auto-pass.',
  },
] as const;

const READY_RECAP = [
  'If you can play, you must play.',
  'Scoring keeps your turn alive.',
  'Doubles create tempo.',
  'Forced draws can create power.',
  'Chains win games.',
] as const;

function t(low: number, high: number): Tile {
  return { low, high };
}

function CoachKicker({ gold }: { gold?: boolean }) {
  return (
    <p className={`learn-howto-coach-kicker${gold ? ' learn-howto-coach-kicker--gold' : ''}`}>Fritz · Learn</p>
  );
}

function SlideHead({
  title,
  lede,
  gold,
}: {
  title: string;
  lede?: string;
  gold?: boolean;
}) {
  return (
    <header className="learn-howto-slide__head">
      <CoachKicker gold={gold} />
      <h2 className="learn-howto-slide__title">{title}</h2>
      {lede ? <p className="learn-howto-slide__lede">{lede}</p> : null}
    </header>
  );
}

function Takeaway({ children, gold }: { children: ReactNode; gold?: boolean }) {
  return (
    <p className={`learn-howto-takeaway${gold ? ' learn-howto-takeaway--gold' : ''}`}>
      <span className="learn-howto-takeaway__label">Takeaway</span>
      {children}
    </p>
  );
}

function SlidePanel({
  children,
  accent = 'green',
  visual,
}: {
  children: ReactNode;
  accent?: 'green' | 'gold';
  visual?: boolean;
}) {
  return (
    <GlassCard
      accent={accent}
      className={`learn-howto-slide-panel${visual ? ' learn-howto-slide-panel--visual' : ' learn-howto-slide-panel--stack'}`}
      lifted
    >
      {children}
    </GlassCard>
  );
}

export interface LearnHowToPlayRacehorseProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartGuidedMatch?: () => void;
}

export default function LearnHowToPlayRacehorse({
  onBack,
  onNavigate,
  onStartGuidedMatch,
}: LearnHowToPlayRacehorseProps) {
  const [page, setPage] = useState(0);

  const goNext = useCallback(() => {
    setPage((p) => Math.min(p + 1, PAGE_COUNT - 1));
  }, []);

  const goPrev = useCallback(() => {
    setPage((p) => Math.max(p - 1, 0));
  }, []);

  const goTo = useCallback((index: number) => {
    setPage(Math.max(0, Math.min(index, PAGE_COUNT - 1)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const isFirst = page === 0;
  const isLast = page === PAGE_COUNT - 1;

  const renderSlide = (): ReactNode => {
    switch (page) {
      case 0:
        return (
          <WelcomeSlide aria-labelledby="learn-howto-welcome-title">
            <div className="learn-howto-welcome__intro">
              <h1 id="learn-howto-welcome-title" className="learn-howto-welcome__title">
                Welcome to Racehorse
              </h1>
              <p className="learn-howto-welcome__subtitle">Fast, forced, scoring-focused dominoes.</p>
            </div>
            <div className="learn-howto-welcome__cards">
              {WELCOME_CARDS.map((card) => (
                <article
                  key={card.icon}
                  className={`learn-howto-welcome-card learn-howto-welcome-card--${card.variant}`}
                >
                  <span className="learn-howto-welcome-card__icon-ring" aria-hidden="true">
                    <WelcomeCardIcon type={card.icon} />
                  </span>
                  <p className="learn-howto-welcome-card__text">
                    {card.lead} <strong>{card.accent}</strong>
                  </p>
                </article>
              ))}
            </div>
            <p className="learn-howto-welcome__tagline">
              <span className="learn-howto-welcome__diamond" aria-hidden="true" />
              Learn the rhythm first. Strategy comes next.
            </p>
          </WelcomeSlide>
        );

      case 1:
        return (
          <div className="learn-howto-turn-loop-slide">
            <div className="learn-howto-turn-loop-slide__intro">
              <h2 className="learn-howto-turn-loop-slide__title">Your turn loop</h2>
              <p className="learn-howto-turn-loop-slide__lede">Every turn follows the same rhythm.</p>
            </div>
            <div className="learn-howto-turn-loop__track" role="list">
              {TURN_LOOP_STEPS.map((step, i) => (
                <Fragment key={step.title}>
                  {i > 0 ? (
                    <span className="learn-howto-turn-loop__arrow" aria-hidden="true">
                      →
                    </span>
                  ) : null}
                  <article
                    className={`learn-howto-turn-loop-card learn-howto-turn-loop-card--${step.variant}`}
                    role="listitem"
                  >
                    <span className="learn-howto-turn-loop-card__num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="learn-howto-turn-loop-card__icon-ring" aria-hidden="true">
                      <TurnLoopStepIcon type={step.icon} />
                    </span>
                    <h3 className="learn-howto-turn-loop-card__title">{step.title}</h3>
                    <p className="learn-howto-turn-loop-card__text">
                      {step.lead ? (
                        <>
                          {step.lead} <strong>{step.accent}</strong>
                        </>
                      ) : (
                        <strong>{step.accent}</strong>
                      )}
                    </p>
                  </article>
                </Fragment>
              ))}
            </div>
            <p className="learn-howto-turn-loop__tip">
              <span className="learn-howto-turn-loop__tip-icon" aria-hidden="true">
                <TurnLoopTipIcon />
              </span>
              <span>
                The game handles draws and passes. <strong>You handle tempo.</strong>
              </span>
            </p>
          </div>
        );

      case 2:
        return (
          <SlidePanel visual>
            <SlideHead
              title="Matching tiles"
              lede="Open ends are the exposed pips on the chain. Match one of them to play."
            />
            <MiniChainDiagram
              tiles={[{ tile: t(3, 4) }, { tile: t(4, 6) }]}
              ends={[
                { label: 'open end', value: 3, tone: 'active' },
                { label: 'open end', value: 6, tone: 'active' },
              ]}
              caption="Play on either open end when your tile fits."
            />
            <div className="learn-howto-hand-play" aria-label="Legal play example">
              <span className="learn-howto-hand-play__label">Your hand</span>
              <DominoTile tile={t(3, 5)} size={56} />
              <span className="learn-howto-hand-play__note">Matches the 3 — legal, required</span>
            </div>
            <div className="learn-howto-fake-controls" aria-hidden="true">
              <span className="learn-howto-fake-controls__btn learn-howto-fake-controls__btn--blocked">Draw</span>
              <span className="learn-howto-fake-controls__btn learn-howto-fake-controls__btn--blocked">Pass</span>
              <span className="learn-howto-fake-controls__btn">Play tile</span>
            </div>
            <Takeaway>No manual Draw or Pass when a legal tile exists.</Takeaway>
          </SlidePanel>
        );

      case 3:
        return (
          <SlidePanel accent="gold" visual>
            <SlideHead
              title="Open Count"
              lede="Add every active scoring end on the board. That number is your scoring signal."
              gold
            />
            <p className="learn-howto-open-hub__formula">
              Open Count = <span className="learn-howto-gold">sum of active scoring ends</span>
            </p>
            <MiniChainDiagram
              tiles={[{ tile: t(1, 2) }, { tile: t(2, 4) }]}
              ends={[
                { label: 'active end', value: 1, tone: 'active' },
                { label: 'active end', value: 4, tone: 'active' },
              ]}
            />
            <OpenCountCalc
              parts={[
                { label: 'left', value: 1 },
                { label: 'right', value: 4 },
              ]}
              total={5}
              scores
              racePoints={1}
              footnote="Non-zero multiples of five score. Race points = Open Count ÷ 5."
            />
            <Takeaway gold>Read the board total before you commit a tile.</Takeaway>
          </SlidePanel>
        );

      case 4:
        return (
          <SlidePanel accent="gold" visual>
            <SlideHead
              title="Score and keep playing"
              lede="When you score, you usually play again. Racehorse pays you for chains, not isolated hits."
              gold
            />
            <MiniChainDiagram
              tiles={[
                { tile: t(5, 5), highlight: 'gold' },
                { tile: t(5, 2) },
                { tile: t(2, 3), highlight: 'blue' },
              ]}
              ends={[
                { label: 'active end', value: 5, tone: 'active' },
                { label: 'active end', value: 3, tone: 'active' },
              ]}
              caption="Each scoring play can set up the next open end."
            />
            <OpenCountCalc
              parts={[
                { label: 'left', value: 5 },
                { label: 'right', value: 3 },
              ]}
              total={8}
              footnote="8 does not score — the idea is the chain that comes next."
            />
            <Takeaway gold>Do not just ask what scores. Ask what scores and gives you the next move.</Takeaway>
          </SlidePanel>
        );

      case 5:
        return (
          <SlidePanel accent="gold" visual>
            <SlideHead
              title="Doubles create tempo"
              lede="Any double extends your turn. Open doubles count fully; crossed doubles become branches."
              gold
            />
            <DoublesCompareDiagram
              openEnds={[
                { label: 'active end', value: 3, tone: 'active' },
                { label: 'open double', value: 12, tone: 'gold', note: 'full tile' },
                { label: 'active end', value: 2, tone: 'active' },
              ]}
            />
            <Takeaway gold>Doubles create control — use them to keep the table yours.</Takeaway>
          </SlidePanel>
        );

      case 6:
        return (
          <SlidePanel>
            <SlideHead
              title="Forced draws are not always bad"
              lede="In normal dominoes, drawing feels like punishment. In Racehorse, early draws can be a weapon."
            />
            <GlassCard accent="gold" className="learn-howto-coach-quote" lifted>
              <p className="learn-howto-coach-quote__line">More tiles = more power.</p>
              <p className="learn-howto-coach-quote__body">
                More options. More future chains. More ways to keep control when the board opens up.
              </p>
            </GlassCard>
            <ul className="learn-howto-bullet-list">
              <li>Early forced draws can widen your hand for later tempo.</li>
              <li>You never tap Draw — the game pulls until you can play or the pile locks.</li>
              <li>
                {BONEYARD_DRAWABLE} drawable · {BONEYARD_LOCKED} locked every hand.
              </li>
            </ul>
            <Takeaway>Especially early: drawing can set up the chain you want later.</Takeaway>
          </SlidePanel>
        );

      case 7:
        return (
          <SlidePanel accent="gold" visual>
            <SlideHead
              title="Think in chains"
              lede="If two moves score the same, choose the one that gives your next tile a purpose."
              gold
            />
            <ChainRoadmapDiagram
              steps={[
                {
                  label: 'Setup',
                  detail: '5-6 on the 5 — same 2 points, better future',
                  tile: t(5, 6),
                },
                {
                  label: 'Tempo',
                  detail: '6-6 keeps your turn and opens the line',
                  tile: t(6, 6),
                  rotation: 90,
                },
                {
                  label: 'Payoff',
                  detail: '0-4 finishes the chain for more race points',
                  tile: t(0, 4),
                },
              ]}
              caption="You are not memorizing tiles — you are thinking one move ahead."
            />
            <Takeaway gold>Chains win games.</Takeaway>
          </SlidePanel>
        );

      case 8:
        return (
          <SlidePanel accent="gold">
            <SlideHead
              title="Going out and winning hands"
              lede="Last tile ends the hand when allowed. Leftover pips become race points."
              gold
            />
            <div className="learn-howto-slide__end-pair">
              <GlassCard accent="green" className="learn-howto-end-card" lifted>
                <h3 className="learn-howto-end-card__title">Go out</h3>
                <p>Play your last tile. Opponent pips convert: divide by five, round to nearest whole.</p>
              </GlassCard>
              <GlassCard accent="gold" className="learn-howto-end-card" lifted>
                <h3 className="learn-howto-end-card__title">Locked boneyard</h3>
                <p>Endgame changes — small pip swings matter near {MATCH_RACE_TARGET} on the track.</p>
              </GlassCard>
            </div>
            <GlassCard accent="gold" className="learn-howto-end-example learn-howto-end-example--compact" lifted>
              <div className="learn-howto-end-example__visual">
                <div className="learn-howto-end-example__hand">
                  <span className="learn-howto-end-example__who">Opponent holds</span>
                  <DominoTile tile={t(3, 5)} size={56} />
                  <span className="learn-howto-end-example__pips">8 pips</span>
                </div>
                <span className="learn-howto-end-example__arrow" aria-hidden="true">
                  →
                </span>
                <p className="learn-howto-end-example__score">
                  <strong>2</strong> race points
                </p>
              </div>
              <p className="learn-howto-end-example__detail">round(8 ÷ 5) = 2</p>
            </GlassCard>
            <Takeaway>Block or go-out — every pip still moves the race.</Takeaway>
          </SlidePanel>
        );

      case 9:
        return (
          <div className="learn-howto-deck-slide learn-howto-deck-slide--finish">
            <SlideHead
              title="Ready for Guided Match"
              lede="You know the rules and the instincts. Fritz will walk you through a real hand — move by move."
              gold
            />
            <ul className="learn-howto-checklist learn-howto-checklist--final" aria-label="Before Guided Match">
              {READY_RECAP.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="learn-howto-slide__cta-grid learn-howto-slide__cta-grid--finish">
              <button
                type="button"
                className="pvf-start-btn learn-howto-cta--primary"
                onClick={onStartGuidedMatch}
                disabled={!onStartGuidedMatch}
              >
                <span>Play Guided Match</span>
                <span className="pvf-start-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              <button type="button" className="pvf-start-btn pvf-start-btn--standard" onClick={onBack}>
                <span>Back to Learn</span>
                <span className="pvf-start-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      className={`learn-howto-page learn-howto-page--pager learn-howto-page--immersive learn-pvf-root tier-rookie home-page-root text-[var(--rh-text)]${page === 0 ? ' learn-howto-page--welcome-screen' : ''}${page === 1 ? ' learn-howto-page--turn-loop-screen' : ''}`}
      style={themeVars}
    >
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__texture" />
      </div>

      <div className="learn-howto-page__shell">
        <GlobalNav
          currentMode="learn"
          activeColor="#34D399"
          onNavigate={(mode) => {
            if (mode === 'home') {
              onNavigate?.('home');
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="learn-howto-immersive">
          <header className="learn-howto-pager__top learn-howto-immersive__top">
            <p className="learn-howto-pager__meta">
              <span className="learn-howto-pager__step">
                {page + 1} / {PAGE_COUNT}
              </span>
              <span className="learn-howto-pager__label">{PAGE_LABELS[page]}</span>
            </p>
            <HowToProgressBar page={page} total={PAGE_COUNT} showThumb={page === 0 || page === 1} />
            {page !== 0 && page !== 1 ? (
              <PagerDotsShell>
                {PAGE_LABELS.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    role="tab"
                    aria-selected={page === i}
                    aria-label={`${label}, screen ${i + 1}`}
                    className={`learn-howto-pager__dot${page === i ? ' learn-howto-pager__dot--active' : ''}${
                      i < page ? ' learn-howto-pager__dot--done' : ''
                    }`}
                    onClick={() => goTo(i)}
                  />
                ))}
              </PagerDotsShell>
            ) : null}
          </header>

          <main key={page} className="learn-howto-immersive__stage" role="tabpanel" aria-label={PAGE_LABELS[page]}>
            <div
              className={`learn-howto-immersive__content${
                page === 0
                  ? ' learn-howto-immersive__content--welcome'
                  : page === 1
                    ? ' learn-howto-immersive__content--turn-loop'
                    : page === 9
                      ? ' learn-howto-immersive__content--hero'
                      : ''
              }`}
            >
              {renderSlide()}
            </div>
          </main>

          <footer
            className={`learn-howto-immersive__dock${isFirst ? ' learn-howto-immersive__dock--welcome' : ''}`}
          >
            <button
              type="button"
              className="learn-howto-dock-btn learn-howto-dock-btn--back"
              onClick={isFirst ? onBack : goPrev}
            >
              {isFirst ? (
                <>
                  <HowToExitIcon />
                  <span>Exit</span>
                </>
              ) : (
                'Back'
              )}
            </button>
            {isLast ? (
              <button type="button" className="learn-howto-dock-btn learn-howto-dock-btn--next" onClick={onBack}>
                Done
              </button>
            ) : (
              <button
                type="button"
                className={`learn-howto-dock-btn learn-howto-dock-btn--next${isFirst ? ' learn-howto-dock-btn--start-cta' : ''}`}
                onClick={goNext}
              >
                {isFirst ? (
                  <>
                    <span>Start</span>
                    <HowToArrowIcon />
                  </>
                ) : (
                  'Next'
                )}
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}


function HowToProgressBar({
  page,
  total,
  showThumb = false,
}: {
  page: number;
  total: number;
  showThumb?: boolean;
}) {
  const pct = ((page + 1) / total) * 100;
  return (
    <div
      className={`learn-howto-pager__progress${showThumb ? ' learn-howto-pager__progress--thumb' : ''}`}
      aria-hidden="true"
    >
      <span className="learn-howto-pager__progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PagerDotsShell({ children }: { children: ReactNode }) {
  return (
    <div className="learn-howto-pager__dots" role="tablist" aria-label="How to Play screens">
      {children}
    </div>
  );
}

function WelcomeSlide({ children, ...props }: { children: ReactNode; 'aria-labelledby'?: string }) {
  return (
    <div className="learn-howto-welcome" {...props}>
      {children}
    </div>
  );
}

function TurnLoopStepIcon({ type }: { type: (typeof TURN_LOOP_STEPS)[number]['icon'] }) {
  switch (type) {
    case 'must-play':
      return (
        <svg className="learn-howto-welcome-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'double':
      return <DominoTile tile={t(3, 3)} size={48} rotation={90} />;
    case 'draw':
      return (
        <svg className="learn-howto-welcome-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="6" y="10" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M9 10V8a3 3 0 0 1 6 0v2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'autopass':
      return (
        <svg className="learn-howto-welcome-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5a7 7 0 1 1-4.95 11.95"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
          <path
            d="M8 5H12V9"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}

function TurnLoopTipIcon() {
  return (
    <svg className="learn-howto-turn-loop__tip-star" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5l1.55 4.75h4.95l-4 2.9 1.55 4.75L12 13l-3.05 2.9 1.55-4.75-4-2.9h4.95L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WelcomeCardIcon({ type }: { type: (typeof WELCOME_CARDS)[number]['icon'] }) {
  switch (type) {
    case 'must-play':
      return (
        <svg className="learn-howto-welcome-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'double':
      return <DominoTile tile={t(3, 2)} size={48} rotation={90} />;
    case 'draw':
      return (
        <svg className="learn-howto-welcome-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="6" y="10" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M9 10V8a3 3 0 0 1 6 0v2"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'race':
      return (
        <svg
          className="learn-howto-welcome-icon learn-howto-welcome-icon--trophy"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M7 4h10v3c0 2.2-1.6 4-3.5 4.3V14H14v3H10v-3H8.5C6.6 11 5 9.2 5 7V4z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M9 17h6v2H9v-2z" stroke="currentColor" strokeWidth="1.5" />
          <text x="12" y="11" textAnchor="middle" className="learn-howto-welcome-icon__num">
            60
          </text>
        </svg>
      );
    default:
      return null;
  }
}

function HowToExitIcon() {
  return (
    <svg className="learn-howto-dock-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4H5v16h4M10 12h10M17 8l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HowToArrowIcon() {
  return (
    <svg
      className="learn-howto-dock-icon learn-howto-dock-icon--arrow"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 12h14M13 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
