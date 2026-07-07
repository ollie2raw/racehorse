import type { BotMatchViewScoreToast } from '../../view-model/botMatchViewModelTypes.ts';
import { renderScoreToastMessage } from '../utils/botMatchViewFormatters.tsx';

type BotMatchScoreToastOverlayProps = {
  scoreToast: BotMatchViewScoreToast;
};

export function BotMatchScoreToastOverlay({ scoreToast }: BotMatchScoreToastOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: scoreToast.visible ? 'translate(-50%, 0px)' : 'translate(-50%, -14px)',
        opacity: scoreToast.visible ? 1 : 0,
        transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        zIndex: 14,
        background: 'rgba(255,255,255,0.06)',
        backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 999,
        padding: '10px 22px',
        color: scoreToast.tone === 'you'
          ? 'rgba(151, 241, 205, 0.98)'
          : 'rgba(255, 180, 180, 0.95)',
        fontSize: '1.24rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        pointerEvents: 'none',
        boxShadow: scoreToast.tone === 'you'
          ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
          : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
      }}
    >
      {renderScoreToastMessage(scoreToast.message)}
    </div>
  );
}