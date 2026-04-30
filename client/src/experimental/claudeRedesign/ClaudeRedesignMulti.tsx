import { useState } from 'react';
import type { ClaudeRedesignScreen } from './ClaudeRedesignShared';
import {
  PrimaryButton,
  SecondaryRow,
  SectionLabel,
  SplitLayout,
  claudeTokens,
} from './ClaudeRedesignShared';

export function ClaudeRedesignMulti({
  screen,
  onNavigate,
}: {
  screen: Extract<ClaudeRedesignScreen, 'multiplayer' | 'multiplayerLobby'>;
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  if (screen === 'multiplayerLobby') {
    return <ClaudeRedesignMultiLobby onNavigate={onNavigate} />;
  }
  return <ClaudeRedesignMultiSetup onNavigate={onNavigate} />;
}

function ClaudeRedesignMultiSetup({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  const [roomCode, setRoomCode] = useState('');

  return (
    <SplitLayout
      accent={claudeTokens.blue}
      eyebrow="Real-time Online"
      title={
        <>
          MULTI
          <br />
          PLAYER
        </>
      }
      description="Visual-only port of Claude’s room setup. Create and join buttons navigate between mock preview screens only."
      decor="M"
      leftFooter={
        <div className="claude-chip-row">
          <span className="claude-chip claude-chip--live">Live feel</span>
          <span className="claude-chip">No socket actions</span>
        </div>
      }
      right={
        <div className="claude-stack">
          <SectionLabel>Private Room</SectionLabel>
          <div className="claude-feature-title">Play head to head in real time.</div>
          <button className="claude-action-card" type="button" onClick={() => onNavigate('multiplayerLobby')}>
            <span className="claude-action-card__title">Create New Room</span>
            <span className="claude-action-card__description">Start a room and share the code.</span>
          </button>
          <div className="claude-join-row">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.toUpperCase().slice(0, 6))}
              placeholder="ENTER CODE"
            />
            <button
              type="button"
              disabled={roomCode.trim().length < 4}
              onClick={() => onNavigate('multiplayerLobby')}
            >
              Join
            </button>
          </div>
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

function ClaudeRedesignMultiLobby({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <SplitLayout
      accent={claudeTokens.blue}
      eyebrow="Room Code"
      title="XVXK5"
      description="Waiting for all players to join before starting the hand. This is a static lobby preview with mock roster data."
      decor="R"
      leftFooter={<div className="claude-room-subcopy">Copy link and invite a friend without touching the real multiplayer room flow.</div>}
      right={
        <div className="claude-stack">
          <div className="claude-panel-head">
            <SectionLabel>Players</SectionLabel>
            <div className="claude-panel-count">1/2</div>
          </div>
          <div className="claude-player-card is-host">
            <div>
              <div className="claude-player-card__name">You</div>
              <div className="claude-player-card__meta">@oliver</div>
            </div>
            <div className="claude-player-card__badge">Host</div>
          </div>
          <div className="claude-player-card is-empty">
            <span className="claude-player-card__waiting-dot" aria-hidden="true" />
            <span>Waiting for another player…</span>
          </div>
          <PrimaryButton label="Copy Invite Link" sublabel="Preview action only" accent={claudeTokens.blue} />
          <SecondaryRow
            label="Leave Mock Room"
            sublabel="Return to the multiplayer redesign setup"
            onClick={() => onNavigate('multiplayer')}
          />
        </div>
      }
    />
  );
}
