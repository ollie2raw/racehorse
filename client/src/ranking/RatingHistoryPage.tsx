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
import { fetchRatingHistory, type RatingHistoryResponse } from './api';

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

  useEffect(() => {
    if (!userId) {
      setHistory(null);
      setLoading(false);
      setError('Sign in to view your rating history.');
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void fetchRatingHistory(userId)
      .then((result) => {
        if (!active) return;
        setLoading(false);
        if (result.error) {
          setError(result.error);
          setHistory(null);
          return;
        }
        setHistory(result.data);
      })
      .catch((err) => {
        if (!active) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Unable to load rating history.');
      });

    return () => {
      active = false;
    };
  }, [userId]);

  const chartData = useMemo(() => buildChartData(history), [history]);

  const stats = useMemo(() => {
    const games = history?.games ?? [];
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
  }, [history]);

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
                Confidence band uses current RD of {history ? Math.round(history.rd) : '—'}.
              </p>
            </div>
          </div>

          {loading && <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>Loading rating history...</p>}
          {error && <p style={{ margin: 0, color: '#fca5a5' }}>{error}</p>}
          {!loading && !error && chartData.length === 0 && (
            <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>No rated games yet.</p>
          )}

          {!loading && !error && chartData.length > 0 && (
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
                    stroke="#34d399"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    name="Multiplayer"
                  />
                  <Line
                    type="monotone"
                    dataKey="fritzRating"
                    stroke="#60a5fa"
                    strokeWidth={2.5}
                    dot={false}
                    connectNulls={false}
                    name="Fritz"
                  />
                  <Scatter dataKey="multiplayerPoint" fill="#34d399" name="Multiplayer games" />
                  <Scatter dataKey="fritzPoint" fill="#60a5fa" name="Fritz games" />
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
              value: history ? Math.round(history.currentRating).toLocaleString() : '—',
              accent: '#34d399',
              note: history?.provisional ? 'Provisional' : 'Established',
            },
            {
              label: 'Peak Rating',
              value: history ? Math.round(history.peakRating).toLocaleString() : '—',
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

        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <button className="mode-inline-btn" onClick={onBack}>
            Back to Home
          </button>
        </div>
      </div>
    </LayoutScreen>
  );
}
