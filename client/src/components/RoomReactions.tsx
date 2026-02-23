import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './roomReactions.css';

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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const emotes = useMemo(() => ['👍', '😂', '😮', '❤️', '😡', '🎉'], []);
  const last = feed.slice(-10);

  const ui = (
    <div className="rr-root">
      <button
        type="button"
        className="rr-pill"
        aria-label="Open reactions"
        onClick={() => setOpen((v) => !v)}
        title="Reactions"
      >
        💬
      </button>

      {open && (
        <div className="rr-pop" role="dialog" aria-label="Room chat">
          <div className="rr-head">
            <div className="rr-title">Reactions</div>
            <button type="button" className="rr-x" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="rr-feed">
            {last.length === 0 ? (
              <div className="rr-empty">No messages yet.</div>
            ) : (
              last.map((m) => (
                <div key={m.id} className="rr-line">
                  {'text' in m ? (
                    <>
                      <span className="rr-name">{m.from.username}:</span>
                      <span className="rr-text">{m.text}</span>
                    </>
                  ) : (
                    <>
                      <span className="rr-name">{m.from.username}</span>
                      <span className="rr-emote">{m.emote}</span>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="rr-emotes">
            {emotes.map((e) => (
              <button key={e} type="button" className="rr-emo" onClick={() => onSendEmote(e)}>
                {e}
              </button>
            ))}
          </div>

          <form
            className="rr-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              const t = text.trim();
              if (!t) return;
              onSendChat(t);
              setText('');
            }}
          >
            <input
              className="rr-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Say something…"
              maxLength={200}
            />
            <button className="rr-send" type="submit">
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );

  return createPortal(ui, document.body);
}
