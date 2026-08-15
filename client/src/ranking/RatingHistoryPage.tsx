import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import LayoutScreen from '../ui/LayoutScreen';
import { fetchRatingHistory, fetchRankingLeaderboard, type LeaderboardEntry, type RatingHistoryResponse } from './api';

interface RatingHistoryPageProps {
  userId: string | null;
  username: string | null;
  onBack: () => void;
}

type HistoryPoint = {
  gameNumber: number;
  playedAt: string;
  rating: number;
  lower: number;
  band: number;
  delta: number;
  opponentLabel: string;
  resultLabel: string;
  multiplayerRating: number | null;
  fritzRating: number | null;
  multiplayerPoint: number | null;
  fritzPoint: number | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDelta(delta: number): string {
  const rounded = Math.round(delta);
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function buildChartData(history: RatingHistoryResponse | null): HistoryPoint[] {
  if (!history) return [];
  return history.games.map((game, index) => {
    const lower = game.rating_after - game.rd_after;
    return {
      gameNumber: index + 1,
      playedAt: game.played_at,
      rating: game.rating_after,
      lower,
      band: game.rd_after * 2,
      delta: game.delta,
      opponentLabel: game.is_fritz ? 'Fritz' : 'Multiplayer',
      resultLabel: `${game.player_score}-${game.opponent_score}`,
      multiplayerRating: game.is_fritz ? null : game.rating_after,
      fritzRating: game.is_fritz ? game.rating_after : null,
      multiplayerPoint: game.is_fritz ? null : game.rating_after,
      fritzPoint: game.is_fritz ? game.rating_after : null,
    };
  });
}

export default function RatingHistoryPage({
  userId,
  username,
  onBack,
}: RatingHistoryPageProps) {
  const [history, setHistory] = useState<RatingHistoryResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardUnavailable, setLeaderboardUnavailable] = useState(false);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      setLoading(true);
      setError(null);

      try {
        const result = await fetchRatingHistory(userId);
        if (!active) return;
        setLoading(false);
        if (result.error) {
          setError(result.error);
          setHistory(null);
          return;
        }
        setHistory(result.data);
      } catch (err) {
        if (!active) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to load rating history.');
      }
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    let active = true;
    void fetchRankingLeaderboard(20).then((result) => {
      if (!active) return;
      if (result.data?.leaderboard_load_failed) {
        setLeaderboardUnavailable(true);
      } else {
        setLeaderboard(result.data?.leaderboard ?? []);
      }
    });
    return () => { active = false; };
  }, []);

  const displayHistory = userId ? history : null;
  const displayLoading = userId ? loading : false;
  const displayError = userId ? error : 'Sign in to view your rating history.';

  const chartData = useMemo(() => buildChartData(displayHistory), [displayHistory]);

  const stats = useMemo(() => {
    const games = displayHistory?.games ?? [];
    let fritzWins = 0;
    let fritzLosses = 0;
    let multiplayerWins = 0;
    let multiplayerLosses = 0;

    for (const game of games) {
      const won = game.player_score > game.opponent_score;
      if (game.is_fritz) {
        if (won) fritzWins += 1;
        else fritzLosses += 1;
      } else {
        if (won) multiplayerWins += 1;
        else multiplayerLosses += 1;
      }
    }

    return {
      totalGames: games.length,
      fritzWins,
      fritzLosses,
      multiplayerWins,
      multiplayerLosses,
    };
  }, [displayHistory]);

  const heading = username ? `@${username}` : 'Your rating';

  return (
    <LayoutScreen
      className="screen lobby-screen mode-home-screen mode-subpage-screen rating-history-screen"
      title="Rating History"
      subtitle={`Glicko-2 progression for ${heading}`}
      contentClassName="screen-shell rating-history-content"
    >
      <div
        style={{
          width: '100%',
          display: 'grid',
          gap: 14,
        }}
      >
        <div
          style={{
            borderRadius: 18,
            border: '1px solid rgba(236,252,245,0.12)',
            background: 'linear-gradient(180deg, rgba(11,18,29,0.96), rgba(8,13,22,0.98))',
            boxShadow: '0 18px 42px rgba(0,0,0,0.28)',
            padding: '18px 18px 14px',
            minHeight: chartData.length > 0 ? 360 : 240,
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div>
              <h3 style={{ margin: 0, color: 'rgba(241,248,245,0.96)' }}>Rating progression</h3>
              <p style={{ margin: '6px 0 0', color: 'rgba(191,213,223,0.72)', fontSize: '0.95rem' }}>
                Confidence band uses current RD of {displayHistory ? Math.round(displayHistory.rd) : '—'}.
              </p>
            </div>
          </div>

          {displayLoading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading rating history...</p>}
          {displayError && <p style={{ margin: 0, color: 'var(--accent-red)' }}>{displayError}</p>}
          {!displayLoading && !displayError && chartData.length === 0 && (
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>No rated games yet.</p>
          )}

          {!displayLoading && !displayError && chartData.length > 0 && (
            <div style={{ width: '100%', height: 290 }}>
              <ResponsiveContainer>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
                  <defs>
                    <linearGradient id="ratingHistoryBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgba(148,163,184,0.22)" />
                      <stop offset="100%" stopColor="rgba(148,163,184,0.04)" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
                  <XAxis
                    dataKey="gameNumber"
                    tick={{ fill: 'rgba(191,213,223,0.72)', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(148,163,184,0.2)' }}
                    tickLine={false}
                    label={{ value: 'Game', position: 'insideBottom', offset: -4, fill: 'rgba(191,213,223,0.72)' }}
                  />
                  <YAxis
                    tick={{ fill: 'rgba(191,213,223,0.72)', fontSize: 12 }}
                    axisLine={{ stroke: 'rgba(148,163,184,0.2)' }}
                    tickLine={false}
                    domain={['dataMin - 20', 'dataMax + 20']}
                    label={{ value: 'Rating', angle: -90, position: 'insideLeft', fill: 'rgba(191,213,223,0.72)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid rgba(236,252,245,0.12)',
                      background: 'rgba(11,18,29,0.96)',
                      boxShadow: '0 16px 40px rgba(0,0,0,0.32)',
                      color: 'rgba(241,248,245,0.96)',
                    }}
                    content={(props: {
                      active?: boolean;
                      label?: number | string;
                      payload?: ReadonlyArray<{ payload?: HistoryPoint }>;
                    }) => {
                      const { active, payload } = props;
                      if (!active || !payload?.length) return null;
                      const point = payload[0]?.payload;
                      if (!point) return null;
                      return (
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: 6 }}>
                            Game {point.gameNumber} • {formatDate(point.playedAt)}
                          </div>
                          <div style={{ color: 'rgba(191,213,223,0.82)' }}>{point.opponentLabel}</div>
                          <div>Score: {point.resultLabel}</div>
                          <div>Rating: {Math.round(point.rating)}</div>
                          <div>Delta: {formatDelta(point.delta)}</div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ color: 'rgba(191,213,223,0.72)', fontSize: 12 }} />
                  <Area dataKey="lower" stackId="ci" stroke="none" fill="transparent" activeDot={false} />
                  <Area dataKey="band" stackId="ci" stroke="none" fill="url(#ratingHistoryBand)" name="Rating ± RD" activeDot={false} />
                  <Line
                    type="monotone"
                    dataKey="multiplayerRating"
                    stroke="var(--accent-green)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    name="Multiplayer"
                  />
                  <Line
                    type="monotone"
                    dataKey="fritzRating"
                    stroke="var(--tier-standard)"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    name="Fritz"
                  />
                  <Scatter dataKey="multiplayerPoint" fill="var(--accent-green)" name="Multiplayer games" />
                  <Scatter dataKey="fritzPoint" fill="var(--tier-standard)" name="Fritz games" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          {[
            {
              label: 'Current Rating',
              value: displayHistory ? Math.round(displayHistory.currentRating).toLocaleString() : '—',
              accent: '#34d399',
              note: displayHistory?.provisional ? 'Provisional' : 'Established',
            },
            {
              label: 'Peak Rating',
              value: displayHistory ? Math.round(displayHistory.peakRating).toLocaleString() : '—',
              accent: '#fbbf24',
              note: 'Career high',
            },
            {
              label: 'Total Games',
              value: stats.totalGames.toLocaleString(),
              accent: '#93c5fd',
              note: 'Rated results only',
            },
            {
              label: 'Fritz W/L',
              value: `${stats.fritzWins}-${stats.fritzLosses}`,
              accent: '#60a5fa',
              note: 'Bot matches',
            },
            {
              label: 'Multiplayer W/L',
              value: `${stats.multiplayerWins}-${stats.multiplayerLosses}`,
              accent: '#34d399',
              note: 'Human matches',
            },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                borderRadius: 16,
                border: '1px solid rgba(236,252,245,0.12)',
                background: 'linear-gradient(180deg, rgba(13,19,31,0.95), rgba(8,13,22,0.98))',
                padding: '16px 18px',
                boxShadow: '0 14px 34px rgba(0,0,0,0.22)',
                display: 'grid',
                gap: 6,
              }}
            >
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(191,213,223,0.64)' }}>
                {card.label}
              </span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: card.accent }}>{card.value}</span>
              <span style={{ fontSize: '0.9rem', color: 'rgba(223,236,244,0.78)' }}>{card.note}</span>
            </div>
          ))}
        </div>

        <div
          style={{
            borderRadius: 18,
            border: '1px solid rgba(236,252,245,0.12)',
            background: 'linear-gradient(180deg, rgba(11,18,29,0.96), rgba(8,13,22,0.98))',
            boxShadow: '0 18px 42px rgba(0,0,0,0.28)',
            padding: '18px 18px 14px',
          }}
        >
          <h3 style={{ margin: '0 0 12px', color: 'rgba(241,248,245,0.96)' }}>Global Leaderboard</h3>
          {leaderboardUnavailable ? (
            <p style={{ color: 'rgba(191,213,223,0.72)', margin: 0 }}>Leaderboard temporarily unavailable.</p>
          ) : leaderboard.length === 0 ? (
            <p style={{ color: 'rgba(191,213,223,0.72)', margin: 0 }}>No ranked players yet.</p>
          ) : (
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
              {leaderboard.map((entry, i) => (
                <li
                  key={entry.userId}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: entry.userId === userId ? 'rgba(52,211,153,0.08)' : 'transparent',
                    border: entry.userId === userId ? '1px solid rgba(52,211,153,0.18)' : '1px solid transparent',
                  }}
                >
                  <span style={{ color: 'rgba(191,213,223,0.72)', minWidth: 28, fontVariantNumeric: 'tabular-nums' }}>
                    #{i + 1}
                  </span>
                  <span style={{ flex: 1, color: 'rgba(241,248,245,0.92)', marginLeft: 8 }}>
                    {entry.username ?? entry.userId.slice(0, 8)}
                  </span>
                  <span style={{ color: 'rgba(52,211,153,0.9)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {Math.round(entry.glicko_rating)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button className="mode-inline-btn rh-back-button" onClick={onBack}>
            ← Back to Home
          </button>
        </div>
      </div>
    </LayoutScreen>
  );
}
