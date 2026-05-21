import LearnBoard from '../components/LearnBoard';
import {
  DOUBLES_TEMPO_BOARD_STAGE_1,
  DOUBLES_TEMPO_BOARD_STAGE_2,
  DOUBLES_TEMPO_BOARD_STAGE_3,
  DOUBLES_TEMPO_OPEN_COUNTS,
} from '../howToPlay/doublesTempoBoards';

type FormulaPart = {
  label?: string;
  value: number;
  /** Show only the number (e.g. middle term in crossed-double). */
  bare?: boolean;
};

const STAGES = [
  {
    key: 'open',
    step: 1,
    title: 'OPEN DOUBLE',
    board: DOUBLES_TEMPO_BOARD_STAGE_1,
    parts: [
      { label: 'DOUBLE 1', value: 2 },
      { label: 'DOUBLE 4', value: 8 },
    ] satisfies FormulaPart[],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage1,
    scoreLine: '2 race points',
    hint: null,
  },
  {
    key: 'crossed',
    step: 2,
    title: 'CROSS THE DOUBLE',
    board: DOUBLES_TEMPO_BOARD_STAGE_2,
    parts: [
      { label: 'DOUBLE 1', value: 2 },
      { value: 3, bare: true },
    ] satisfies FormulaPart[],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage2,
    scoreLine: undefined,
    hint: 'Crossed double stops counting. Branches open.',
  },
  {
    key: 'branch',
    step: 3,
    title: 'PLAY THE BRANCH',
    board: DOUBLES_TEMPO_BOARD_STAGE_3,
    parts: [
      { label: 'DOUBLE 1', value: 2 },
      { value: 3, bare: true },
      { label: 'OPEN 5', value: 5 },
    ] satisfies FormulaPart[],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage3,
    scoreLine: '2 new race points',
    hint: 'Played branch end joins the count.',
  },
] as const;

function formatOpenCountLine(parts: FormulaPart[], total: number): string {
  const terms = parts.map((part) =>
    part.bare ? String(part.value) : `${part.label} ${part.value}`,
  );
  return `${terms.join(' + ')} = ${total}`;
}

function DoublesStageCaption({
  scoreLine,
  hint,
}: {
  scoreLine?: string;
  hint?: string | null;
}) {
  if (scoreLine && hint) {
    return (
      <p className="learn-academy__doubles-caption">
        <span className="learn-academy__doubles-caption-score">{scoreLine}.</span> {hint}
      </p>
    );
  }

  if (scoreLine) {
    return <p className="learn-academy__doubles-caption learn-academy__doubles-caption--score">{scoreLine}</p>;
  }

  if (hint) {
    return <p className="learn-academy__doubles-caption">{hint}</p>;
  }

  return null;
}

export function DoublesTempoVisual() {
  return (
    <div className="learn-academy__doubles-wrap">
      <div className="learn-academy__doubles-toolbar">
        <p className="learn-academy__section-label learn-academy__doubles-logic-label">Doubles logic</p>
        <span className="learn-academy__doubles-tempo-pill">Double = play again</span>
      </div>

      <div className="learn-academy__doubles-sequence" role="list">
        {STAGES.map((stage) => (
          <article key={stage.key} className="learn-academy__doubles-stage" role="listitem">
            <header className="learn-academy__doubles-stage-head">
              <h3 className="learn-academy__doubles-stage-title">
                <span className="learn-academy__doubles-stage-n">{stage.step}</span>
                {stage.title}
              </h3>
            </header>

            <div className="learn-academy__doubles-stage-board">
              <LearnBoard board={stage.board} highlightOpenEnds staticView tileSize={72} />
            </div>

            <footer className="learn-academy__doubles-stage-foot">
              <p className="learn-academy__doubles-formula" aria-label={`Open count ${stage.total}`}>
                {formatOpenCountLine([...stage.parts], stage.total)}
              </p>
              <DoublesStageCaption scoreLine={stage.scoreLine} hint={stage.hint} />
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
