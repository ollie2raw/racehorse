import { useEffect } from 'react';
import { GlassCard } from './GlassCard';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: number;
  children?: React.ReactNode;
}

export function Modal({ open, onClose, title, maxWidth = 480, children }: ModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="rh-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <GlassCard
        lifted
        className="rh-modal-panel"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="rh-modal-header">
            <span className="rh-modal-title">{title}</span>
            <button className="rh-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}
        <div className="rh-modal-body">{children}</div>
      </GlassCard>
    </div>
  );
}
