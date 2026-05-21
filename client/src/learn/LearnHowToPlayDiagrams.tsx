import { DominoTile } from '../components';
import type { Tile } from '../types';
import './learnHowToPlayDiagrams.css';

export type EndMarkerTone = 'active' | 'gold' | 'muted' | 'drop';

export interface ChainTileSpec {
  tile: Tile;
  rotation?: 0 | 90;
  highlight?: 'gold' | 'blue';
}

export interface EndMarkerSpec {
  label: string;
  value: number;
  tone?: EndMarkerTone;
  note?: string;
}

interface MiniChainDiagramProps {
  tiles: ChainTileSpec[];
  ends?: EndMarkerSpec[];
  caption?: string;
  className?: string;
}

export function MiniChainDiagram({ tiles, ends = [], caption, className = '' }: MiniChainDiagramProps) {
  return (
    <figure className={`learn-howto-diagram ${className}`.trim()}>
      <div className="learn-howto-diagram__board">
        <div className="learn-howto-diagram__chain">
          {tiles.map((spec, i) => (
            <div
              key={`${spec.tile.low}-${spec.tile.high}-${i}`}
              className={`learn-howto-diagram__tile-wrap${
                spec.highlight ? ` learn-howto-diagram__tile-wrap--${spec.highlight}` : ''
              }`}
            >
              <DominoTile tile={spec.tile} size={64} rotation={spec.rotation ?? 0} />
            </div>
          ))}
        </div>
        {ends.length > 0 ? (
          <div className="learn-howto-diagram__ends">
            {ends.map((end) => (
              <EndMarker key={end.label} {...end} />
            ))}
          </div>
        ) : null}
      </div>
      {caption ? <figcaption className="learn-howto-diagram__caption">{caption}</figcaption> : null}
    </figure>
  );
}

function EndMarker({ label, value, tone = 'active', note }: EndMarkerSpec) {
  return (
    <div className={`learn-howto-diagram__end learn-howto-diagram__end--${tone}`}>
      <span className="learn-howto-diagram__end-label">{label}</span>
      <span className="learn-howto-diagram__end-value">{value}</span>
      {note ? <span className="learn-howto-diagram__end-note">{note}</span> : null}
    </div>
  );
}

interface OpenCountCalcProps {
  parts: { label: string; value: number; tone?: EndMarkerTone }[];
  total: number;
  scores?: boolean;
  footnote?: string;
  racePoints?: number;
}

export function OpenCountCalc({ parts, total, scores = false, footnote, racePoints }: OpenCountCalcProps) {
  return (
    <div className={`learn-howto-calc${scores ? ' learn-howto-calc--score' : ''}`}>
      <div className="learn-howto-calc__parts">
        {parts.map((part, i) => (
          <span key={part.label} className="learn-howto-calc__part">
            {i > 0 ? <span className="learn-howto-calc__op">+</span> : null}
            <span className={`learn-howto-calc__chip learn-howto-calc__chip--${part.tone ?? 'active'}`}>
              <span className="learn-howto-calc__chip-label">{part.label}</span>
              <span className="learn-howto-calc__chip-value">{part.value}</span>
            </span>
          </span>
        ))}
      </div>
      <span className="learn-howto-calc__eq">=</span>
      <span className="learn-howto-calc__total">{total}</span>
      {scores ? <span className="learn-howto-calc__badge">Scores</span> : null}
      {racePoints != null && scores ? (
        <p className="learn-howto-calc__race">
          <span className="learn-howto-calc__race-label">Race points</span>
          <strong>{racePoints}</strong>
          <span className="learn-howto-calc__race-formula">({total} ÷ 5)</span>
        </p>
      ) : null}
      {footnote ? <p className="learn-howto-calc__footnote">{footnote}</p> : null}
    </div>
  );
}

interface BranchBoardDiagramProps {
  mainTiles: ChainTileSpec[];
  hubTile: Tile;
  branches: {
    side: 'left' | 'right';
    tiles: ChainTileSpec[];
    end: EndMarkerSpec;
  }[];
  crossed?: boolean;
  caption?: string;
}

