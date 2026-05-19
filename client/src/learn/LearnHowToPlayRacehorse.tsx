import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { DominoTile, GlobalNav } from '../components';
import { GlassCard } from '../components/primitives';
import type { AppMode, Tile } from '../types';
import '../screens/RacehorseHomeArt.css';
import '../screens/SinglePlayerModes.css';
import './learn.css';
import './learnHowToPlayRacehorse.css';
import {
  BranchBoardDiagram,
  MiniChainDiagram,
  OpenCountCalc,
} from './LearnHowToPlayDiagrams';

const MATCH_RACE_TARGET = 60;

/** Standard 7-tile deal: 14 tiles in the boneyard; final 2 are never drawable. */
const BONEYARD_DRAWABLE = 12;
const BONEYARD_LOCKED = 2;
const BONEYARD_TOTAL = BONEYARD_DRAWABLE + BONEYARD_LOCKED;

const themeVars = {
  '--rh-bg': '#050911',
  '--rh-panel': '#09101A',
  '--rh-brass': '#D7A64A',
  '--rh-green': '#67D957',
  '--rh-text': '#F2EEE8',
} as CSSProperties;

/** One beginner question per screen — rules gateway before Guided Match. */
const PAGE_LABELS = [
  'Welcome',
  'Your Turn',
  'Must Play',
  'Forced Draw',
  'Auto Pass',
  'Opening',
  'Score & Continue',
  'Doubles',
  'Open Count',
  'Two Ends',
  'Open Double',
  'Crossed Double',
  'Branch Tips',
  'Last Tile',
  'Win the Race',
  'Ready',
] as const;

const PAGE_COUNT = PAGE_LABELS.length;

const FOUR_IDEAS = [
  { title: 'Play if you can', line: 'A legal move means you must play it.', gold: false },
  { title: 'Draws are automatic', line: 'Blocked? Racehorse draws for you — no Draw button.', gold: false },
  { title: 'Score & doubles', line: 'Multiples of five score; doubles extend your turn.', gold: true },
  { title: `Race to ${MATCH_RACE_TARGET}`, line: 'Hand points stack on the score track.', gold: true },
] as const;

const TURN_LOOP_STEPS = [
  {
    question: 'Can you play a tile?',
    detail: 'If yes — you must play. There is no manual Draw or Pass while a legal move exists.',
  },
  {
    question: 'Did you score or play a double?',
    detail: 'Either one keeps your turn going so you can play again.',
  },
  {
    question: 'Blocked with nothing to play?',
    detail: `Racehorse draws from the boneyard until you get a playable tile — or until only the ${BONEYARD_LOCKED} locked tiles remain (${BONEYARD_DRAWABLE} drawable tiles per hand).`,
  },
  {
    question: 'Still blocked when the boneyard is locked?',
    detail: `Those last ${BONEYARD_LOCKED} tiles cannot be drawn. If you still have no play, the game passes for you automatically. You never tap Pass.`,
  },
] as const;

const READY_RECAP = [
  'If you can play, you must play.',
  `Boneyard: ${BONEYARD_DRAWABLE} drawable tiles per hand; ${BONEYARD_LOCKED} always locked.`,
  'Drawing and passing are automatic — never manual.',
  'Open Count on the board; non-zero multiples of five score.',
  'Open doubles count fully until crossed; then only real branch tips count.',
  `First to ${MATCH_RACE_TARGET} on the race track wins the match.`,
] as const;

function t(low: number, high: number): Tile {
  return { low, high };
}

