import LearnBoard from '../components/LearnBoard';
import { OpenCountCalc } from '../LearnHowToPlayDiagrams';
import {
  DOUBLES_TEMPO_BOARD_STAGE_1,
  DOUBLES_TEMPO_BOARD_STAGE_2,
  DOUBLES_TEMPO_BOARD_STAGE_3,
  DOUBLES_TEMPO_OPEN_COUNTS,
} from '../howToPlay/doublesTempoBoards';

const STAGES = [
  {
    key: 'open',
    step: 1,
    title: 'Open double',
    board: DOUBLES_TEMPO_BOARD_STAGE_1,
    parts: [
      { label: 'double 1', value: 2, tone: 'gold' as const },
      { label: 'double 4', value: 8, tone: 'gold' as const },
    ],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage1,
    racePoints: 2,
    scoresLabel: 'Scores 2',
    hint: null,
  },
  {
    key: 'crossed',
    step: 2,
    title: 'Cross the double',
    board: DOUBLES_TEMPO_BOARD_STAGE_2,
    parts: [
      { label: 'double 1', value: 2, tone: 'gold' as const },
      { label: 'open 3', value: 3, tone: 'active' as const },
    ],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage2,
    racePoints: undefined,
    scoresLabel: null,
    hint: 'Crossed double stops counting. Branches open.',
  },
  {
    key: 'branch',
    step: 3,
    title: 'Play the branch',
    board: DOUBLES_TEMPO_BOARD_STAGE_3,
    parts: [
      { label: 'double 1', value: 2, tone: 'gold' as const },
      { label: 'open 3', value: 3, tone: 'active' as const },
      { label: 'branch 5', value: 5, tone: 'active' as const },
    ],
    total: DOUBLES_TEMPO_OPEN_COUNTS.stage3,
    racePoints: 2,
    scoresLabel: 'Scores 2 more',
    hint: 'Played branch end joins the count.',
  },
] as const;

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
              <span className="learn-academy__doubles-step-n">{stage.step}</span>
              <p className="learn-academy__doubles-stage-title">{stage.title}</p>
            </header>

            <div className="learn-academy__doubles-stage-board">
              <LearnBoard board={stage.board} highlightOpenEnds staticView tileSize={48} />
            </div>

            <div className="learn-academy__doubles-stage-foot">
              <OpenCountCalc
                parts={[...stage.parts]}
                total={stage.total}
                scores={Boolean(stage.scoresLabel)}
                racePoints={'racePoints' in stage ? stage.racePoints : undefined}
                stacked
              />
              {stage.scoresLabel ? (
                <span className="learn-academy__doubles-scores-pill">{stage.scoresLabel}</span>
              ) : null}
              {stage.hint ? <p className="learn-academy__doubles-stage-hint">{stage.hint}</p> : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
