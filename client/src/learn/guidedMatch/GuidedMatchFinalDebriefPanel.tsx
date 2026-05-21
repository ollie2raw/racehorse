import type { GuidedMatchFinalDebrief } from './guidedMatchFinalDebrief';
import './guidedMatchFinalDebrief.css';

type GuidedMatchFinalDebriefPanelProps = {
  debrief: GuidedMatchFinalDebrief;
};

export function GuidedMatchFinalDebriefPanel({ debrief }: GuidedMatchFinalDebriefPanelProps) {
  const chips = debrief.conceptChips?.filter(Boolean) ?? [];

  return (
    <section className="guided-match-final-debrief" aria-label={debrief.title}>
      <p className="guided-match-final-debrief__eyebrow">Final lesson</p>
      <h3 className="guided-match-final-debrief__title">{debrief.title}</h3>
      {chips.length > 0 ? (
        <ul className="guided-match-final-debrief__chips" aria-label="Key concepts">
          {chips.map((chip) => (
            <li key={chip} className="guided-match-final-debrief__chip">
              {chip}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="guided-match-final-debrief__body">
        {debrief.bodyParagraphs.map((paragraph) => (
          <p key={paragraph.slice(0, 32)} className="guided-match-final-debrief__paragraph">
            {paragraph}
          </p>
        ))}
      </div>
      <div className="guided-match-final-debrief__takeaway">
        <p className="guided-match-final-debrief__takeaway-label">Takeaway</p>
        <p className="guided-match-final-debrief__takeaway-body">{debrief.takeaway}</p>
      </div>
    </section>
  );
}

export default GuidedMatchFinalDebriefPanel;
