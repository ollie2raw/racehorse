import type { Tile } from '../../types';
import {
  BranchBoardDiagram,
  ChainRoadmapDiagram,
  MiniChainDiagram,
  OpenCountCalc,
} from '../LearnHowToPlayDiagrams';
import type { HowToPlayVisualType } from '../howToPlay/howToPlayModules';
import {
  HOW_TO_PLAY_BONEYARD_DRAWABLE,
  HOW_TO_PLAY_BONEYARD_LOCKED,
  HOW_TO_PLAY_MATCH_TARGET,
} from '../howToPlay/howToPlayModules';
import {
  LearnIconDraw,
  LearnIconLock,
  LearnIconRefresh,
  LearnIconTile,
  LearnIconTrophy,
} from './LearnIcons';

function t(low: number, high: number): Tile {
  return { low, high };
}

const RHYTHM_TILES = [
  { key: 'must', name: 'Must play', desc: 'Legal tile? You play it.', accent: 'mint', Icon: LearnIconTile },
  { key: 'keep', name: 'Keep turn', desc: 'Score or double → again.', accent: 'gold', Icon: LearnIconRefresh },
  { key: 'draw', name: 'Auto draw', desc: 'Blocked? Game draws.', accent: 'mint', Icon: LearnIconDraw },
  {
    key: 'race',
    name: `Race to ${HOW_TO_PLAY_MATCH_TARGET}`,
    desc: 'First to target wins.',
    accent: 'gold',
    Icon: LearnIconTrophy,
  },
] as const;

type AcademyVisualsProps = {
  visual: HowToPlayVisualType;
};