/** Simplified Y-shaped board for crossed-double / multi-tip teaching. */
export function BranchBoardDiagram({
  mainTiles,
  hubTile,
  branches,
  crossed = true,
  caption,
}: BranchBoardDiagramProps) {
  return (
    <figure className="learn-howto-diagram learn-howto-diagram--branch">
      <div className="learn-howto-diagram__board">
        <div className="learn-howto-diagram__branch-layout">
          <div className="learn-howto-diagram__branch-arm learn-howto-diagram__branch-arm--left">
            {branches
              .filter((b) => b.side === 'left')
              .map((b) => (
                <BranchArm key="left" tiles={b.tiles} end={b.end} />
              ))}
          </div>
          <div className="learn-howto-diagram__branch-hub">
            <div
              className={`learn-howto-diagram__hub-tile${
                crossed ? ' learn-howto-diagram__hub-tile--crossed' : ' learn-howto-diagram__hub-tile--open'
              }`}
            >
              <DominoTile tile={hubTile} size={68} rotation={90} />
              <span className="learn-howto-diagram__hub-tag">
                {crossed ? 'crossed · branches' : 'open double'}
              </span>
            </div>
            <div className="learn-howto-diagram__main-spine">
              {mainTiles.map((spec, i) => (
                <div key={`m-${i}`} className="learn-howto-diagram__tile-wrap">
                  <DominoTile tile={spec.tile} size={56} rotation={spec.rotation ?? 0} />
                </div>
              ))}
            </div>
          </div>
          <div className="learn-howto-diagram__branch-arm learn-howto-diagram__branch-arm--right">
            {branches
              .filter((b) => b.side === 'right')
              .map((b) => (
                <BranchArm key="right" tiles={b.tiles} end={b.end} />
              ))}
          </div>
        </div>
      </div>
      {caption ? <figcaption className="learn-howto-diagram__caption">{caption}</figcaption> : null}
    </figure>
  );
}

function BranchArm({ tiles, end }: { tiles: ChainTileSpec[]; end: EndMarkerSpec }) {
  return (
    <div className="learn-howto-diagram__branch-arm-inner">
      {tiles.map((spec, i) => (
        <div key={i} className="learn-howto-diagram__tile-wrap learn-howto-diagram__tile-wrap--blue">
          <DominoTile tile={spec.tile} size={52} rotation={spec.rotation ?? 0} />
        </div>
      ))}
      <EndMarker {...end} />
    </div>
  );
}

export interface ChainRoadmapStep {
  label: string;
  detail: string;
  tile: Tile;
  rotation?: 0 | 90;
}

interface ChainRoadmapDiagramProps {
  steps: ChainRoadmapStep[];
  caption?: string;
}

/** Guided Match chain: setup → double → finish. */
export function ChainRoadmapDiagram({ steps, caption }: ChainRoadmapDiagramProps) {
  return (
    <figure className="learn-howto-diagram learn-howto-diagram--roadmap">
      <ol className="learn-howto-roadmap">
        {steps.map((step, i) => (
          <li key={step.label} className="learn-howto-roadmap__step">
            <div className="learn-howto-roadmap__tile">
              <DominoTile tile={step.tile} size={58} rotation={step.rotation ?? 0} />
            </div>
            <div className="learn-howto-roadmap__copy">
              <span className="learn-howto-roadmap__label">{step.label}</span>
              <p className="learn-howto-roadmap__detail">{step.detail}</p>
            </div>
            {i < steps.length - 1 ? (
              <span className="learn-howto-roadmap__arrow" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {caption ? <figcaption className="learn-howto-diagram__caption">{caption}</figcaption> : null}
    </figure>
  );
}

interface DoublesCompareDiagramProps {
  openEnds: EndMarkerSpec[];
}

export function DoublesCompareDiagram({ openEnds }: DoublesCompareDiagramProps) {
  return (
    <div className="learn-howto-doubles-compare">
      <div className="learn-howto-doubles-compare__panel">
        <p className="learn-howto-doubles-compare__title">Open double</p>
        <MiniChainDiagram
          tiles={[
            { tile: { low: 3, high: 5 } },
            { tile: { low: 6, high: 6 }, rotation: 90, highlight: 'gold' },
            { tile: { low: 5, high: 2 } },
          ]}
          ends={openEnds}
        />
        <p className="learn-howto-doubles-compare__hint">Counts fully · extends tempo</p>
      </div>
      <div className="learn-howto-doubles-compare__panel">
        <p className="learn-howto-doubles-compare__title">Crossed double</p>
        <BranchBoardDiagram
          mainTiles={[{ tile: { low: 4, high: 1 } }, { tile: { low: 1, high: 3 } }]}
          hubTile={{ low: 3, high: 3 }}
          crossed
          branches={[
            {
              side: 'left',
              tiles: [{ tile: { low: 3, high: 5 } }],
              end: { label: 'branch tip', value: 5, tone: 'active' },
            },
            {
              side: 'right',
              tiles: [],
              end: { label: 'empty', value: 0, tone: 'muted', note: 'no phantom points' },
            },
          ]}
        />
        <p className="learn-howto-doubles-compare__hint">Branches only · real tips count</p>
      </div>
    </div>
  );
}
