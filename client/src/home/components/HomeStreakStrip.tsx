import { Check } from 'lucide-react';
import type { HomeSourceState, DailySummaryBaseModel } from '../homeTypes';
import './HomeStreakStrip.css';

export type HomeStreakStripProps = {
  summary: HomeSourceState<DailySummaryBaseModel> | null;
  loading?: boolean;
};

export function HomeStreakStrip({ summary, loading = false }: HomeStreakStripProps) {
  const isLoading = loading || !summary || summary.status === 'loading';

  if (isLoading) {
    return (
      <section
        className="streak-strip streak-strip--loading"
        aria-busy="true"
        aria-label="Loading daily summary streak info"
      >
        <div className="streak-identity">
          <div className="streak-flame-wrap skeleton-pulse" />
          <div className="streak-copy-skeleton">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--sub" />
          </div>
        </div>
        <div className="streak-days">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="streak-day">
              <div className="skeleton-line skeleton-line--day-label" />
              <div className="day-dot skeleton-pulse" />
            </div>
          ))}
        </div>
        <div className="streak-goal">
          <div className="goal-text">
            <div className="skeleton-line skeleton-line--goal-label" />
            <div className="skeleton-line skeleton-line--goal-val" />
          </div>
          <div className="goal-bar-track skeleton-pulse" />
        </div>
      </section>
    );
  }

  const data = summary.data;
  const currentStreak = data?.currentStreakCount ?? 0;
  const todayComplete = data?.todayComplete ?? false;
  const weeklyCompletedCount = data?.weeklyCompletedCount ?? 0;
  const weeklyGoalComplete = weeklyCompletedCount >= 7;
  const subtitle = weeklyGoalComplete
    ? 'Weekly goal complete.'
    : todayComplete
      ? 'Nice — today is complete.'
      : currentStreak > 0
        ? 'Play Fritz or Puzzle today to keep it going.'
        : 'Play Fritz or Puzzle today.';
  const streakTitle = currentStreak > 0 ? `${currentStreak} Day Streak` : 'Start your streak';
  const weekDays = data?.week?.length
    ? data.week
    : ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((label, index) => ({
        dateKey: `placeholder-${index}`,
        label,
        fritzCompleted: false,
        puzzleCompleted: false,
        complete: false,
        isToday: false,
        isFuture: true,
      }));
  const fillPercent = Math.min(100, Math.max(0, (weeklyCompletedCount / 7) * 100));

  return (
    <section className="streak-strip" aria-label="Daily streak status">
      <div className="streak-identity">
        <div className="streak-flame-wrap" style={{ borderColor: currentStreak > 0 ? '#24541f' : 'rgba(255,255,255,0.1)' }}>
          <img src="/daystreak.webp" alt="" className="streak-flame-icon" />
        </div>
        <div>
          <div className="streak-label">{streakTitle}</div>
          <div className="streak-sub">{subtitle}</div>
        </div>
      </div>

      <div className="streak-days">
        {weekDays.map((day) => {
          let dotClass = 'day-dot-future';
          if (day.complete) {
            dotClass = 'day-dot-done';
          } else if (day.isToday) {
            dotClass = 'day-dot-today';
          }

          return (
            <div key={day.dateKey} className="streak-day">
              <span
                className="day-label"
                style={day.isToday && !day.complete ? { color: '#A77CFF' } : undefined}
              >
                {day.label}
              </span>
              <div className={`day-dot ${dotClass}`}>
                {day.complete && (
                  <Check className="day-check-icon" stroke="#67D957" strokeWidth={3} />
                )}
                {day.isToday && !day.complete && (
                  <div className="day-dot-today-inner" />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="streak-goal">
        <div className="goal-text">
          <span className="goal-label">Weekly Goal</span>
          <div className="goal-value">
            <strong>{weeklyCompletedCount}</strong>
            <span> / 7 Days</span>
          </div>
        </div>
        <div className="goal-bar-track">
          <div className="goal-bar-fill" style={{ width: `${fillPercent}%` }} />
        </div>
      </div>
    </section>
  );
}
