/**
 * Tournament history (Phase 3E): /history's rows in the player's words —
 * kind, local date and time, finish (Champion / Runner-up / Semifinal /
 * Quarterfinal), an unusual ending only when there was one, a Fritz champion
 * by name with its chip — plus loading, empty and error states, and the API's
 * structured errors.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components', () => ({ GlobalNav: () => null }));

const http = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../api/client', () => http);

import TournamentHistoryScreen from './TournamentHistoryScreen';
import { deriveHistoryRows, historyFinishLabel, historyOutcomeNote } from './tournamentHistoryView';
import { fetchHistory, TournamentApiError } from './tournamentApi';
import type { TournamentHistoryEntry } from './types';

afterEach(cleanup);

const entry = (over: Partial<TournamentHistoryEntry>): TournamentHistoryEntry => ({
  tournamentId: 't', kind: 'live', scheduledStart: '2026-10-31T03:00:00.000Z', format: '7-tile', winTarget: 30,
  placement: 3, placementLabel: 'Semifinalist', championId: 'u-ana', championName: 'ana', championIsFritz: false, championFritzTier: null,
  myLastMatch: { matchId: 'm', round: 2, won: false, outcomeKind: 'played', opponentId: 'u-ana', opponentBotTier: null }, ...over,
});

describe('history rows', () => {
  it('finish words from the placement (never a bare number)', () => {
    expect([1, 2, 3, 5].map((p) => historyFinishLabel(p, null))).toEqual(['Champion', 'Runner-up', 'Semifinal', 'Quarterfinal']);
  });

  it('kind, local date and time (New York vs Los Angeles)', () => {
    const [ny] = deriveHistoryRows([entry({})], { timeZone: 'America/New_York', locale: 'en-US' });
    const [la] = deriveHistoryRows([entry({ kind: 'fritz_cup' })], { timeZone: 'America/Los_Angeles', locale: 'en-US' });
    expect(ny).toMatchObject({ kindLabel: 'Live Event', when: 'Oct 30 · 11:00 PM', finish: 'Semifinal', note: null });
    expect(la).toMatchObject({ kindLabel: 'Fritz Cup', when: 'Oct 30 · 8:00 PM' });
  });

  it('an unusual ending gets a note; a played one does not', () => {
    expect(historyOutcomeNote('played', false)).toBeNull();
    expect(historyOutcomeNote('forfeit', false)).toBe('Forfeit');
    expect(historyOutcomeNote('forfeit', true)).toBe('Opponent forfeited');
    expect(historyOutcomeNote('missed_turns', false)).toBe('Missed turns');
    expect(historyOutcomeNote('no_show', false)).toBe('No-show');
    expect(historyOutcomeNote('administrative', true)).toBe('Advanced by rule');
  });

  it('a Fritz champion by name with its chip; the player\'s own win shows no champion line', () => {
    const [lost] = deriveHistoryRows([entry({ championId: 'bot:fritz:t:7', championName: 'Master Fritz', championIsFritz: true, championFritzTier: 'master', placement: 2 })]);
    expect(lost.champion).toMatchObject({ label: 'Master Fritz', badgeLabel: 'Fritz' });
    const [noName] = deriveHistoryRows([entry({ championId: 'bot:fritz:t:7', championName: null, championIsFritz: true, championFritzTier: 'master' })]);
    expect(noName.champion?.label).toBe('Master Fritz');
    const [won] = deriveHistoryRows([entry({ placement: 1, championId: 'me', championName: 'me' })]);
    expect(won).toMatchObject({ isChampion: true, finish: 'Champion', champion: null });
  });
});

const props = (over: Partial<Parameters<typeof TournamentHistoryScreen>[0]>) => ({
  history: { status: 'ready' as const, entries: [] }, fritzCupEnabled: true, onRetry: vi.fn(), onBack: vi.fn(), timeZone: 'America/Los_Angeles', ...over,
});

describe('history screen', () => {
  it('rows: kind, finish, note, Fritz champion — no raw ids', () => {
    render(<TournamentHistoryScreen {...props({
      history: { status: 'ready', entries: [
        entry({ tournamentId: 'a', kind: 'fritz_cup', placement: 1, championId: 'me', championName: 'me' }),
        entry({ tournamentId: 'b', placement: 2, championId: 'bot:fritz:b:7', championName: 'Master Fritz', championIsFritz: true, championFritzTier: 'master', myLastMatch: { matchId: 'f', round: 3, won: false, outcomeKind: 'played', opponentId: 'bot:fritz:b:7', opponentBotTier: 'master' } }),
        entry({ tournamentId: 'c', placement: 5, myLastMatch: { matchId: 'q', round: 1, won: false, outcomeKind: 'missed_turns', opponentId: 'x', opponentBotTier: null } }),
      ] },
    })} />);
    expect(screen.getAllByText('Champion')[0]).toBeTruthy();
    expect(screen.getByText('Won')).toBeTruthy();
    expect(screen.getByText('Runner-up')).toBeTruthy();
    expect(screen.getByText('Quarterfinal')).toBeTruthy();
    expect(screen.getByText('Missed turns')).toBeTruthy();
    expect(screen.getByText(/Champion: Master Fritz/)).toBeTruthy();
    expect(screen.getByText('Fritz', { selector: '.th-history__fritz' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/bot:|fritz:|—/);
  });

  it('loading, empty (Fritz Cup mentioned only when on), error with Retry', () => {
    const { rerender } = render(<TournamentHistoryScreen {...props({ history: { status: 'loading' } })} />);
    expect(screen.getByText('Loading tournament history…')).toBeTruthy();
    rerender(<TournamentHistoryScreen {...props({})} />);
    expect(screen.getByText('No tournament results yet.')).toBeTruthy();
    expect(screen.getByText('Play a Fritz Cup or join a Live Event to get started.')).toBeTruthy();
    rerender(<TournamentHistoryScreen {...props({ fritzCupEnabled: false })} />);
    expect(screen.getByText('Join a Live Event to get started.')).toBeTruthy();
    expect(screen.queryByText(/Fritz Cup/)).toBeNull();
    const onRetry = vi.fn();
    rerender(<TournamentHistoryScreen {...props({ history: { status: 'error' }, onRetry })} />);
    expect(screen.getByText("Couldn't load tournament history.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('history API', () => {
  it('returns the rows and keeps structured errors', async () => {
    http.apiGet.mockResolvedValueOnce({ data: { ok: true, history: [entry({})], serverNow: '2026-10-31T00:00:00.000Z' }, error: null, status: 200 });
    expect(await fetchHistory()).toHaveLength(1);
    http.apiGet.mockResolvedValueOnce({ data: null, error: 'not_authenticated', errorData: { ok: false, error: 'not_authenticated' }, status: 401 });
    await expect(fetchHistory()).rejects.toMatchObject({ code: 'not_authenticated', status: 401 });
    http.apiGet.mockResolvedValueOnce({ data: null, error: 'Network error' });
    await expect(fetchHistory()).rejects.toBeInstanceOf(TournamentApiError);
  });
});
