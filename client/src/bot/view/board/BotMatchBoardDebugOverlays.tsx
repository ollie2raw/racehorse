import type { RefObject } from 'react';
import type { BotMatchState } from '../../botEngine.ts';
import type { FrozenLesson } from '../../../learn/guidedAuthoring.ts';
import type { GuidedMatchCaptureStatus } from '../../../learn/guidedMatch/guidedMatchCapture.ts';
import type { HandLifecycleDebugSnapshot } from '../../../modules/match/index.ts';

type BotMatchBoardDebugOverlaysProps = {
  enableGuidedMatchCandidateCapture: boolean;
  isJourneyTrial: boolean;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  onCopyGuidedMatchCandidate: () => void;
  isGuidedMode: boolean;
  showDebug: boolean;
  frozenLesson: FrozenLesson | null;
  match: BotMatchState;
  guidedInitSourceRef: RefObject<string | null>;
  isDailyFritzMode: boolean;
  lastDailyFlowLabelRef: RefObject<string>;
  getDebugSnapshot: () => HandLifecycleDebugSnapshot;
  dailyFritzSubmitSucceededRef: RefObject<boolean>;
};

export function BotMatchBoardDebugOverlays({
  enableGuidedMatchCandidateCapture,
  isJourneyTrial,
  guidedMatchCaptureStatus,
  onCopyGuidedMatchCandidate,
  isGuidedMode,
  showDebug,
  frozenLesson,
  match,
  guidedInitSourceRef,
  isDailyFritzMode,
  lastDailyFlowLabelRef,
  getDebugSnapshot,
  dailyFritzSubmitSucceededRef,
}: BotMatchBoardDebugOverlaysProps) {
  return (
    <>
      {import.meta.env.DEV && enableGuidedMatchCandidateCapture && !isJourneyTrial && (
        <div
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 16,
            display: 'grid',
            gap: 2,
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(103,217,87,0.28)',
            background: 'rgba(6,12,20,0.82)',
            color: 'rgba(228,242,232,0.9)',
            fontSize: 11,
            lineHeight: 1.25,
            pointerEvents: 'auto',
          }}
        >
          <strong style={{ color: 'rgba(141,231,165,0.95)' }}>
            Capture: {guidedMatchCaptureStatus.enabled ? 'on' : 'off'}
          </strong>
          <span>Events: {guidedMatchCaptureStatus.eventCount}</span>
          <span>Candidate: {guidedMatchCaptureStatus.candidateStatus}</span>
          <span>Last: {guidedMatchCaptureStatus.lastEventId ?? '-'}</span>
          <span>Save unlocks at match over</span>
          <button
            type="button"
            onClick={onCopyGuidedMatchCandidate}
            style={{
              marginTop: 4,
              padding: '4px 7px',
              borderRadius: 6,
              border: '1px solid rgba(141,231,165,0.28)',
              background: 'rgba(141,231,165,0.1)',
              color: 'rgba(228,242,232,0.94)',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            Copy Draft JSON
          </button>
        </div>
      )}
      {isGuidedMode && showDebug && frozenLesson && (() => {
        const renderedHand = match.players.you.hand.map((t) => `${t.low}|${t.high}`);
        const frozenStep0Hand = frozenLesson.steps[0]?.playerHand ?? [];
        const handsMatch =
          renderedHand.slice().sort().join(',') === frozenStep0Hand.slice().sort().join(',');
        const isMismatch = guidedInitSourceRef.current === 'seeded-deal' && !handsMatch;
        return (
          <div
            style={{
              position: 'fixed',
              top: 8,
              left: 8,
              right: 8,
              zIndex: 9999,
              background: isMismatch ? 'rgba(180,30,20,0.92)' : 'rgba(0,0,0,0.82)',
              border: isMismatch
                ? '2px solid rgba(255,80,60,0.9)'
                : '1px solid rgba(100,220,160,0.4)',
              borderRadius: 8,
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: '0.68rem',
              color: 'rgba(220,240,230,0.92)',
              lineHeight: 1.7,
              pointerEvents: 'none',
            }}
          >
            {isMismatch && (
              <div
                style={{
                  color: 'rgba(255,120,100,1)',
                  fontWeight: 700,
                  marginBottom: 4,
                  fontSize: '0.75rem',
                }}
              >
                ⚠ GUIDED HAND MISMATCH — matchStateJson absent, seeded PRNG gave WRONG GAME
              </div>
            )}
            <div>
              <span style={{ color: 'rgba(180,200,190,0.6)' }}>source: </span>
              <span
                style={{
                  color: isMismatch ? 'rgba(255,160,100,1)' : 'rgba(100,240,160,0.9)',
                  fontWeight: 600,
                }}
              >
                {guidedInitSourceRef.current ?? '—'}
              </span>
            </div>
            <div>
              <span style={{ color: 'rgba(180,200,190,0.6)' }}>rendered: </span>
              {renderedHand.join(' · ') || '—'}
            </div>
            <div>
              <span style={{ color: 'rgba(180,200,190,0.6)' }}>frozen s0: </span>
              {frozenStep0Hand.join(' · ') || '—'}
            </div>
            <div
              style={{
                marginTop: 2,
                fontWeight: 700,
                color: handsMatch ? 'rgba(100,240,160,0.95)' : 'rgba(255,100,80,1)',
              }}
            >
              {handsMatch ? '✓ hands match' : '✗ HANDS DIFFER'}
            </div>
          </div>
        );
      })()}
      {isDailyFritzMode && showDebug && (
        <div
          style={{
            position: 'fixed',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 9999,
            background: 'rgba(10,20,40,0.88)',
            border: '1px solid rgba(80,160,255,0.4)',
            borderRadius: 8,
            padding: '8px 12px',
            fontFamily: 'monospace',
            fontSize: '0.68rem',
            color: 'rgba(200,220,255,0.92)',
            lineHeight: 1.8,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: '0.72rem',
              color: 'rgba(100,180,255,1)',
              marginBottom: 2,
            }}
          >
            ⚙ Daily Fritz Debug
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>phase: </span>
            <span style={{ fontWeight: 600, color: 'rgba(100,240,200,0.95)' }}>
              {lastDailyFlowLabelRef.current}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>hand: </span>
            {match.handNumber}
            {'  '}
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>player: </span>
            <span
              style={{
                color: match.currentPlayer === 'you' ? 'rgba(100,255,160,0.9)' : 'rgba(255,180,80,0.9)',
              }}
            >
              {match.currentPlayer}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>score: </span>
            you {match.players.you.score} · bot {match.players.bot.score}
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>handOver: </span>
            <span style={{ color: match.handOver ? 'rgba(255,200,80,0.9)' : 'rgba(140,170,210,0.55)' }}>
              {String(match.handOver)}
            </span>
            {'  '}
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>gameOver: </span>
            <span style={{ color: match.gameOver ? 'rgba(255,100,80,0.9)' : 'rgba(140,170,210,0.55)' }}>
              {String(match.gameOver)}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>revealTimer: </span>
            <span
              style={{
                color: getDebugSnapshot().revealTimerPending ? 'rgba(255,220,60,0.9)' : 'rgba(140,170,210,0.55)',
              }}
            >
              {getDebugSnapshot().revealTimerPending ? '⏱ running' : 'idle'}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>handReveal: </span>
            <span
              style={{
                color: getDebugSnapshot().handRevealVisible ? 'rgba(255,220,60,0.9)' : 'rgba(140,170,210,0.55)',
              }}
            >
              {getDebugSnapshot().handRevealVisible ? '✓ visible' : 'null'}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>nextHandReady: </span>
            <span
              style={{
                color: getDebugSnapshot().nextHandPrefetched ? 'rgba(100,255,160,0.9)' : 'rgba(140,170,210,0.55)',
              }}
            >
              {getDebugSnapshot().nextHandPrefetched
                ? '✓ prefetched'
                : getDebugSnapshot().nextHandInFlight
                  ? '⏳ in-flight'
                  : 'none'}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>transitionInFlight: </span>
            <span
              style={{
                color: getDebugSnapshot().transitionInFlight ? 'rgba(255,180,60,0.9)' : 'rgba(140,170,210,0.55)',
              }}
            >
              {String(getDebugSnapshot().transitionInFlight)}
            </span>
          </div>
          <div>
            <span style={{ color: 'rgba(140,170,210,0.7)' }}>submitSucceeded: </span>
            <span
              style={{
                color: dailyFritzSubmitSucceededRef.current ? 'rgba(100,255,160,0.9)' : 'rgba(140,170,210,0.55)',
              }}
            >
              {String(dailyFritzSubmitSucceededRef.current)}
            </span>
          </div>
        </div>
      )}
    </>
  );
}