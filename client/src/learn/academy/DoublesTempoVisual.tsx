import { Fragment } from 'react';
import LearnBoard from '../components/LearnBoard';
import {
  DOUBLES_TEMPO_BOARD_STAGE_1,
  DOUBLES_TEMPO_BOARD_STAGE_2,
  DOUBLES_TEMPO_BOARD_STAGE_3,
  DOUBLES_TEMPO_OPEN_COUNTS,
} from '../howToPlay/doublesTempoBoards';

const SPINE_ANCHOR = 0.58;

const STAGES = [
  {
    key: 'open',
    step: 1,
    title: 'OPEN DOUBLE',
    board: DOUBLES_TEMPO_BOARD_STAGE_1,
    values: [2, 8],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage1,
    scores: true,
  },
  {
    key: 'crossed',
    step: 2,
    title: 'CROSS THE DOUBLE',
    board: DOUBLES_TEMPO_BOARD_STAGE_2,
    values: [2, 3],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage2,
    scores: true,
  },
  {
    key: 'branch',
    step: 3,
    title: 'PLAY THE BRANCH',
    board: DOUBLES_TEMPO_BOARD_STAGE_3,
    values: [2, 3, 5],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage3,
    scores: true,
  },
] as const;

function formatCountAria(values: readonly number[], total: number): string {
  return `${values.join(' plus ')} equals ${total}`;
}

function DoublesOpenCountRow({
  values,
  total,
  scores,
}: {
  values: readonly number[];
  total: number;
  scores: boolean;
}) {
  const partCount = values.length;

  return (
    <div
      className={`learn-academy__doubles-count learn-academy__doubles-count--parts-${partCount}${
        scores ? ' learn-academy__doubles-count--scores' : ''
      }`}
      aria-label={formatCountAria(values, total)}
    >
      <div className="learn-academy__doubles-count-equation">
        {values.map((value, index) => (
          <Fragment key={index}>
            {index > 0 ? <span className="learn-academy__doubles-count-op">+</span> : null}
            <span className="learn-academy__doubles-count-num">{value}</span>
          </Fragment>
        ))}
        <span className="learn-academy__doubles-count-eq">=</span>
        <span className="learn-academy__doubles-count-total">{total}</span>
      </div>
    </div>
  );
}

export function DoublesTempoVisual() {
  return (
    <div className="learn-academy__doubles-wrap">
      <p className="learn-academy__section-label learn-academy__doubles-logic-label">Doubles logic</p>

      <div className="learn-academy__doubles-sequence" role="list">
        {STAGES.map((stage) => (
          <article
            key={stage.key}
            className={`learn-academy__doubles-stage learn-academy__doubles-stage--${stage.key}`}
            role="listitem"
          >
            <header className="learn-academy__doubles-stage-head">
              <h3 className="learn-academy__doubles-stage-title">
                <span className="learn-academy__doubles-stage-n">{stage.step}</span>
                {stage.title}
              </h3>
            </header>

            <div className="learn-academy__doubles-stage-board">
              <LearnBoard
                board={stage.board}
                highlightOpenEnds
                staticView
                staticFitMainline
                staticSpineAnchor={SPINE_ANCHOR}
                tileSize={58}
              />
            </div>

            <footer className="learn-academy__doubles-stage-foot">
              <DoublesOpenCountRow values={stage.values} total={stage.total} scores={stage.scores} />
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
