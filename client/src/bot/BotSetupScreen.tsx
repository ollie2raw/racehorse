import type { BotDealSize } from './botEngine';
import { FRITZ_TIERS, type FritzTier } from './fritzConfig';
import './botSetup.css';
import {
  ClaudeModeScreen,
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
} from '../ui/claudeMode';

interface BotSetupScreenProps {
  dealSize: BotDealSize;
  fritzTier?: FritzTier;
  onDealSizeChange: (size: BotDealSize) => void;
  onFritzTierChange: (tier: FritzTier) => void;
  onStart: () => void;
  onBack: () => void;
}

export default function BotSetupScreen({
  dealSize,
  fritzTier = 'elite',
  onDealSizeChange,
  onFritzTierChange,
  onStart,
  onBack,
}: BotSetupScreenProps) {
  const selectedTier = FRITZ_TIERS[fritzTier];

  return (
    <div className="screen bot-setup-screen mode-subpage-screen mode-accent-bot claude-mode-screen-shell">
      <ClaudeModeScreen
        accent={selectedTier.color}
        eyebrow="Single Player"
        title={'PLAY\nVS\nFRITZ'}
        description="Choose your tier and deal size, then launch the real match flow."
        decor="F"
        backLabel="Back to Single Player"
        onBack={onBack}
        heroFooter={
          <div className="claude-mode-chip-row">
            <span className="claude-mode-chip">{selectedTier.label}</span>
            <span className="claude-mode-chip">{selectedTier.ratingLabel}</span>
            <span className="claude-mode-chip">{dealSize}-tile format</span>
          </div>
        }
        panel={
          <div className="claude-mode-panel-stack">
            <ClaudeSectionLabel>Difficulty</ClaudeSectionLabel>
            <div className="claude-mode-choice-list" role="group" aria-label="Fritz difficulty tier">
              {(Object.entries(FRITZ_TIERS) as Array<[FritzTier, (typeof FRITZ_TIERS)[FritzTier]]>).map(
                ([tier, config]) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => onFritzTierChange(tier)}
                    className={`claude-mode-choice-row ${fritzTier === tier ? 'is-active' : ''}`}
                    style={{ ['--row-accent' as string]: config.color }}
                  >
                    <span className="claude-mode-choice-row__ghost-dot" aria-hidden="true" />
                    <span className="claude-mode-choice-row__content">
                      <span className="claude-mode-choice-row__title">{config.label}</span>
                      <span className="claude-mode-choice-row__meta">
                        {config.ratingLabel} · {config.description}
                      </span>
                    </span>
                    <span className="claude-mode-choice-row__dot" aria-hidden="true" />
                  </button>
                ),
              )}
            </div>

            <ClaudeSectionLabel>Deal Size</ClaudeSectionLabel>
            <div className="claude-mode-segmented" role="group" aria-label="Bot deal size">
              <button
                type="button"
                onClick={() => onDealSizeChange(7)}
                className={dealSize === 7 ? 'is-active' : ''}
              >
                7 Tiles
              </button>
              <button
                type="button"
                onClick={() => onDealSizeChange(14)}
                className={dealSize === 14 ? 'is-active' : ''}
              >
                14 Tiles
              </button>
            </div>

            <ClaudePrimaryAction
              accent={selectedTier.color}
              title="Start Match"
              meta={`Begin a ${dealSize}-tile match vs Fritz ${selectedTier.label}`}
              onClick={onStart}
            />
          </div>
        }
      />
    </div>
  );
}
