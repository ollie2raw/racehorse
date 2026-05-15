import type { Socket } from 'socket.io-client';
import { useQueueCounts } from './useQueueCounts';
import './multiplayerTopBar.css';

export type MultiplayerTopBarTab = 'quick' | 'private';

export type MultiplayerTopBarProps = {
  activeTab: MultiplayerTopBarTab;
  onSelectQuick: () => void;
  onSelectPrivate: () => void;
  /** When true, Quick Match tab is still shown but Private is selected and Quick is disabled (e.g. in-room). */
  privateTabLocksQuick?: boolean;
  onBackMultiplayer: () => void;
  /** Optional label for back affordance (default: home). */
  backAriaLabel?: string;
  /** Live counts — when omitted and `socket` is set, counts are fetched via `queue:online`. */
  online?: number;
  queued?: number;
  socket?: Socket | null;
  /** Subscribe to queue counts when true and `socket` is provided. */
  fetchCounts?: boolean;
};

export function MultiplayerTopBar({
  activeTab,
  onSelectQuick,
  onSelectPrivate,
  privateTabLocksQuick = false,
  onBackMultiplayer,
  backAriaLabel = 'Back to home',
  online: onlineProp,
  queued: queuedProp,
  socket,
  fetchCounts = false,
}: MultiplayerTopBarProps) {
  const useSocketCounts = Boolean(fetchCounts && socket && onlineProp === undefined && queuedProp === undefined);
  const fromSocket = useQueueCounts(socket ?? null, useSocketCounts);
  const online = onlineProp ?? fromSocket.online;
  const queued = queuedProp ?? fromSocket.queued;

  return (
    <header className="mp-topbar" role="banner">
      <div className="mp-topbar__start">
        <button
          type="button"
          className="pvf-back-btn rh-back-button"
          onClick={onBackMultiplayer}
          aria-label={backAriaLabel}
        >
          <span>←</span> Back to Home
        </button>
      </div>

      <div className="mp-topbar__mid" role="tablist" aria-label="Match type">
        <div className="mp-topbar__seg">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'quick'}
            className={`mp-topbar__seg-btn${activeTab === 'quick' ? ' is-active' : ''}`}
            onClick={onSelectQuick}
            disabled={privateTabLocksQuick}
          >
            Quick
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'private'}
            className={`mp-topbar__seg-btn${activeTab === 'private' ? ' is-active' : ''}`}
            onClick={onSelectPrivate}
          >
            Private
          </button>
        </div>
      </div>

      <div className="mp-topbar__end" role="status" aria-live="polite">
        <span className="mp-topbar__status">
          <span className="mp-topbar__status-dot" aria-hidden />
          <span className="mp-topbar__status-text">
            {online.toLocaleString()} online · {queued.toLocaleString()} searching
          </span>
        </span>
      </div>
    </header>
  );
}
