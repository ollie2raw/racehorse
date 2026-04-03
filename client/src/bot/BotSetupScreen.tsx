import type { BotDealSize } from './botEngine';
import { FRITZ_TIERS, type FritzTier } from './fritzConfig';
import LayoutScreen from '../ui/LayoutScreen';
import './botSetup.css';

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
    <LayoutScreen
      className="bot-setup-screen mode-home-screen mode-subpage-screen mode-accent-bot"
      badge="Practice"
      title="Play vs Fritz"
      subtitle="Choose deal size before the match starts."
      contentClassName="multiplayer-menu-card screen-shell bot-setup-content"
    >
      <div
        className="mode-entry-panel bot-setup-panel-shell"
        style={{ ['--bot-tier-color' as string]: selectedTier.color }}
      >
        <div className="bot-setup-tier-grid" role="group" aria-label="Fritz difficulty tier">
          {(Object.entries(FRITZ_TIERS) as Array<[FritzTier, (typeof FRITZ_TIERS)[FritzTier]]>).map(
            ([tier, config]) => (
              <button
                key={tier}
                type="button"
                onClick={() => onFritzTierChange(tier)}
                className={`bot-setup-tier-card ${fritzTier === tier ? 'is-active' : ''}`}
                style={{ ['--tier-color' as string]: config.color }}
              >
                <div className="bot-setup-tier-head">
                  <span className="bot-setup-tier-label">{config.label}</span>
                  <span className="bot-setup-tier-rating">{config.ratingLabel}</span>
                </div>
                <p className="bot-setup-tier-description">{config.description}</p>
              </button>
            ),
          )}
        </div>

        <div className="bot-setup-segmented" role="group" aria-label="Bot deal size">
          <button
            type="button"
            onClick={() => onDealSizeChange(7)}
            className={`bot-setup-size-btn ${dealSize === 7 ? 'is-active' : ''}`}
          >
            7 Tiles
          </button>
          <button
            type="button"
            onClick={() => onDealSizeChange(14)}
            className={`bot-setup-size-btn ${dealSize === 14 ? 'is-active' : ''}`}
          >
            14 Tiles
          </button>
        </div>

        <div className="mode-actions bot-setup-actions">
          <button
            className="mode-option mode-option-primary mode-accent-bot bot-setup-start"
            onClick={onStart}
            style={{ ['--bot-tier-color' as string]: selectedTier.color }}
          >
            <span className="mode-option-title">Start</span>
            <span className="mode-option-meta">
              Begin a {dealSize}-tile match vs Fritz {selectedTier.label}
            </span>
          </button>
          <button className="mode-option mode-option-secondary bot-setup-back" onClick={onBack}>
            <span className="mode-option-title">Back to Home</span>
            <span className="mode-option-meta">Return to game mode menu</span>
          </button>
        </div>
      </div>
    </LayoutScreen>
  );
}
