import type { User } from '@supabase/supabase-js';
import { useAsyncData } from '../hooks/useAsyncData';
import type { WeeklyRecap } from './statsApi';

const WEEKLY_RECAP_GENERIC_ERROR = 'Unable to load weekly recap.';

type WeeklyStatsScreenProps = {
  open: boolean;
  onClose: () => void;
  user: User | null;
};

export default function WeeklyStatsScreen({
  open,
  onClose,
  user,
}: WeeklyStatsScreenProps) {
  const { data, loading, error: fetchError } = useAsyncData<WeeklyRecap | null>(
    async () => {
      if (!open || !user) return null;
      let resp: { data: WeeklyRecap | null; error: string | null };
      try {
        const { fetchWeeklyRecap } = await import('./statsApi');
        resp = await fetchWeeklyRecap(user);
      } catch {
        // The hand-rolled version's `.catch` discarded the real error and
        // always showed the generic string — keep that.
        throw new Error(WEEKLY_RECAP_GENERIC_ERROR);
      }
      // Known API error → surface it; missing data with no error → generic.
      if (resp.error || !resp.data) {
        throw new Error(resp.error ?? WEEKLY_RECAP_GENERIC_ERROR);
      }
      return resp.data;
    },
    [open, user],
    { enabled: open && Boolean(user) },
  );

  // The hand-rolled version cleared recap/error the moment the panel closed;
  // the hook retains them, so gate on the same condition at read time.
  const recap = open && user ? data ?? null : null;
  const error = open && user ? fetchError : null;

  const recapSections = recap
    ? [
        {
          title: 'Fritz This Week',
          icon: '🤖',
          tone: 'rgba(94, 234, 212, 0.16)',
          rows: [
            { label: 'Ranked Games', value: recap.fritz.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.fritz.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.fritz.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.fritz.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.fritz.bestWinMarginThisWeek == null ? '—' : `${recap.fritz.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Ghost This Week',
          icon: '👻',
          tone: 'rgba(216, 180, 254, 0.16)',
          rows: [
            { label: 'Ghost Games', value: recap.ghost.gamesThisWeek },
            {
              label: 'Rating Δ',
              value:
                Math.round(recap.ghost.ratingChangeThisWeek) === 0
                  ? '0'
                  : `${recap.ghost.ratingChangeThisWeek > 0 ? '+' : ''}${Math.round(recap.ghost.ratingChangeThisWeek)}`,
            },
            {
              label: 'Best Win',
              value: recap.ghost.bestWinMarginThisWeek == null ? '—' : `${recap.ghost.bestWinMarginThisWeek} pts`,
            },
          ],
        },
        {
          title: 'Puzzle This Week',
          icon: '🧩',
          tone: 'rgba(240, 192, 64, 0.16)',
          rows: [
            { label: 'Completions', value: recap.puzzle.completionsThisWeek },
            { label: 'Best Today', value: recap.puzzle.bestScoreToday == null ? '—' : recap.puzzle.bestScoreToday },
          ],
        },
        {
          title: 'Multiplayer This Week',
          icon: '🌐',
          tone: 'rgba(148, 163, 184, 0.16)',
          rows: [
            { label: 'Online Games', value: recap.multiplayer.gamesThisWeek },
            { label: 'Wins', value: recap.multiplayer.wins },
            { label: 'Losses', value: recap.multiplayer.losses },
          ],
        },
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Weekly stats"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        pointerEvents: open ? 'auto' : 'none',
        opacity: open ? 1 : 0,
        visibility: open ? 'visible' : 'hidden',
        transform: open ? 'scale(1)' : 'scale(0.97)',
        transition: 'opacity 180ms ease, transform 180ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1901,
          pointerEvents: 'auto',
          width: 'min(1120px, calc(100vw - 32px))',
          maxHeight: 'min(92vh, 920px)',
          borderRadius: '20px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '22px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '16px',
          overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span aria-hidden="true">🏆</span>
              <span>Weekly Recap</span>
            </h3>
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.9)', fontSize: '1.12rem' }}>
              {recap?.weekLabel ?? 'This week'}
            </p>
          </div>
          <button className="mode-inline-btn" onClick={onClose}>
            Close
          </button>
        </div>

        {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading weekly recap...</p>}
        {error && <p className="auth-inline-error" style={{ margin: 0 }}>{error}</p>}

        {!loading && !error && recapSections.length > 0 ? (
          <div style={{ display: 'grid', gap: 14 }}>
            {recapSections.map((section) => (
              <div
                key={section.title}
                style={{
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(12,20,34,0.68)',
                  padding: '16px',
                  display: 'grid',
                  gap: 14,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ fontSize: '1.22rem' }}>{section.icon}</span>
                  <strong style={{ fontSize: '1.16rem', color: 'rgba(240,248,255,0.96)' }}>{section.title}</strong>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 12,
                  }}
                >
                  {section.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        borderRadius: '10px',
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: section.tone,
                        padding: '14px 16px',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: '0.98rem', color: 'rgba(191,213,223,0.88)', fontWeight: 700 }}>{row.label}</span>
                      <strong style={{ fontSize: '1.56rem', color: 'var(--text-primary)' }}>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
            No weekly recap available yet.
          </p>
        )}
      </div>
    </div>
  );
}
