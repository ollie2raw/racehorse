import { useEffect, useState } from 'react';
import { fetchGhostProfileSummary } from '../ghost/api';
import { NO_BRAINER_COMBO_COUNT } from '../practice/noBrainerDataset';
import { getNoBrainerSolvedCount } from '../practice/noBrainerLabProgress';
import { fetchFritzHubStats } from '../stats/statsApi';

export type HubStatRow = {
  icon: 'crown' | 'bolt' | 'clock' | 'bars' | 'puzzle';
  label: string;
  value: string;
};

export type SinglePlayerHubStats = {
  fritz: HubStatRow[];
  ghost: HubStatRow[];
  lab: HubStatRow[];
};

const EMPTY: SinglePlayerHubStats = {
  fritz: [
    { icon: 'bars', label: 'Matches Played', value: '—' },
    { icon: 'crown', label: 'Win Rate', value: '—' },
  ],
  ghost: [
    { icon: 'clock', label: 'Avg Score', value: '—' },
    { icon: 'bolt', label: 'Confidence', value: '—' },
  ],
  lab: [
    { icon: 'puzzle', label: 'Combos Available', value: NO_BRAINER_COMBO_COUNT.toLocaleString() },
    { icon: 'bolt', label: 'Solved', value: '—' },
  ],
};

function formatWinRate(wins: number, gamesPlayed: number): string | null {
  if (gamesPlayed <= 0) return null;
  const pct = Math.round((wins / gamesPlayed) * 1000) / 10;
  return `${pct}%`;
}

function buildLabStats(userId: string | null | undefined): HubStatRow[] {
  const solvedCount = getNoBrainerSolvedCount(userId);
  return [
    {
      icon: 'puzzle',
      label: 'Combos Available',
      value: NO_BRAINER_COMBO_COUNT.toLocaleString(),
    },
    {
      icon: 'bolt',
      label: 'Solved',
      value: solvedCount == null ? '—' : solvedCount.toLocaleString(),
    },
  ];
}

export function useSinglePlayerHubStats(userId: string | null | undefined): SinglePlayerHubStats {
  const [remoteStats, setRemoteStats] = useState<Pick<SinglePlayerHubStats, 'fritz' | 'ghost'>>({
    fritz: EMPTY.fritz,
    ghost: EMPTY.ghost,
  });

  useEffect(() => {
    if (!userId) return;

    let active = true;

    void (async () => {
      const [fritzResult, ghostResult] = await Promise.allSettled([
        fetchFritzHubStats(userId),
        fetchGhostProfileSummary(userId),
      ]);

      if (!active) return;

      let fritz = EMPTY.fritz;
      if (fritzResult.status === 'fulfilled' && fritzResult.value) {
        const summary = fritzResult.value;
        const gamesPlayed = summary.gamesPlayed;
        if (gamesPlayed > 0) {
          const winRate = formatWinRate(summary.wins, gamesPlayed) ?? '—';
          fritz = [
            { icon: 'bars', label: 'Matches Played', value: gamesPlayed.toLocaleString() },
            { icon: 'crown', label: 'Win Rate', value: winRate },
          ];
        }
      }

      let ghost = EMPTY.ghost;
      if (ghostResult.status === 'fulfilled') {
        const summary = ghostResult.value;
        const gamesPlayed = Number(summary.gamesPlayed ?? 0);
        if (gamesPlayed > 0) {
          const avgScore =
            summary.avgScore != null && Number.isFinite(summary.avgScore)
              ? String(summary.avgScore)
              : '—';
          const confidence =
            summary.styleProfile != null
              ? `${Math.round(summary.styleProfile.confidence * 100)}%`
              : '—';
          ghost = [
            { icon: 'clock', label: 'Avg Score', value: avgScore },
            { icon: 'bolt', label: 'Confidence', value: confidence },
          ];
        }
      }

      setRemoteStats({ fritz, ghost });
    })();

    return () => {
      active = false;
    };
  }, [userId]);

  return {
    fritz: userId ? remoteStats.fritz : EMPTY.fritz,
    ghost: userId ? remoteStats.ghost : EMPTY.ghost,
    lab: buildLabStats(userId),
  };
}
