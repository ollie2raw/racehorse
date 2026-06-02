import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import { Modal } from '../components/primitives/Modal';
import { FRITZ_TIERS, FRITZ_TIER_PVF_COLORS, type FritzTier } from './fritzConfig';
import {
  FRITZ_TIER_DETAILS_BODY,
  FRITZ_TIER_DETAILS_DAILY_NOTE,
  FRITZ_TIER_DETAILS_INTRO,
  FRITZ_TIER_DETAILS_ORDER,
  FRITZ_TIER_ROLE_LABELS,
} from './fritzTierDetailsContent';
import './FritzTierDetailsModal.css';

export type FritzTierDetailsModalProps = {
  open: boolean;
  onClose: () => void;
};

export function FritzTierDetailsModal({ open, onClose }: FritzTierDetailsModalProps) {
  useEffect(() => {
    if (!open) return;
    // #region agent log
    fetch('http://127.0.0.1:7623/ingest/c349b922-447d-4c33-a504-5ce40eaa2c91',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'07f153'},body:JSON.stringify({sessionId:'07f153',location:'FritzTierDetailsModal.tsx:open',message:'tier details modal mounted (portaled)',data:{open:true},timestamp:Date.now(),hypothesisId:'H2-render'})}).catch(()=>{});
    // #endregion
  }, [open]);

  if (!open) return null;

  return (
    <GameOverlayPortal>
      <Modal open onClose={onClose} title="Fritz difficulty tiers" maxWidth={520}>
        <p className="pvf-tier-details-intro">{FRITZ_TIER_DETAILS_INTRO}</p>

        <ul className="pvf-tier-details-list" aria-label="Fritz difficulty tiers">
          {FRITZ_TIER_DETAILS_ORDER.map((tierId) => (
            <TierDetailRow key={tierId} tierId={tierId} />
          ))}
        </ul>

        <p className="pvf-tier-details-daily-note">{FRITZ_TIER_DETAILS_DAILY_NOTE}</p>

        <button type="button" className="pvf-tier-details-close-btn" onClick={onClose}>
          Got it
        </button>
      </Modal>
    </GameOverlayPortal>
  );
}

function TierDetailRow({ tierId }: { tierId: FritzTier }) {
  const tier = FRITZ_TIERS[tierId];
  const accent = FRITZ_TIER_PVF_COLORS[tierId];
  const role = FRITZ_TIER_ROLE_LABELS[tierId];

  return (
    <li className="pvf-tier-details-row" style={{ '--pvf-tier-accent': accent } as CSSProperties}>
      <div className="pvf-tier-details-row-head">
        <span className="pvf-tier-details-name">{tier.label}</span>
        <span className="pvf-tier-details-role">{role}</span>
        <span className="pvf-tier-details-strength">Approx. {tier.ratingLabel}</span>
      </div>
      <p className="pvf-tier-details-body">{FRITZ_TIER_DETAILS_BODY[tierId]}</p>
    </li>
  );
}
