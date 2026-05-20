import LayoutScreen from '../../ui/LayoutScreen';
import GuidedMatchSourceEditor from './GuidedMatchSourceEditor';
import {
  GUIDED_MATCH_SOURCE_STORAGE_KEY,
  loadGuidedMatchSource,
  saveGuidedMatchSource,
} from './guidedMatchSourceStorage';

interface GuidedMatchAnnotatorScreenProps {
  onBack: () => void;
}

export default function GuidedMatchAnnotatorScreen({ onBack }: GuidedMatchAnnotatorScreenProps) {
  const source = loadGuidedMatchSource();

  if (!source) {
    return (
      <LayoutScreen
        className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
        title="Guided Match Annotator"
        subtitle={`No current source found at ${GUIDED_MATCH_SOURCE_STORAGE_KEY}.`}
      >
        <button type="button" className="learn-start-guided-btn" onClick={onBack}>
          Back to Learn Admin
        </button>
      </LayoutScreen>
    );
  }

  return (
    <div className="guided-match-recorder">
      <div className="guided-match-recorder__shell">
        <div className="guided-match-recorder__top">
          <div className="guided-match-recorder__hero">
            <button type="button" className="guided-match-recorder__back" onClick={onBack}>
              ← Back to Learn
            </button>
            <div className="guided-match-recorder__eyebrow">Dev Annotator</div>
            <h1>Guided Match Annotator</h1>
            <p>Standard Fritz · 7 tiles · First to 60</p>
          </div>
          <div className="guided-match-recorder__header-meta">
            <div className="guided-match-recorder__chip">Source loaded</div>
            <div className="guided-match-recorder__chip">{source.playerTileEventCount} player moves</div>
          </div>
        </div>
        <GuidedMatchSourceEditor
          source={source}
          onSourceChange={saveGuidedMatchSource}
          sourceSummary={`Current source: ${source.finalScore.player}-${source.finalScore.fritz} · ${source.eventCount} events · ${source.playerTileEventCount} player moves · ${source.handCount} hands`}
        />
      </div>
    </div>
  );
}
