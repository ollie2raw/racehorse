import { useEffect, useRef, useState } from 'react';
import type { RoomEmoteEvent } from '../multiplayer/protocol';
import { ROOM_REACTION_EMOTES, type RoomReactionEmote } from '../multiplayer/roomReactionEmotes';
import { REPORT_CATEGORIES, type ReportCategory } from '../moderation/moderationTypes';
import './roomReactions.css';

type ReportTarget = { userId: string; username: string };

type Props = {
  feed: RoomEmoteEvent[];
  onSendEmote: (emote: RoomReactionEmote) => void;
  /** The human opponent, when there is one to report (never a bot or guest). */
  reportTarget?: ReportTarget | null;
  onReport?: (target: ReportTarget, category: ReportCategory) => Promise<{ error: string | null }>;
};

type ReportStep = 'closed' | 'choosing' | 'sending' | 'sent' | 'failed';

/**
 * Match reactions: the six preset emotes and nothing else — there is no
 * free-text chat (App Store Guideline 1.2). The same popover is where a player
 * reports the opponent, so reporting needs no chat and adds no gameplay chrome.
 */
export function RoomReactions({ feed, onSendEmote, reportTarget, onReport }: Props) {
  const [open, setOpen] = useState(false);
  const [reportStep, setReportStep] = useState<ReportStep>('closed');

  // RR_CLOSE_HANDLERS_REFS
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const last = feed.slice(-10);
  const canReport = Boolean(reportTarget && onReport);

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

  const toggleOpen = () => {
    setOpen((v) => !v);
    setReportStep('closed');
  };

  const submitReport = async (category: ReportCategory) => {
    if (!reportTarget || !onReport) return;
    setReportStep('sending');
    const result = await onReport(reportTarget, category);
    setReportStep(result.error ? 'failed' : 'sent');
  };

  return (
    <div className="rr-root" ref={rootRef}>
      <button
        type="button"
        className="rr-pill"
        aria-label="Open reactions"
        onClick={toggleOpen}
        title="Reactions"
      >
        💬
      </button>

      {open && (
        <div className="rr-pop" ref={popRef} role="dialog" aria-label="Match reactions">
          {reportStep === 'closed' ? (
            <>
              <div className="rr-feed">
                {last.length === 0 ? (
                  <div className="rr-empty">No reactions yet.</div>
                ) : (
                  last.map((m) => (
                    <div key={m.id} className="rr-line">
                      <span className="rr-name">{m.from.username}</span>
                      <span className="rr-emote">{m.emote}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="rr-emotes">
                {ROOM_REACTION_EMOTES.map((e) => (
                  <button key={e} type="button" className="rr-emo" onClick={() => onSendEmote(e)}>
                    {e}
                  </button>
                ))}
              </div>

              {canReport && (
                <div className="rr-report-row">
                  <button type="button" className="rr-report-link" onClick={() => setReportStep('choosing')}>
                    Report {reportTarget!.username}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rr-report" aria-live="polite">
              {reportStep === 'sent' ? (
                <p className="rr-report-note">Report sent. Thanks for letting us know.</p>
              ) : reportStep === 'failed' ? (
                <p className="rr-report-note">Couldn’t send the report. Try again later.</p>
              ) : (
                <>
                  <p className="rr-report-note">Why are you reporting {reportTarget?.username}?</p>
                  {REPORT_CATEGORIES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className="rr-report-choice"
                      disabled={reportStep === 'sending'}
                      onClick={() => void submitReport(c.value)}
                    >
                      {c.label}
                    </button>
                  ))}
                </>
              )}
              <button type="button" className="rr-report-link" onClick={() => setReportStep('closed')}>
                {reportStep === 'sent' || reportStep === 'failed' ? 'Done' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