function PageHead({
  kicker,
  title,
  lede,
  gold,
}: {
  kicker: string;
  title: string;
  lede?: string;
  gold?: boolean;
}) {
  return (
    <header className="learn-howto-slide__head">
      <p className={`learn-howto-slide__kicker${gold ? ' learn-howto-slide__kicker--gold' : ''}`}>{kicker}</p>
      <h2 className="learn-howto-slide__title">{title}</h2>
      {lede ? <p className="learn-howto-slide__lede">{lede}</p> : null}
    </header>
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
  onPlayVsFritz?: () => void;
}

export default function LearnHowToPlayRacehorse({
  onBack,
  onNavigate,
  onStartGuidedMatch,
  onPlayVsFritz,
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
          <div className="learn-howto-hero">
            <p className="learn-howto-hero__kicker">Learn · Racehorse</p>
            <h1 className="learn-howto-hero__title">How to Play Racehorse</h1>
            <p className="learn-howto-hero__subtitle">
              Four ideas that explain how every hand works — before you play your first match.
            </p>
            <div className="learn-howto-four-ideas" aria-label="Racehorse in four ideas">
              {FOUR_IDEAS.map((idea) => (
                <div
                  key={idea.title}
                  className={`learn-howto-four-ideas__card${idea.gold ? ' learn-howto-four-ideas__card--gold' : ''}`}
                >
                  <p className="learn-howto-four-ideas__title">{idea.title}</p>
                  <p className="learn-howto-four-ideas__line">{idea.line}</p>
                </div>
              ))}
            </div>
            <p className="learn-howto-hero__hint">{PAGE_COUNT} screens · about 4 minutes · rules only</p>
          </div>
        );

      case 1:
        return (
          <div className="learn-howto-pvf-slide">
            <PageHead
              kicker="Turn rhythm"
              title="Your turn, step by step"
              lede="Memorize this loop first. Scoring details come next — this is how Racehorse always moves."
            />
            <div className="learn-howto-turn-loop" role="list">
              {TURN_LOOP_STEPS.map((step, i) => (
                <div key={step.question} className="learn-howto-turn-loop__step" role="listitem">
                  <span className="learn-howto-turn-loop__num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <p className="learn-howto-turn-loop__q">{step.question}</p>
                    <p className="learn-howto-turn-loop__detail">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <aside className="learn-howto-boneyard-fact" aria-label="Boneyard size each hand">
              <p className="learn-howto-boneyard-fact__label">Boneyard every hand</p>
              <div className="learn-howto-boneyard-fact__chips">
                <span className="learn-howto-boneyard-fact__chip learn-howto-boneyard-fact__chip--draw">
                  <strong>{BONEYARD_DRAWABLE}</strong> drawable
                </span>
                <span className="learn-howto-boneyard-fact__chip learn-howto-boneyard-fact__chip--lock">
                  <strong>{BONEYARD_LOCKED}</strong> locked
                </span>
                <span className="learn-howto-boneyard-fact__chip learn-howto-boneyard-fact__chip--total">
                  <strong>{BONEYARD_TOTAL}</strong> in the pile
                </span>
              </div>
              <p className="learn-howto-boneyard-fact__body">
                After each player gets 7 tiles, {BONEYARD_TOTAL} tiles sit in the boneyard. Two are always locked —
                they never leave the pile — so only {BONEYARD_DRAWABLE} can be drawn this hand ({BONEYARD_LOCKED}/
                {BONEYARD_TOTAL} stay dead).
              </p>
            </aside>
          </div>
        );

      case 2:
        return (
          <SlidePanel>
            <PageHead
              kicker="Rule 1"
              title="If you can play, you must"
              lede="Racehorse never lets you stall. When a tile fits the board, the game expects you to play it."
            />
            <p className="learn-howto-slide__mini">
              That is why you will not see working Draw or Pass buttons during a normal turn.
            </p>
            <div className="learn-howto-fake-controls" aria-hidden="true">
              <span className="learn-howto-fake-controls__btn learn-howto-fake-controls__btn--blocked">Draw</span>
              <span className="learn-howto-fake-controls__btn learn-howto-fake-controls__btn--blocked">Pass</span>
              <span className="learn-howto-fake-controls__btn">Play tile</span>
            </div>
            <MiniChainDiagram
              tiles={[{ tile: t(3, 4) }, { tile: t(4, 6) }]}
              ends={[
                { label: 'you match', value: 3, tone: 'active' },
                { label: 'open end', value: 6, tone: 'active' },
              ]}
              caption="Legal move on the board? You must take it."
            />
          </SlidePanel>
        );

      case 3:
        return (
          <SlidePanel>
            <PageHead
              kicker="Rule 2"
              title="Blocked? Racehorse draws for you"
              lede="If nothing in your hand matches the board, the game pulls tiles from the boneyard — one at a time — until you can play or the pile locks."
            />
            <ol className="learn-howto-draw-steps">
              <li>
                <span className="learn-howto-draw-steps__num">1</span>
                <div>
                  <strong>No playable tile</strong>
                  <p>Forced draw begins automatically. You do not tap anything.</p>
                </div>
              </li>
              <li>
                <span className="learn-howto-draw-steps__num">2</span>
                <div>
                  <strong>Draw until you can play</strong>
                  <p>As soon as a drawn tile fits, you must play it on that same turn.</p>
                </div>
              </li>
              <li>
                <span className="learn-howto-draw-steps__num">3</span>
                <div>
                  <strong>Or the boneyard locks</strong>
                  <p>
                    When only the {BONEYARD_LOCKED} locked tiles remain ({BONEYARD_DRAWABLE} draws used or skipped), nothing
                    left is drawable. Next screen: automatic pass.
                  </p>
                </div>
              </li>
            </ol>
          </SlidePanel>
        );

      case 4:
        return (
          <SlidePanel>
            <PageHead
              kicker="Rule 3"
              title="Passing happens automatically"
              lede="You never choose to pass. It only happens when you are blocked and the boneyard cannot help you anymore."
            />
            <div className="learn-howto-slide__compare-cards">
              <GlassCard accent="green" className="learn-howto-slide__compare-card" lifted>
                <span className="learn-howto-slide__compare-topic">Drawable boneyard</span>
                <p>Still blocked? Forced draw keeps going until you find a play or the last two tiles lock.</p>
              </GlassCard>
              <GlassCard accent="gold" className="learn-howto-slide__compare-card" lifted>
                <span className="learn-howto-slide__compare-topic">Locked boneyard</span>
                <p>Still blocked with no tiles left to draw? Your turn ends with an automatic pass.</p>
              </GlassCard>
            </div>
            <p className="learn-howto-slide__mini">
              Locked means the same {BONEYARD_LOCKED} tiles reserved every hand — only {BONEYARD_DRAWABLE} of{' '}
              {BONEYARD_TOTAL} boneyard tiles can ever be drawn.
            </p>
          </SlidePanel>
        );

      case 5:
        return (
          <SlidePanel accent="gold">
            <PageHead
              kicker="Every hand"
              title="How the first tile works"
              lede="The opening play must be a double or a scoring tile. If you have neither, forced draw runs until you do — or the boneyard locks."
              gold
            />
            <div className="learn-howto-slide__double-snap">
              <GlassCard accent="gold" className="learn-howto-doubles-card learn-howto-doubles-card--compact" lifted>
                <p className="learn-howto-doubles-card__phase">Valid opener · double</p>
                <DominoTile tile={t(6, 6)} size={72} rotation={90} />
                <p className="learn-howto-slide__mini">Doubles are always legal openers.</p>
              </GlassCard>
              <GlassCard accent="gold" className="learn-howto-doubles-card learn-howto-doubles-card--compact" lifted>
                <p className="learn-howto-doubles-card__phase">Valid opener · scores</p>
                <MiniChainDiagram
                  tiles={[{ tile: t(5, 5), rotation: 90 }]}
                  ends={[{ label: 'Open Count', value: 10, tone: 'gold' }]}
                  caption="A lone double 5 opens with Open Count 10 — you score 2 and keep your turn."
                />
              </GlassCard>
            </div>
          </SlidePanel>
        );

      case 6:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead
              kicker="Scoring"
              title="Score and keep your turn"
              lede="When Open Count on the board is a non-zero multiple of five, you earn race points and play again."
              gold
            />
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
              footnote="Open Count 5 → score 1 race point (5 ÷ 5) and your turn continues."
            />
          </SlidePanel>
        );

      case 7:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead
              kicker="Tempo"
              title="Doubles keep your turn"
              lede="Playing any double extends your turn — even when Open Count does not score. Doubles also shape the board for later scoring."
              gold
            />
            <div className="learn-howto-doubles-card__visual">
              <DominoTile tile={t(4, 4)} size={80} rotation={90} />
            </div>
            <p className="learn-howto-slide__mini">
              An open double counts fully toward Open Count until someone crosses it. We will show that on the next screens.
            </p>
          </SlidePanel>
        );

      case 8:
        return (
          <SlidePanel accent="gold">
            <PageHead
              kicker="Scoring signal"
              title="What is Open Count?"
              lede="The sum of every active scoring end on the board. That number tells you whether your next scoring play is available."
              gold
            />
            <p className="learn-howto-open-hub__formula">
              Open Count = <span className="learn-howto-gold">sum of active scoring ends</span>
            </p>
            <ul className="learn-howto-open-hub__rules learn-howto-open-hub__rules--compact">
              <li>
                <strong>Normal end</strong> — one exposed pip on the chain.
              </li>
              <li>
                <strong>Open double</strong> — full tile value while still open.
              </li>
              <li>
                <strong>Crossed double</strong> — drops out; only real branch tips count.
              </li>
              <li>
                <strong>Empty branch</strong> — never adds phantom points.
              </li>
            </ul>
          </SlidePanel>
        );

      case 9:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead kicker="Example" title="Two open ends" lede="The simplest board: add the two exposed pips." gold />
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
              footnote="1 + 4 = 5 → you score and play again."
            />
          </SlidePanel>
        );

      case 10:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead kicker="Example" title="Open double" lede="A double still open counts its full value — not just one side." gold />
            <MiniChainDiagram
              tiles={[
                { tile: t(3, 5) },
                { tile: t(6, 6), rotation: 90, highlight: 'gold' },
                { tile: t(5, 2) },
              ]}
              ends={[
                { label: 'active end', value: 3, tone: 'active' },
                { label: 'open double', value: 12, tone: 'gold', note: 'full tile' },
                { label: 'active end', value: 2, tone: 'active' },
              ]}
            />
            <OpenCountCalc
              parts={[
                { label: 'left', value: 3 },
                { label: 'double', value: 12, tone: 'gold' },
                { label: 'right', value: 2 },
              ]}
              total={17}
              footnote="17 is not a multiple of five — no score on this board."
            />
          </SlidePanel>
        );

      case 11:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead
              kicker="Example"
              title="Crossed double"
              lede="Once both sides of a double have a branch, the double leaves Open Count."
              gold
            />
            <BranchBoardDiagram
              mainTiles={[{ tile: t(4, 1) }, { tile: t(1, 3) }]}
              hubTile={t(3, 3)}
              crossed
              branches={[
                {
                  side: 'left',
                  tiles: [{ tile: t(3, 5) }],
                  end: { label: 'branch tip', value: 5, tone: 'active' },
                },
                {
                  side: 'right',
                  tiles: [],
                  end: { label: 'empty slot', value: 0, tone: 'muted', note: 'does not count' },
                },
              ]}
            />
            <OpenCountCalc
              parts={[
                { label: 'main L', value: 4 },
                { label: 'branch', value: 5 },
                { label: 'main R', value: 3 },
              ]}
              total={12}
              footnote="Count real tips only — empty branches add nothing."
            />
          </SlidePanel>
        );

      case 12:
        return (
          <SlidePanel accent="gold" visual>
            <PageHead
              kicker="Example"
              title="Multiple branch tips"
              lede="Racehorse is not always “two ends.” Count every real active scoring tip."
              gold
            />
            <BranchBoardDiagram
              mainTiles={[{ tile: t(6, 0) }]}
              hubTile={t(5, 5)}
              crossed
              branches={[
                {
                  side: 'left',
                  tiles: [{ tile: t(2, 5) }],
                  end: { label: 'tip', value: 2, tone: 'active' },
                },
                {
                  side: 'right',
                  tiles: [{ tile: t(4, 5) }, { tile: t(3, 4) }],
                  end: { label: 'tip', value: 3, tone: 'active' },
                },
              ]}
            />
            <OpenCountCalc
              parts={[
                { label: 'main', value: 6 },
                { label: 'branch A', value: 2 },
                { label: 'branch B', value: 3 },
              ]}
              total={11}
            />
          </SlidePanel>
        );

      case 13:
        return (
          <SlidePanel>
            <PageHead
              kicker="Hand endings"
              title="Last tile & ending the hand"
              lede="Going out ends the hand — but a last tile that scores or is a double can still force one more draw if the boneyard has drawable tiles."
            />
            <div className="learn-howto-slide__end-pair">
              <GlassCard accent="green" className="learn-howto-end-card" lifted>
                <h3 className="learn-howto-end-card__title">Go out</h3>
                <p>Play your last tile when the hand can end. Leftover pips in your opponent&apos;s hand become race points.</p>
              </GlassCard>
              <GlassCard accent="gold" className="learn-howto-end-card" lifted>
                <h3 className="learn-howto-end-card__title">Last tile scores or doubles</h3>
                <p>
                  Drawable boneyard → you play it, score if applicable, then forced draw continues. Locked boneyard → the
                  hand can end.
                </p>
              </GlassCard>
            </div>
            <GlassCard accent="green" className="learn-howto-end-card" lifted>
              <h3 className="learn-howto-end-card__title">Block</h3>
              <p>No one can play and the boneyard is locked — lowest pips wins leftover race points for that hand.</p>
            </GlassCard>
          </SlidePanel>
        );

      case 14:
        return (
          <div className="learn-howto-pvf-slide">
            <PageHead
              kicker="Match goal"
              title={`Race points & winning to ${MATCH_RACE_TARGET}`}
              lede="Points arrive during the hand and again when the hand ends."
              gold
            />
            <div className="learn-howto-race-strip">
              <div className="learn-howto-race-strip__row">
                <span className="learn-howto-race-strip__label">During play</span>
                <span className="learn-howto-race-strip__value">Open Count scores</span>
              </div>
              <p className="learn-howto-race-strip__detail">
                Non-zero multiples of five on the board become race points immediately (÷5), and your turn usually
                continues.
              </p>
            </div>
            <div className="learn-howto-race-strip">
              <div className="learn-howto-race-strip__row">
                <span className="learn-howto-race-strip__label">End of hand</span>
                <span className="learn-howto-race-strip__value">Pip penalty</span>
              </div>
              <p className="learn-howto-race-strip__detail">
                After go-out or block, leftover pips convert: divide by five and round to the nearest whole number.
              </p>
            </div>
            <GlassCard accent="gold" className="learn-howto-end-example learn-howto-end-example--compact" lifted>
              <div className="learn-howto-end-example__visual">
                <div className="learn-howto-end-example__hand">
                  <span className="learn-howto-end-example__who">Opponent holds</span>
                  <DominoTile tile={t(3, 5)} size={64} />
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
          </div>
        );

      case 15:
        return (
          <div className="learn-howto-pvf-slide learn-howto-pvf-slide--finish">
            <PageHead
              kicker="Next step"
              title="You know the rules"
              lede="Next, Fritz teaches you how to think through a real hand — chains, tempo, and when to draw for power. That is Guided Match, not this lesson."
            />
            <ul className="learn-howto-checklist learn-howto-checklist--final learn-howto-checklist--pager" aria-label="Rules recap">
              {READY_RECAP.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
            <div className="learn-howto-slide__cta-grid">
              {onStartGuidedMatch ? (
                <button
                  type="button"
                  className="pvf-start-btn learn-howto-cta--primary"
                  onClick={onStartGuidedMatch}
                >
                  <span>Guided Match</span>
                  <span className="pvf-start-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ) : null}
              <button type="button" className="pvf-start-btn" onClick={() => onNavigate?.('noBrainer')}>
                <span>Start Practice</span>
                <span className="pvf-start-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                type="button"
                className="pvf-start-btn pvf-start-btn--elite"
                onClick={onPlayVsFritz}
                disabled={!onPlayVsFritz}
              >
                <span>Play vs Fritz</span>
                <span className="pvf-start-arrow" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                type="button"
                className="pvf-start-btn pvf-start-btn--standard"
                onClick={() => onNavigate?.('singlePlayerHub')}
              >
                <span>Single Player Hub</span>
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
      className="learn-howto-page learn-howto-page--pager learn-howto-page--immersive learn-pvf-root tier-rookie home-page-root text-[var(--rh-text)]"
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
            <div className="learn-howto-pager__dots" role="tablist" aria-label="Tutorial pages">
              {PAGE_LABELS.map((label, i) => (
                <button
                  key={label}
                  type="button"
                  role="tab"
                  aria-selected={page === i}
                  aria-label={`${label}, page ${i + 1}`}
                  className={`learn-howto-pager__dot${page === i ? ' learn-howto-pager__dot--active' : ''}${
                    i < page ? ' learn-howto-pager__dot--done' : ''
                  }`}
                  onClick={() => goTo(i)}
                />
              ))}
            </div>
          </header>

          <main key={page} className="learn-howto-immersive__stage" role="tabpanel" aria-label={PAGE_LABELS[page]}>
            <div
              className={`learn-howto-immersive__content${page === 0 ? ' learn-howto-immersive__content--hero' : ''}`}
            >
              {renderSlide()}
            </div>
          </main>

          <footer className="learn-howto-immersive__dock">
            <button
              type="button"
              className="learn-howto-dock-btn learn-howto-dock-btn--back"
              onClick={isFirst ? onBack : goPrev}
            >
              {isFirst ? 'Exit' : 'Back'}
            </button>
            {isLast ? (
              <button type="button" className="learn-howto-dock-btn learn-howto-dock-btn--next" onClick={onBack}>
                Done
              </button>
            ) : (
              <button type="button" className="learn-howto-dock-btn learn-howto-dock-btn--next" onClick={goNext}>
                {isFirst ? 'Begin' : 'Next'}
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
