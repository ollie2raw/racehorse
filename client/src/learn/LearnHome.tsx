import LayoutScreen from '../ui/LayoutScreen';
import './learn.css';

interface LearnHomeProps {
  onBack: () => void;
  onStartGuidedGame?: () => void;
  /** Admin-only: start the guided authoring flow */
  onStartGuidedAuthoring?: () => void;
  isAdmin?: boolean;
}

const HOW_TO_PLAY_STEPS = [
  {
    num: '1',
    title: 'Start a Guided Game',
    desc: 'Tap the button to begin',
  },
  {
    num: '2',
    title: 'Follow the coach',
    desc: 'Master Fritz explains every move',
  },
  {
    num: '3',
    title: 'Learn as you play',
    desc: 'See your recap after each hand',
  },
];

const KEY_RULES = [
  'Match an open end to play a tile — or draw from the boneyard',
  'Score or play a double to keep your turn going',
];

export default function LearnHome({ onBack, onStartGuidedGame, onStartGuidedAuthoring, isAdmin }: LearnHomeProps) {
  return (
    <LayoutScreen
      className="ghost-setup-screen mode-subpage-screen mode-accent-ghost"
      title="Learn Racehorse"
      subtitle="Play a real game. Get coached every turn."
      contentClassName="screen-shell ghost-setup-content"
    >
      <div className="ghost-setup-grid learn-columns">
        <div className="ghost-setup-left-col learn-col">
          <div className="learn-home-top">
            <button className="mode-inline-btn" onClick={onBack}>
              ← Back
            </button>
          </div>
          <h3 className="learn-col-heading">HOW TO PLAY</h3>
          <div className="learn-steps">
            {HOW_TO_PLAY_STEPS.map((step) => (
              <div key={step.num} className="learn-step-card">
                <span className="learn-step-num">{step.num}</span>
                <div className="learn-step-body">
                  <span className="learn-step-title">{step.title}</span>
                  <span className="learn-step-desc">{step.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ghost-setup-middle-col learn-col">
          <h3 className="learn-col-heading">HOW SCORING WORKS</h3>
          <p className="learn-score-note">
            Add up all open ends on the board. If the total is a multiple of 5, divide by 5
            {' '}— that's your score. Open ends sum to 10? You score 2 points. Sum to 15?
            {' '}You score 3 points. First player to 60 wins.
          </p>

          <h3 className="learn-col-heading learn-col-heading-spaced">KEY RULES</h3>
          {KEY_RULES.map((rule) => (
            <p key={rule} className="learn-rule-row">{rule}</p>
          ))}
        </div>

        <div className="ghost-setup-right-col learn-col learn-col-cta">
          <h3 className="learn-col-heading">GUIDED GAME</h3>
          {onStartGuidedGame ? (
            <button className="learn-start-guided-btn" onClick={onStartGuidedGame}>
              Start Guided Game
            </button>
          ) : null}
          <p className="learn-cta-sub">vs Rookie Fritz · Master Fritz coaches every turn</p>

          {isAdmin && onStartGuidedAuthoring ? (
            <div style={{ marginTop: 28 }}>
              <h3 className="learn-col-heading" style={{ marginBottom: 8 }}>ADMIN</h3>
              <button
                className="learn-start-guided-btn"
                onClick={onStartGuidedAuthoring}
                style={{
                  background: 'rgba(255,200,60,0.13)',
                  border: '1.5px solid rgba(255,200,60,0.32)',
                  color: 'rgba(255,220,100,0.92)',
                }}
              >
                ✏️ Guided Authoring
              </button>
              <p className="learn-cta-sub">vs Elite Fritz · attach coaching notes to each turn</p>
            </div>
          ) : null}
        </div>
      </div>
    </LayoutScreen>
  );
}
