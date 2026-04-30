import type { ClaudeRedesignScreen } from './ClaudeRedesignShared';
import {
  PrimaryButton,
  SecondaryRow,
  SectionLabel,
  SplitLayout,
  StatLine,
  claudeTokens,
} from './ClaudeRedesignShared';

const todayLabel = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date());

export function ClaudeRedesignDailyPuzzle({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <SplitLayout
      accent={claudeTokens.amber}
      eyebrow="Today's Challenge"
      title={
        <>
          DAILY
          <br />
          PUZZLE
        </>
      }
      description="Mock setup ported from Claude’s prototype. This screen does not open the live Daily Puzzle flow."
      decor="P"
      leftFooter={<DominoStrip />}
      right={
        <div className="claude-stack">
          <SectionLabel>Today's Board</SectionLabel>
          <div className="claude-feature-title">Score as many points as you can.</div>
          <div className="claude-stat-block">
            <StatLine label="Date" value={todayLabel} />
            <StatLine label="Mode" value="Daily" />
            <StatLine label="Format" value="One-turn high score" />
            <StatLine label="Streak" value="3 days" accent={claudeTokens.amber} />
          </div>
          <div className="claude-progress">
            <div className="claude-progress__meta">
              <SectionLabel>Streak Progress</SectionLabel>
              <span>3 / 7</span>
            </div>
            <div className="claude-progress__bar">
              <div style={{ width: '43%', background: claudeTokens.amber }} />
            </div>
          </div>
          <PrimaryButton label="Preview Start Daily Puzzle" sublabel="Local mock only" accent={claudeTokens.amber} />
          <SecondaryRow
            label="View Mock Leaderboard"
            sublabel="Open the redesign leaderboard screen"
            onClick={() => onNavigate('leaderboard')}
          />
          <SecondaryRow
            label="Return to Preview Home"
            sublabel="Go back to the Claude redesign home"
            onClick={() => onNavigate('home')}
          />
        </div>
      }
    />
  );
}

export function ClaudeRedesignDailyFritz({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <SplitLayout
      accent={claudeTokens.cyan}
      eyebrow="Today's Challenge"
      title={
        <>
          DAILY
          <br />
          FRITZ
        </>
      }
      description="Mock setup and result framing from Claude’s prototype. It does not use the live Daily Fritz reliability path."
      decor="F"
      leftFooter={
        <div className="claude-chip-row">
          <span className="claude-chip claude-chip--danger">Elite 1800</span>
          <span className="claude-chip">7-tile format</span>
        </div>
      }
      right={
        <div className="claude-stack">
          <SectionLabel>Same deal for everyone</SectionLabel>
          <div className="claude-feature-title">One run only.</div>
          <div className="claude-stat-block">
            <StatLine label="Date" value={todayLabel} />
            <StatLine label="Tier" value="Elite (1800)" accent={claudeTokens.red} />
            <StatLine label="Mode" value="7-tile" />
            <StatLine label="Streak" value="3 days" accent={claudeTokens.cyan} />
          </div>
          <div className="claude-info-card">
            <SectionLabel color={claudeTokens.cyan}>Match Details</SectionLabel>
            <StatLine label="Opponent" value="Fritz Elite (1800)" />
            <StatLine label="Scoring" value="Diff + speed bonus" />
            <StatLine label="Players Today" value="3 completed" />
          </div>
          <PrimaryButton label="Preview Start Daily Fritz" sublabel="No server call" accent={claudeTokens.cyan} />
          <SecondaryRow
            label="View Mock Leaderboard"
            sublabel="Open the redesign leaderboard screen"
            onClick={() => onNavigate('leaderboard')}
          />
          <SecondaryRow
            label="Return to Preview Home"
            sublabel="Go back to the Claude redesign home"
            onClick={() => onNavigate('home')}
          />
        </div>
      }
    />
  );
}

function DominoStrip() {
  const tiles = [
    [6, 4],
    [4, 3],
    [3, 5],
    [5, 2],
    [2, 6],
  ];
  return (
    <div className="claude-domino-strip">
      {tiles.map(([high, low], index) => (
        <div key={`${high}-${low}`} className="claude-domino" style={{ transform: `translateY(${index % 2 === 1 ? '-0.35rem' : '0'})` }}>
          <span>{high}</span>
          <span />
          <span>{low}</span>
        </div>
      ))}
    </div>
  );
}
