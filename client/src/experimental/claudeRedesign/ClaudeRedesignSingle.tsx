import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { ClaudeRedesignScreen } from './ClaudeRedesignShared';
import {
  PrimaryButton,
  SecondaryRow,
  SectionLabel,
  SplitLayout,
  claudeTokens,
} from './ClaudeRedesignShared';

const singleModes = [
  {
    id: 'fritz',
    title: 'Play vs Fritz',
    description: 'Test yourself against the toughest opponent in the room.',
    status: 'Preview setup',
  },
  {
    id: 'ghost',
    title: 'Ghost Mode',
    description: 'Play against a ghost trained on your own playstyle.',
    status: 'Mock card only',
  },
  {
    id: 'lab',
    title: 'No Brainer Lab',
    description: 'Practice one-turn clear runs with curated hands.',
    status: 'Visual reference',
  },
];

const tiers = [
  { id: 'rookie', label: 'Rookie', rating: 600, color: claudeTokens.green },
  { id: 'standard', label: 'Standard', rating: 1000, color: claudeTokens.blue },
  { id: 'elite', label: 'Elite', rating: 1800, color: claudeTokens.red },
  { id: 'master', label: 'Master', rating: 2200, color: claudeTokens.gold },
];

export function ClaudeRedesignSingle({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  const [selectedTier, setSelectedTier] = useState('elite');
  const [dealSize, setDealSize] = useState<7 | 14>(7);
  const activeTier = tiers.find((tier) => tier.id === selectedTier) ?? tiers[2];

  return (
    <SplitLayout
      accent={claudeTokens.blue}
      eyebrow="Single Player"
      title={
        <>
          SINGLE
          <br />
          PLAYER
        </>
      }
      description="Ported from the Claude prototype as a local-only selection hub plus mock Fritz setup. Buttons here intentionally do not launch real matches."
      decor="S"
      leftFooter={
        <div className="claude-chip-row">
          <span className="claude-chip">Fritz setup</span>
          <span className="claude-chip">Mock ghost</span>
          <span className="claude-chip">No gameplay hooks</span>
        </div>
      }
      right={
        <div className="claude-stack">
          <SectionLabel>Choose Mode</SectionLabel>
          <div className="claude-list">
            {singleModes.map((mode) => (
              <div key={mode.id} className="claude-select-card">
                <div>
                  <div className="claude-select-card__title">{mode.title}</div>
                  <div className="claude-select-card__description">{mode.description}</div>
                </div>
                <div className="claude-select-card__status">{mode.status}</div>
              </div>
            ))}
          </div>

          <SectionLabel color={claudeTokens.blue}>Mock Fritz Setup</SectionLabel>
          <div className="claude-tier-list">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                className={`claude-tier-row${selectedTier === tier.id ? ' is-active' : ''}`}
                type="button"
                onClick={() => setSelectedTier(tier.id)}
                style={{ ['--claude-tier-accent' as const]: tier.color } as CSSProperties}
              >
                <span>
                  <span className="claude-tier-row__title">{tier.label}</span>
                  <span className="claude-tier-row__description">Rating {tier.rating}</span>
                </span>
                <span className="claude-tier-row__dot" aria-hidden="true" />
              </button>
            ))}
          </div>

          <div className="claude-segmented">
            <button
              className={dealSize === 7 ? 'is-active' : ''}
              type="button"
              onClick={() => setDealSize(7)}
            >
              7 Tiles
            </button>
            <button
              className={dealSize === 14 ? 'is-active' : ''}
              type="button"
              onClick={() => setDealSize(14)}
            >
              14 Tiles
            </button>
          </div>

          <PrimaryButton
            label="Preview Start Match"
            sublabel={`${dealSize}-tile · Fritz ${activeTier.label}`}
            accent={claudeTokens.blue}
          />
          <SecondaryRow
            label="Return to Preview Home"
            sublabel="Back to the Claude redesign home accordion"
            onClick={() => onNavigate('home')}
          />
        </div>
      }
    />
  );
}
