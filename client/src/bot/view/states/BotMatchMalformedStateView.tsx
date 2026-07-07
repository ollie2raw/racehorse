type BotMatchMalformedStateViewProps = {
  onExitMatch: () => void;
};

export function BotMatchMalformedStateView({ onExitMatch }: BotMatchMalformedStateViewProps) {
  return (
    <div
      className="screen game-screen walnut-live theme-green bot-match-screen"
      style={{ display: 'grid', placeItems: 'center' }}
    >
      <div style={{ textAlign: 'center', color: 'white', padding: 40 }}>
        <h3>Game State Error</h3>
        <p>The match state is incomplete or malformed.</p>
        <button type="button" className="btn rh-back-button" onClick={onExitMatch}>
          ← Back to Home
        </button>
      </div>
    </div>
  );
}