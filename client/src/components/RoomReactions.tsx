import {useEffect, useMemo, useRef, useState} from 'react';
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

  // RR_CLOSE_HANDLERS_REFS
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const emotes = useMemo(() => ['👍', '😂', '😮', '❤️', '😡', '🎉'], []);
  const last = feed.slice(-10);

  // RR_CLOSE_HANDLERS_EFFECT
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };

    const onPointerDown = (ev: PointerEvent) => {
      const t = ev.target as Node | null;
      const root = rootRef.current;
      const pop = popRef.current;
      if (!t || !root || !pop) return;
      // If click is outside both the button area (root) and the popover, close.
      if (!root.contains(t) && !pop.contains(t)) setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);


  const ui = (
    <div className="rr-root" ref={rootRef}>
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
        <div className="rr-pop" ref={popRef} role="dialog" aria-label="Room chat">
          <div className="rr-head">
            <div className="rr-title"></div>
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
