import React from 'react';
import {
  ClaudeModeScreen,
  ClaudeSectionLabel,
  ClaudeSecondaryAction,
  claudeRgb,
} from '../ui/claudeMode';

type AppMode =
  | 'home'
  | 'botSetup'
  | 'ghostSetup'
  | 'noBrainer';

interface SinglePlayerHubScreenProps {
  onBack: () => void;
  onNavigate: (mode: AppMode) => void;
}

export default function SinglePlayerHubScreen({ onBack, onNavigate }: SinglePlayerHubScreenProps) {
  const modes = [
    {
      id: 'fritz',
      title: 'Play vs Fritz',
      meta: 'Bot match',
      accent: '#C8922A',
      mode: 'botSetup' as const,
    },
    {
      id: 'ghost',
      title: 'Ghost Mode',
      meta: 'replay/ghost challenge',
      accent: '#8B5CF6',
      mode: 'ghostSetup' as const,
    },
    {
      id: 'nobrainer',
      title: 'No Brainer Lab',
      meta: 'tactical practice / lab mode',
      accent: '#20D1C7',
      mode: 'noBrainer' as const,
    }
  ];

  return (
    <div className="screen lobby-screen mode-home-screen mode-subpage-screen claude-mode-screen-shell" style={{ padding: 0, overflow: 'hidden' }}>
      <ClaudeModeScreen
        accent="#9B6CFF"
        eyebrow="Single Player"
        title={'SINGLE\nPLAYER'}
        description="Choose your training ground. Master the tiles."
        decor="S"
        backLabel="Back to Home"
        onBack={onBack}
        heroFooter={
          <div className="claude-mode-chip-row">
            <span className="claude-mode-chip">Fritz</span>
            <span className="claude-mode-chip">Ghost</span>
            <span className="claude-mode-chip">Lab</span>
          </div>
        }
        panel={
          <div className="claude-mode-panel-stack">
            <ClaudeSectionLabel>Choose Mode</ClaudeSectionLabel>
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className="claude-mode-choice-row"
                style={{
                  ['--row-accent' as string]: mode.accent,
                  ['--row-accent-rgb' as string]: claudeRgb(mode.accent),
                }}
                onClick={() => onNavigate(mode.mode)}
              >
                <span className="claude-mode-choice-row__content">
                  <span className="claude-mode-choice-row__title">{mode.title}</span>
                  <span className="claude-mode-choice-row__meta">{mode.meta}</span>
                </span>
                <svg className="claude-mode-choice-row__arrow" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3.5 7h7M7.5 3.5l3.5 3.5-3.5 3.5" />
                </svg>
              </button>
            ))}
            
            <div style={{ marginTop: 'auto', paddingTop: '24px' }}>
              <ClaudeSecondaryAction
                title="Back to Home"
                meta="Return to the main dashboard"
                onClick={onBack}
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