export function AcademyVisuals({ visual }: AcademyVisualsProps) {
  switch (visual) {
    case 'intro-beats':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--intro">
          <p className="learn-academy__section-label">Core rhythm</p>
          <div className="learn-academy__rhythm-grid">
            {RHYTHM_TILES.map(({ key, name, desc, accent, Icon }) => (
              <article
                key={key}
                className={`learn-academy__rhythm-card learn-academy__rhythm-card--${accent}`}
              >
                <div className={`learn-academy__rhythm-icon learn-academy__rhythm-icon--${accent}`}>
                  <Icon />
                </div>
                <h3 className="learn-academy__rhythm-title">{name}</h3>
                <p className="learn-academy__rhythm-desc">{desc}</p>
              </article>
            ))}
          </div>
        </div>
      );

    case 'turn-flow':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--pipeline">
          <p className="learn-academy__section-label">Decision pipeline</p>
          <div className="learn-academy__pipeline">
            <div className="learn-academy__pipe learn-academy__pipe--mint">
              <span className="learn-academy__pipe-n">1</span>
              <LearnIconTile />
              <strong>Can you play?</strong>
              <span>You must play.</span>
            </div>
            <span className="learn-academy__pipe-line" aria-hidden="true" />
            <div className="learn-academy__pipe learn-academy__pipe--gold">
              <span className="learn-academy__pipe-n">2</span>
              <LearnIconRefresh />
              <strong>Score or double?</strong>
              <span>Keep your turn.</span>
            </div>
            <span className="learn-academy__pipe-line" aria-hidden="true" />
            <div className="learn-academy__pipe learn-academy__pipe--mint">
              <span className="learn-academy__pipe-n">3</span>
              <LearnIconDraw />
              <strong>Blocked?</strong>
              <span>Racehorse draws.</span>
            </div>
            <span className="learn-academy__pipe-line" aria-hidden="true" />
            <div className="learn-academy__pipe learn-academy__pipe--muted">
              <span className="learn-academy__pipe-n">4</span>
              <LearnIconLock />
              <strong>Pile locked?</strong>
              <span>Auto-pass.</span>
            </div>
          </div>
        </div>
      );

    case 'scoring-open-count':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--scoring">
          <p className="learn-academy__section-label">Board + open count</p>
          <div className="learn-academy__board-frame">
            <MiniChainDiagram
              tiles={[
                { tile: t(5, 5), highlight: 'gold' },
                { tile: t(5, 2) },
                { tile: t(2, 5) },
              ]}
              ends={[
                { label: 'left end', value: 5, tone: 'active' },
                { label: 'right end', value: 5, tone: 'active' },
              ]}
            />
          </div>
          <OpenCountCalc
            parts={[
              { label: 'left', value: 5 },
              { label: 'right', value: 5 },
            ]}
            total={10}
            scores
            racePoints={2}
            footnote="10 ÷ 5 = 2 race points"
          />
        </div>
      );

    case 'doubles-compare':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--doubles">
          <p className="learn-academy__section-label">Double power</p>
          <span className="learn-academy__tempo-pill">Double = play again</span>
          <div className="learn-academy__double-row">
            <div className="learn-academy__double-pane">
              <span className="learn-academy__pane-label">Open double</span>
              <MiniChainDiagram
                tiles={[
                  { tile: t(3, 5) },
                  { tile: t(6, 6), rotation: 90, highlight: 'gold' },
                  { tile: t(5, 2) },
                ]}
                ends={[
                  { label: 'active', value: 3, tone: 'active' },
                  { label: 'open double', value: 12, tone: 'gold', note: 'full' },
                  { label: 'active', value: 2, tone: 'active' },
                ]}
              />
            </div>
            <div className="learn-academy__double-pane">
              <span className="learn-academy__pane-label">Crossed double</span>
              <BranchBoardDiagram
                mainTiles={[{ tile: t(4, 1) }, { tile: t(1, 3) }]}
                hubTile={t(3, 3)}
                crossed
                branches={[
                  {
                    side: 'left',
                    tiles: [{ tile: t(3, 5) }],
                    end: { label: 'tip', value: 5, tone: 'active' },
                  },
                  {
                    side: 'right',
                    tiles: [],
                    end: { label: 'phantom', value: 0, tone: 'muted', note: 'no count' },
                  },
                ]}
              />
            </div>
          </div>
        </div>
      );

    case 'chains-runs':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--chains">
          <p className="learn-academy__section-label">Chain → run</p>
          <ChainRoadmapDiagram
            steps={[
              { label: 'Setup', detail: '5-6 on the 5 — opens the lane', tile: t(5, 6) },
              { label: 'Tempo', detail: '6-6 keeps your turn', tile: t(6, 6), rotation: 90 },
              { label: 'Payoff', detail: 'Finish for race points', tile: t(0, 4) },
            ]}
          />
          <p className="learn-academy__meter">
            <strong>{HOW_TO_PLAY_BONEYARD_DRAWABLE} drawable</strong> +{' '}
            <strong>{HOW_TO_PLAY_BONEYARD_LOCKED} locked</strong> — pressure the draw, runs follow.
          </p>
        </div>
      );

    case 'win-guided':
      return (
        <div className="learn-academy__visual-inner learn-academy__visual--finish">
          <p className="learn-academy__finish-lead">
            You know the rules. Now learn the rhythm in a real hand.
          </p>
          <div className="pvf-deal-grid learn-academy__finish-grid">
            <div className="pvf-deal-card learn-academy__finish-card learn-academy__finish-card--mint">
              <div className="pvf-deal-icon">
                <LearnIconTile />
              </div>
              <div>
                <div className="pvf-deal-label">Go out</div>
                <div className="pvf-deal-sub">Last tile played — opponent pips become race points.</div>
              </div>
            </div>
            <div className="pvf-deal-card learn-academy__finish-card learn-academy__finish-card--gold">
              <div className="pvf-deal-icon">
                <LearnIconTrophy />
              </div>
              <div>
                <div className="pvf-deal-label">Pip win</div>
                <div className="pvf-deal-sub">Locked pile? Leftover pips still decide the hand.</div>
              </div>
            </div>
          </div>
          <div className="learn-academy__race-meter">
            <span className="learn-academy__race-meter-label">Race to {HOW_TO_PLAY_MATCH_TARGET}</span>
            <div className="pvf-slider-track learn-academy__race-track">
              <div className="pvf-slider-fill learn-academy__race-fill" style={{ width: '52%' }} />
            </div>
            <span className="learn-academy__race-meter-note">One swing hand can flip it</span>
          </div>
        </div>
      );

    default:
      return null;
  }
}
