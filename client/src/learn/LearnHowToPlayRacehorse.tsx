import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DominoTile, GlobalNav } from '../components';
import { Button, GlassCard } from '../components/primitives';
import type { AppMode, Tile } from '../types';
import '../screens/RacehorseHomeArt.css';
import '../screens/SinglePlayerModes.css';
import './learn.css';
import './learnHowToPlayRacehorse.css';

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

const SECTION_NAV: { id: string; label: string }[] = [
  { id: 'howto-quick', label: 'Quick Rules' },
  { id: 'howto-flow', label: 'Hand Flow' },
  { id: 'howto-open', label: 'Open Count' },
  { id: 'howto-doubles', label: 'Doubles' },
  { id: 'howto-draw', label: 'Forced Draw' },
  { id: 'howto-end', label: 'End of Hand' },
  { id: 'howto-compare', label: 'vs Standard' },
];

const PILLAR_RULES: { title: string; body: string; bullets: string[]; accent: 'green' | 'gold' }[] = [
  {
    title: 'If you can play, you must play',
    body: 'Racehorse enforces tempo — no stalling when a legal play exists.',
    bullets: ['No manual draw', 'No manual pass'],
    accent: 'green',
  },
  {
    title: 'Scoring keeps your turn',
    body: 'Hit the Open count on a multiple of five and you chain another play.',
    bullets: ['Open count creates scoring chains', 'Miss the score → turn passes'],
    accent: 'gold',
  },
  {
    title: 'Doubles create tempo',
    body: 'Doubles extend your turn and reshape the board.',
    bullets: ['Playing a double → play again', 'Open double = full tile value in Open count'],
    accent: 'gold',
  },
  {
    title: 'The boneyard controls blocked turns',
    body: 'When you cannot play, the game draws for you.',
    bullets: ['Forced draw until playable or exhausted', 'Last 2 tiles locked → auto-pass'],
    accent: 'green',
  },
];

const QUICK_CHECKLIST: string[] = [
  'Match an open end on the train',
  'If you can play, you must play',
  'No manual draw or pass',
  'Scoring continues your turn',
  'Doubles continue your turn',
  'Open count decides scoring',
  'Forced draw when blocked',
  'Hands end on go-out or block',
];

const FLOW_STEPS: { title: string; body: string; tag?: string }[] = [
  { title: 'Deal', body: 'Tiles dealt, boneyard formed, opener sets the train.', tag: 'Setup' },
  { title: 'Open', body: 'First plays establish open ends and early board shape.', tag: 'Start' },
  { title: 'Play', body: 'Legal move available? You must make it — tempo is enforced.', tag: 'Forced' },
  {
    title: 'Score / continue',
    body: 'Open count hits a multiple of five → you score and keep the turn.',
    tag: 'Chain',
  },
  {
    title: 'Draw if blocked',
    body: 'No legal tile? The game draws automatically until something plays.',
    tag: 'Boneyard',
  },
  {
    title: 'Auto-pass if locked',
    body: 'Only locked tiles left and still blocked → pass resolves automatically.',
    tag: 'Locked',
  },
  { title: 'End hand', body: 'Someone goes out, or the board blocks with no legal plays.', tag: 'Finish' },
];

const OPEN_COUNT_RULES: string[] = [
  'Normal open end = the single exposed pip you match against',
  'Open double = full tile value (both halves count)',
  'Fully crossed double drops out — only real branch tips count',
];

const DOUBLE_EXAMPLES: { tile: Tile; openValue: number; label: string }[] = [
  { tile: { low: 1, high: 1 }, openValue: 2, label: 'Open = 2' },
  { tile: { low: 2, high: 2 }, openValue: 4, label: 'Open = 4' },
  { tile: { low: 3, high: 3 }, openValue: 6, label: 'Open = 6' },
  { tile: { low: 6, high: 6 }, openValue: 12, label: 'Open = 12' },
];

