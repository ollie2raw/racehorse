import type { Tile } from '../../types';
import {
  DoublesCompareDiagram,
  MiniChainDiagram,
  OpenCountCalc,
} from '../LearnHowToPlayDiagrams';
import type { HowToPlayVisualType } from './howToPlayModules';
import { HOW_TO_PLAY_MATCH_TARGET } from './howToPlayModules';

function t(low: number, high: number): Tile {
  return { low, high };
}

const INTRO_BEATS = [
  { label: 'Must play', detail: 'Legal tile? You play it.', accent: 'learn' as const },
  { label: 'Keep turn', detail: 'Score or double → again.', accent: 'gold' as const },
  { label: 'Auto draw', detail: 'Blocked? Game draws.', accent: 'learn' as const },
  { label: `Race to ${HOW_TO_PLAY_MATCH_TARGET}`, detail: 'First to target wins.', accent: 'gold' as const },
];

const TURN_FLOW_STEPS = [
  { n: 1, title: 'Can you play?', detail: 'You must play.', accent: 'learn' as const },
  { n: 2, title: 'Score or double?', detail: 'Keep your turn.', accent: 'gold' as const },
  { n: 3, title: 'Blocked?', detail: 'Racehorse draws.', accent: 'learn' as const },
  { n: 4, title: 'Pile locked?', detail: 'Auto-pass.', accent: 'gold' as const },
];

type HowToPlayVisualsProps = {
  visual: HowToPlayVisualType;
};

export function HowToPlayVisuals({ visual }: HowToPlayVisualsProps) {
  switch (visual) {
    case 'intro-beats':
      return (
        <ul className="learn-howto-pvf__beat-grid" aria-label="Racehorse basics">
          {INTRO_BEATS.map((beat) => (
            <li
              key={beat.label}
              className={`learn-howto-pvf__beat-card learn-howto-pvf__beat-card--${beat.accent}`}
            >
              <span className="learn-howto-pvf__beat-label">{beat.label}</span>
              <span className="learn-howto-pvf__beat-detail">{beat.detail}</span>
            </li>
          ))}
        </ul>
      );

    case 'turn-flow':
      return (
        <ol className="learn-howto-pvf__flow" aria-label="Turn flow">
          {TURN_FLOW_STEPS.map((step, i) => (
            <li key={step.n} className={`learn-howto-pvf__flow-step learn-howto-pvf__flow-step--${step.accent}`}>
              <span className="learn-howto-pvf__flow-num">{step.n}</span>
              <div className="learn-howto-pvf__flow-copy">
                <span className="learn-howto-pvf__flow-title">{step.title}</span>
                <span className="learn-howto-pvf__flow-detail">{step.detail}</span>
              </div>
              {i < TURN_FLOW_STEPS.length - 1 ? (
                <span className="learn-howto-pvf__flow-connector" aria-hidden="true" />
              ) : null}
            </li>
          ))}
        </ol>
      );

    case 'scoring-open-count':
      return (
        <div className="learn-howto-pvf__demo-stack">
          <MiniChainDiagram
            className="learn-howto-pvf__diagram"
            tiles={[{ tile: t(5, 5), highlight: 'gold' }, { tile: t(5, 2) }, { tile: t(2, 3) }]}
            ends={[
              { label: 'active end', value: 5, tone: 'active' },
              { label: 'active end', value: 3, tone: 'active' },
            ]}
            caption="Active scoring ends set your open count."
          />
          <OpenCountCalc
            parts={[
              { label: 'left', value: 5 },
              { label: 'right', value: 5 },
            ]}
            total={10}
            scores
            racePoints={2}
            footnote="10 ÷ 5 = 2 race points on this play."
          />
        </div>
      );

    case 'doubles-compare':
      return (
        <div className="learn-howto-pvf__demo-stack learn-howto-pvf__demo-stack--doubles">
          <DoublesCompareDiagram
            openEnds={[
              { label: 'active end', value: 3, tone: 'active' },
              { label: 'open double', value: 12, tone: 'gold', note: 'full count' },
              { label: 'active end', value: 2, tone: 'active' },
            ]}
          />
        </div>
      );

    case 'win-guided':
      return (
        <div className="learn-howto-pvf__win-demo">
          <div className="learn-howto-pvf__outcome-grid">
            <div className="learn-howto-pvf__outcome-card learn-howto-pvf__outcome-card--learn">
              <span className="learn-howto-pvf__outcome-tag">Go out</span>
              <p>Play your last tile. Opponent pips → race points.</p>
            </div>
            <div className="learn-howto-pvf__outcome-card learn-howto-pvf__outcome-card--gold">
              <span className="learn-howto-pvf__outcome-tag">Pip win</span>
              <p>Locked pile? Leftover pips still decide the hand.</p>
            </div>
          </div>
          <div className="learn-howto-pvf__race-strip">
            <span className="learn-howto-pvf__race-label">Race to {HOW_TO_PLAY_MATCH_TARGET}</span>
            <div className="learn-howto-pvf__race-bar">
              <span className="learn-howto-pvf__race-fill" style={{ width: '48%' }} />
            </div>
            <span className="learn-howto-pvf__race-note">One swing hand can flip it</span>
          </div>
        </div>
      );

    default:
      return null;
  }
}
