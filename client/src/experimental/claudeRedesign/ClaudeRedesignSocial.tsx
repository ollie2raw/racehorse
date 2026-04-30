import type { ClaudeRedesignScreen } from './ClaudeRedesignShared';
import {
  SectionLabel,
  SplitLayout,
  claudeTokens,
} from './ClaudeRedesignShared';

const friends = [
  { handle: '@nonniee', rating: 1640, wins: 22, online: true },
  { handle: '@hafnerjan', rating: 1512, wins: 18, online: false },
  { handle: '@ollie2', rating: 1389, wins: 9, online: true },
];

export function ClaudeRedesignSocial({
  onNavigate,
}: {
  onNavigate: (screen: ClaudeRedesignScreen) => void;
}) {
  return (
    <SplitLayout
      accent={claudeTokens.green}
      eyebrow="Social"
      title={
        <>
          FRIENDS
          <br />
          + STATS
        </>
      }
      description="A narrowed port of the prototype’s social treatment. This preview keeps all friend data local and does not call the real friend APIs."
      decor="F"
      leftFooter={
        <div className="claude-social-summary">
          <div>
            <strong>2</strong>
            <span>online</span>
          </div>
          <div>
            <strong>3</strong>
            <span>friends</span>
          </div>
        </div>
      }
      right={
        <div className="claude-stack">
          <SectionLabel>Add Friend</SectionLabel>
          <div className="claude-join-row">
            <input placeholder="USERNAME" />
            <button type="button">Add</button>
          </div>
          <SectionLabel>Your Friends</SectionLabel>
          <div className="claude-list">
            {friends.map((friend) => (
              <div key={friend.handle} className="claude-friend-row">
                <div className="claude-friend-row__main">
                  <span
                    className={`claude-friend-row__dot${friend.online ? ' is-online' : ''}`}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="claude-friend-row__handle">{friend.handle}</div>
                    <div className="claude-friend-row__meta">
                      {friend.rating} rating · {friend.wins} wins
                    </div>
                  </div>
                </div>
                <div className="claude-friend-row__actions">
                  <button type="button">Invite</button>
                  <button type="button">Stats</button>
                </div>
              </div>
            ))}
          </div>
          <button className="claude-secondary-row" type="button" onClick={() => onNavigate('home')}>
            <span>
              <span className="claude-secondary-row__label">Return to Preview Home</span>
              <span className="claude-secondary-row__sub">Go back to the Claude redesign home</span>
            </span>
            <span className="claude-secondary-row__arrow" aria-hidden="true">
              →
            </span>
          </button>
        </div>
      }
    />
  );
}