const DOUBLE_PANELS: { title: string; body: string; accent: 'gold' | 'green' }[] = [
  {
    title: 'Open double counts',
    body: 'While waiting for branches, the full pip total of the double adds to Open count.',
    accent: 'gold',
  },
  {
    title: 'Crossed double drops out',
    body: 'Once fully crossed, that double stops contributing. Empty branch slots do not add phantom values.',
    accent: 'green',
  },
  {
    title: 'Branch tips take over',
    body: 'Only real branch ends with tiles on them matter for scoring ends next.',
    accent: 'green',
  },
];

const END_HAND_STEPS: string[] = [
  'Player goes out OR the board blocks',
  'Count opponent leftover pips',
  'Round pips into points (every 5 pips → 1 point)',
  'Winner receives those points',
];

const COMPARE_ROWS: { standard: string; racehorse: string }[] = [
  { standard: 'Optional draw / pass', racehorse: 'Forced draw / auto-pass logic' },
  { standard: 'Mostly alternating turns', racehorse: 'Scoring chains and double chains extend your turn' },
  { standard: 'Simple doubles house rules', racehorse: 'Tempo doubles with full Open value until crossed' },
  { standard: 'Classic “ends add up” customs vary', racehorse: 'Racehorse Open count scoring as a core HUD signal' },
];

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export interface LearnHowToPlayRacehorseProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onStartGuidedMatch?: () => void;
  onPlayVsFritz?: () => void;
}

