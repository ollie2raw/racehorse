import { useMemo, useState } from 'react';

export type RoomChatEvent = {
  id: string;
  t: number;
  from: { userId: string | null; username: string };
  text: string;
};

export type RoomEmoteEvent = {
  id: string;
  t: number;
  from: { userId: string | null; username: string };
  emote: string;
};

type Props = {
  feed: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendChat: (text: string) => void;
  onSendEmote: (emote: string) => void;
};

export function RoomReactions({ feed, onSendChat, onSendEmote }: Props) {
  const [text, setText] = useState('');
  const emotes = useMemo(() => ['👍', '😂', '😮', '❤️', '😡', '🎉'], []);

  return (
    <div style={{ position: 'absolute', right: 12, bottom: 12, width: 280, zIndex: 80 }}>
      <div
        style={{
          background: 'rgba(0,0,0,0.55)',
          borderRadius: 12,
          padding: 10,
          color: 'white',
          fontSize: 13,
          backdropFilter: 'blur(6px)',
        }}
      >
        <div style={{ maxHeight: 140, overflow: 'auto', marginBottom: 8 }}>
          {feed.slice(-8).map((m) => (
            <div key={m.id} style={{ marginBottom: 6 }}>
              {'text' in m ? (
                <span>
                  <b>{m.from.username}:</b> {m.text}
                </span>
              ) : (
                <span>
                  <b>{m.from.username}</b> {m.emote}
                </span>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {emotes.map((e) => (
            <button
              key={e}
              onClick={() => onSendEmote(e)}
              style={{ cursor: 'pointer', borderRadius: 10, padding: '4px 8px' }}
              type="button"
            >
              {e}
            </button>
          ))}
        </div>

        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            const t = text.trim();
            if (!t) return;
            onSendChat(t);
            setText('');
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Say something…"
            maxLength={200}
            style={{ flex: 1, borderRadius: 10, padding: '6px 10px' }}
          />
          <button type="submit" style={{ cursor: 'pointer', borderRadius: 10, padding: '6px 10px' }}>
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
