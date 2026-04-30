import type { CSSProperties } from 'react';
import type { ClaudeRedesignScreen } from './ClaudeRedesignShared';
import { SplitLayout, claudeTokens } from './ClaudeRedesignShared';

const modes: Array<{
  id: ClaudeRedesignScreen;
  short: string;
  label: string;
  description: string;
  accent: string;
}> = [
  {
    id: 'multiplayer',
    short: 'MULTI',
    label: 'Multiplayer Online',
    description: 'Create a private room and play head to head in real time.',
    accent: claudeTokens.blue,
  },
  {
    id: 'dailyFritz',
    short: 'FRITZ',
    label: 'Daily Fritz Match',
    description: 'One fixed live Fritz match per day with the same deal for everyone.',
    accent: claudeTokens.cyan,
  },
  {
    id: 'dailyPuzzle',
    short: 'PUZZLE',
    label: 'Daily Puzzle',
    description: 'Solve today’s featured scenario and compare leaderboard results.',
    accent: claudeTokens.amber,
  },
  {
    id: 'single',
    short: 'SOLO',
    label: 'Single Player',
    description: 'Explore Fritz, Ghost, League, and practice mode directions.',
    accent: claudeTokens.blue,
  },
  {
    id: 'social',
    short: 'SOCIAL',
    label: 'Friends + Stats',
    description: 'Preview social, profile, and ranking presentation.',
    accent: claudeTokens.green,
  },
  {
    id: 'leaderboard',
    short: 'RANK',
    label: 'Leaderboard',
    description: 'Mock ranking layouts for Daily Fritz and Daily Puzzle.',
    accent: claudeTokens.gold,
  },
];

export function ClaudeRedesignHome({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <div className="claude-home">
      {modes.map((mode, index) => (
        <button
          key={mode.id}
          className="claude-home__panel"
          type="button"
          onClick={() => onNavigate(mode.id)}
          style={{
            ['--claude-home-accent' as const]: mode.accent,
          } as CSSProperties}
        >
          <span className="claude-home__badge">{mode.short}</span>
          <span className="claude-home__index">{String(index + 1).padStart(2, '0')}</span>
          <span className="claude-home__label">{mode.label}</span>
          <span className="claude-home__description">{mode.description}</span>
          <span className="claude-home__cta">Enter</span>
        </button>
      ))}
    </div>
  );
}

export function ClaudeRedesignLanding({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <SplitLayout
      accent={claudeTokens.blue}
      eyebrow="Claude Redesign Preview"
      title={
        <>
          RACEHORSE
          <br />
          REIMAGINED
        </>
      }
      description="An isolated port of Claude’s visual direction inside the real app. This preview uses local-only mock state and does not call gameplay, multiplayer, or server flows."
      decor="R"
      leftFooter={
        <div className="claude-chip-row">
          <span className="claude-chip">Client-side only</span>
          <span className="claude-chip">Mock data</span>
          <span className="claude-chip">Safe compare mode</span>
        </div>
      }
      right={<ClaudeRedesignHome onNavigate={onNavigate} />}
    />
  );
}