export default function LearnHowToPlayRacehorse({
  onBack,
  onNavigate,
  onStartGuidedMatch,
  onPlayVsFritz,
}: LearnHowToPlayRacehorseProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] = useState(SECTION_NAV[0].id);

  const updateActiveFromScroll = useCallback(() => {
    const root = scrollRef.current;
    if (!root) return;
    const navH = navRef.current?.offsetHeight ?? 0;
    const marker = root.getBoundingClientRect().top + navH + 72;
    let current = SECTION_NAV[0].id;
    for (const { id } of SECTION_NAV) {
      const el = document.getElementById(id);
      if (el && el.getBoundingClientRect().top <= marker) current = id;
    }
    setActiveSection(current);
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    updateActiveFromScroll();
    root.addEventListener('scroll', updateActiveFromScroll, { passive: true });
    return () => root.removeEventListener('scroll', updateActiveFromScroll);
  }, [updateActiveFromScroll]);

  return (
    <div className="learn-howto-page home-page-root text-[var(--rh-text)]" style={themeVars}>
      <div className="home-bg" aria-hidden="true">
        <div className="home-bg__halo" />
        <div className="home-bg__domino home-bg__domino--tl" />
        <div className="home-bg__domino home-bg__domino--tr" />
        <div className="home-bg__line home-bg__line--1" />
        <div className="home-bg__line home-bg__line--2" />
        <div className="home-bg__line home-bg__line--3" />
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

        <Button variant="ghost" className="absolute left-14 top-10 z-20 rh-back-button" onClick={onBack} type="button">
          ← Back to Learn
        </Button>

        <div ref={scrollRef} className="learn-howto-page__scroll">
          <div className="learn-howto-page__content">
            <header className="learn-howto-hero">
              <h1 className="learn-howto-hero__title">How to Play Racehorse</h1>
              <p className="learn-howto-hero__subtitle">
                Fast, forced, scoring-focused dominoes. If you can play, you must play.
              </p>
            </header>

            <nav ref={navRef} className="learn-howto-nav" aria-label="Rules sections">
              {SECTION_NAV.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`learn-howto-nav__link${activeSection === id ? ' learn-howto-nav__link--active' : ''}`}
                  onClick={() => scrollToSection(id)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <section id="howto-quick" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label">Quick start</p>
                <h2 className="learn-howto-section__title">Four pillars of Racehorse</h2>
                <p className="learn-howto-section__lede">
                  Learn these first — everything else on this page is detail around them.
                </p>
              </div>
              <div className="learn-howto-pillars">
                {PILLAR_RULES.map((pillar) => (
                  <GlassCard
                    key={pillar.title}
                    accent={pillar.accent}
                    className="learn-howto-pillar"
                    lifted
                  >
                    <h3 className="learn-howto-pillar__title">{pillar.title}</h3>
                    <p className="learn-howto-pillar__body">{pillar.body}</p>
                    <ul className="learn-howto-pillar__bullets">
                      {pillar.bullets.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </GlassCard>
                ))}
              </div>
              <div className="learn-howto-recap-strip">
                <p className="learn-howto-recap-strip__label">Quick recap</p>
                <ul className="learn-howto-checklist" aria-label="Quick rules recap">
                  {QUICK_CHECKLIST.map((rule) => (
                    <li key={rule}>{rule}</li>
                  ))}
                </ul>
              </div>
            </section>

            <section id="howto-flow" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label">Rhythm</p>
                <h2 className="learn-howto-section__title">Core flow of a hand</h2>
                <p className="learn-howto-section__lede">From deal to resolution in seven beats.</p>
              </div>
              <ol className="learn-howto-timeline">
                {FLOW_STEPS.map((step, i) => (
                  <li key={step.title} className="learn-howto-timeline__step">
                    <span className="learn-howto-timeline__badge" aria-hidden="true">
                      {i + 1}
                    </span>
                    <div className="learn-howto-timeline__content">
                      <div className="learn-howto-timeline__row">
                        <strong className="learn-howto-timeline__title">{step.title}</strong>
                        {step.tag ? <span className="learn-howto-timeline__tag">{step.tag}</span> : null}
                      </div>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section id="howto-open" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label learn-howto-section__label--gold">Scoring signal</p>
                <h2 className="learn-howto-section__title">Open count</h2>
              </div>
              <div className="learn-howto-feature learn-howto-feature--open">
                <div className="learn-howto-feature__copy">
                  <p className="learn-howto-feature__formula">
                    Open Count = <span className="learn-howto-gold">total value of all open scoring ends</span>
                  </p>
                  <ul className="learn-howto-feature__rules">
                    {OPEN_COUNT_RULES.map((rule) => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                  <p className="learn-howto-feature__note">
                    Score when Open count is a non-zero multiple of five — your turn continues.
                  </p>
                </div>
                <div className="learn-howto-open-strip" aria-label="Open double examples">
                  {DOUBLE_EXAMPLES.map((ex) => (
                    <div key={ex.label} className="learn-howto-open-strip__cell">
                      <DominoTile tile={ex.tile} size={84} rotation={90} />
                      <p className="learn-howto-open-strip__label">
                        <span className="learn-howto-open-strip__value">{ex.openValue}</span>
                        <span className="learn-howto-open-strip__tag">{ex.label}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section id="howto-doubles" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label learn-howto-section__label--gold">Tempo</p>
                <h2 className="learn-howto-section__title">Doubles</h2>
                <p className="learn-howto-section__lede">Playing a double always continues your turn.</p>
              </div>
              <div className="learn-howto-doubles-grid">
                {DOUBLE_PANELS.map((panel) => (
                  <GlassCard
                    key={panel.title}
                    accent={panel.accent}
                    className="learn-howto-double-panel"
                    lifted
                  >
                    <h3 className="learn-howto-double-panel__title">{panel.title}</h3>
                    <p>{panel.body}</p>
                  </GlassCard>
                ))}
              </div>
            </section>

            <section id="howto-draw" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label">Discipline</p>
                <h2 className="learn-howto-section__title">Forced draw / auto pass</h2>
              </div>
              <div className="learn-howto-draw-board">
              <div className="learn-howto-tree" role="group" aria-label="Forced draw decision tree">
                <div className="learn-howto-tree__node learn-howto-tree__node--root">
                  <p className="learn-howto-tree__question">Do you have a legal move?</p>
                  <div className="learn-howto-tree__branches">
                    <div className="learn-howto-tree__branch learn-howto-tree__branch--yes">
                      <span className="learn-howto-tree__answer">Yes</span>
                      <p>You must play.</p>
                    </div>
                    <div className="learn-howto-tree__branch learn-howto-tree__branch--no">
                      <span className="learn-howto-tree__answer">No</span>
                      <p>Draw automatically from the boneyard.</p>
                    </div>
                  </div>
                </div>
                <div className="learn-howto-tree__connector" aria-hidden="true" />
                <div className="learn-howto-tree__node">
                  <p className="learn-howto-tree__question">Did the draw find a playable tile?</p>
                  <div className="learn-howto-tree__branches">
                    <div className="learn-howto-tree__branch learn-howto-tree__branch--yes">
                      <span className="learn-howto-tree__answer">Yes</span>
                      <p>Play it.</p>
                    </div>
                    <div className="learn-howto-tree__branch learn-howto-tree__branch--no">
                      <span className="learn-howto-tree__answer">No + boneyard locked</span>
                      <p>Auto-pass — turn moves on.</p>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </section>

            <section id="howto-end" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label">Resolution</p>
                <h2 className="learn-howto-section__title">End of hand</h2>
              </div>
              <div className="learn-howto-end-board">
              <ol className="learn-howto-recap">
                {END_HAND_STEPS.map((step, i) => (
                  <li key={step}>
                    <span className="learn-howto-recap__num">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <GlassCard accent="gold" className="learn-howto-end-example" lifted>
                <p className="learn-howto-end-example__label">Example</p>
                <div className="learn-howto-end-example__visual">
                  <div className="learn-howto-end-example__hand">
                    <span className="learn-howto-end-example__who">Fritz holds</span>
                    <DominoTile tile={{ low: 3, high: 5 }} size={76} />
                    <span className="learn-howto-end-example__pips">8 pips</span>
                  </div>
                  <span className="learn-howto-end-example__arrow" aria-hidden="true">
                    →
                  </span>
                  <p className="learn-howto-end-example__score">
                    You score <strong>2</strong>
                  </p>
                </div>
                <p className="learn-howto-end-example__detail">
                  8 leftover pips ÷ 5, rounded = 2 race points to you.
                </p>
              </GlassCard>
              </div>
            </section>

            <section id="howto-compare" className="learn-howto-section learn-howto-section--anchor">
              <div className="learn-howto-section__head">
                <p className="learn-howto-section__label">Context</p>
                <h2 className="learn-howto-section__title">Racehorse vs standard dominoes</h2>
              </div>
              <GlassCard className="learn-howto-compare" accent="green" lifted>
                <div className="learn-howto-compare__row learn-howto-compare__row--head">
                  <div className="learn-howto-compare__cell learn-howto-compare__cell--head">Standard table</div>
                  <div className="learn-howto-compare__cell learn-howto-compare__cell--head learn-howto-compare__cell--rh">
                    Racehorse
                  </div>
                </div>
                {COMPARE_ROWS.map((row) => (
                  <div key={row.standard} className="learn-howto-compare__row">
                    <div className="learn-howto-compare__cell learn-howto-compare__cell--muted">{row.standard}</div>
                    <div className="learn-howto-compare__cell learn-howto-compare__cell--rh">{row.racehorse}</div>
                  </div>
                ))}
              </GlassCard>
            </section>

            <GlassCard accent="green" className="learn-howto-footer" lifted>
              <p className="learn-howto-footer__lead">Ready to learn by playing?</p>
              <p className="learn-howto-footer__note">Put it into practice</p>
              <div className="learn-howto-footer__actions">
              <Button
                variant="tier-rookie"
                size="lg"
                className="learn-howto-footer__btn"
                type="button"
                onClick={onStartGuidedMatch}
                disabled={!onStartGuidedMatch}
              >
                Start Guided Match
              </Button>
              <Button
                variant="tier-elite"
                size="lg"
                className="learn-howto-footer__btn"
                type="button"
                onClick={onPlayVsFritz}
                disabled={!onPlayVsFritz}
              >
                Play vs Fritz
              </Button>
              <Button variant="outline" size="lg" className="learn-howto-footer__btn" type="button" onClick={onBack}>
                Back to Learn
              </Button>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  );
}
