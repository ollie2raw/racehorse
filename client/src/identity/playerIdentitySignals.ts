import type {
  PlayerIdentityModel,
  PlayerIdentitySignal,
  PlayerIdentitySignalDetails,
  PlayerIdentitySignals,
} from './playerIdentityTypes';

export const MIN_FRITZ_COMPARISON_GAMES = 5;
export const CANONICAL_FRITZ_DIFFICULTIES = ['rookie', 'standard', 'elite', 'master'] as const;

export const PLAYER_IDENTITY_SIGNAL_STRENGTH: Record<PlayerIdentitySignal['strength'], number> = {
  supporting: 1,
  notable: 2,
  signature: 3,
};

function signal(input: Omit<PlayerIdentitySignal, 'details'> & { details: PlayerIdentitySignalDetails }): PlayerIdentitySignal {
  return input;
}

function sortedSignals(signals: PlayerIdentitySignal[]): PlayerIdentitySignal[] {
  return [...signals].sort((a, b) => b.priority - a.priority || PLAYER_IDENTITY_SIGNAL_STRENGTH[b.strength] - PLAYER_IDENTITY_SIGNAL_STRENGTH[a.strength] || (b.sampleSize ?? -1) - (a.sampleSize ?? -1) || a.id.localeCompare(b.id));
}

function addCompetitiveSignals(model: PlayerIdentityModel, output: PlayerIdentitySignal[]): void {
  const { competitive } = model;
  if (competitive.rating != null && competitive.peakRating != null && competitive.rating >= competitive.peakRating) {
    output.push(signal({ id: 'competitive:at-peak', type: 'competitive_at_peak', domain: 'competitive', strength: 'signature', priority: 100, label: 'At your peak rating', evidence: `${competitive.rating.toLocaleString()} current and peak rating`, value: competitive.rating, sampleSize: competitive.rankedGames, visibility: 'public', details: { kind: 'rating', current: competitive.rating, peak: competitive.peakRating } }));
  }
  if (competitive.rankedGames != null && competitive.rankedGames > 0) output.push(signal({ id: 'competitive:ranked-games', type: 'competitive_ranked_games', domain: 'competitive', strength: 'supporting', priority: 40, label: `${competitive.rankedGames.toLocaleString()} ranked games played`, evidence: `${competitive.rankedGames.toLocaleString()} ranked games`, value: competitive.rankedGames, sampleSize: competitive.rankedGames, visibility: 'public', details: { kind: 'count', count: competitive.rankedGames } }));
  if (competitive.bestStreak != null && competitive.bestStreak > 0) output.push(signal({ id: 'competitive:best-streak', type: 'competitive_best_streak', domain: 'competitive', strength: 'notable', priority: 80, label: `${competitive.bestStreak}-game best win streak`, evidence: `${competitive.bestStreak} consecutive wins`, value: competitive.bestStreak, sampleSize: competitive.rankedGames, visibility: 'public', details: { kind: 'streak', games: competitive.bestStreak } }));
  if (competitive.currentStreak != null && competitive.currentStreak > 0) output.push(signal({ id: 'competitive:current-streak', type: 'competitive_current_streak', domain: 'competitive', strength: 'notable', priority: 85, label: `Currently on a ${competitive.currentStreak}-game win streak`, evidence: `${competitive.currentStreak} consecutive current wins`, value: competitive.currentStreak, sampleSize: competitive.rankedGames, visibility: 'public', details: { kind: 'streak', games: competitive.currentStreak } }));
  const form = competitive.recentForm.filter((result) => result === 'win' || result === 'loss');
  if (form.length >= 3) {
    const wins = form.filter((result) => result === 'win').length;
    const losses = form.length - wins;
    output.push(signal({ id: `competitive:recent-form:${form.length}`, type: 'competitive_recent_form', domain: 'competitive', strength: 'notable', priority: 90, label: `${wins} wins in your last ${form.length} matches`, evidence: `${wins} wins, ${losses} losses across the latest ${form.length} results`, value: wins, sampleSize: form.length, visibility: 'public', details: { kind: 'form', wins, losses, games: form.length } }));
  }
}

function addFritzSignals(model: PlayerIdentityModel, output: PlayerIdentitySignal[]): void {
  const { fritz } = model;
  const records = [...fritz.difficultyRecords].filter((record) => record.games >= 0 && record.wins >= 0 && record.losses >= 0);
  const ordered = [...records].sort((a, b) => b.games - a.games || (b.wins + b.losses) - (a.wins + a.losses) || CANONICAL_FRITZ_DIFFICULTIES.indexOf(a.difficulty.toLowerCase() as typeof CANONICAL_FRITZ_DIFFICULTIES[number]) - CANONICAL_FRITZ_DIFFICULTIES.indexOf(b.difficulty.toLowerCase() as typeof CANONICAL_FRITZ_DIFFICULTIES[number]) || a.difficulty.localeCompare(b.difficulty));
  const mostPlayed = ordered.find((record) => record.games > 0);
  if (mostPlayed) output.push(signal({ id: `fritz:most-played:${mostPlayed.difficulty.toLowerCase()}`, type: 'fritz_most_played_difficulty', domain: 'fritz', strength: 'notable', priority: 75, label: `Most played against ${mostPlayed.difficulty} Fritz`, evidence: `${mostPlayed.games} games`, value: mostPlayed.difficulty, sampleSize: mostPlayed.games, visibility: 'public', details: { kind: 'record', wins: mostPlayed.wins, losses: mostPlayed.losses, games: mostPlayed.games, difficulty: mostPlayed.difficulty } }));
  const eligible = records.filter((record) => record.games >= MIN_FRITZ_COMPARISON_GAMES && record.wins + record.losses === record.games && record.games > 0).map((record) => ({ record, rate: record.wins / record.games })).sort((a, b) => b.rate - a.rate || b.record.games - a.record.games || b.record.wins - a.record.wins || CANONICAL_FRITZ_DIFFICULTIES.indexOf(a.record.difficulty.toLowerCase() as typeof CANONICAL_FRITZ_DIFFICULTIES[number]) - CANONICAL_FRITZ_DIFFICULTIES.indexOf(b.record.difficulty.toLowerCase() as typeof CANONICAL_FRITZ_DIFFICULTIES[number]) || a.record.difficulty.localeCompare(b.record.difficulty));
  const best = eligible[0]?.record;
  if (best) output.push(signal({ id: `fritz:best-record:${best.difficulty.toLowerCase()}`, type: 'fritz_best_record', domain: 'fritz', strength: 'signature', priority: 95, label: `Best Fritz record: ${best.difficulty}`, evidence: `${best.wins}W–${best.losses}L across ${best.games} games`, value: best.difficulty, sampleSize: best.games, visibility: 'public', details: { kind: 'record', wins: best.wins, losses: best.losses, games: best.games, difficulty: best.difficulty } }));
  if (CANONICAL_FRITZ_DIFFICULTIES.every((difficulty) => records.some((record) => record.difficulty.toLowerCase() === difficulty && record.games > 0))) output.push(signal({ id: 'fritz:all-difficulties', type: 'fritz_all_difficulties', domain: 'fritz', strength: 'notable', priority: 70, label: 'Played all four Fritz difficulties', evidence: 'Authoritative games recorded across Rookie, Standard, Elite, and Master', value: 4, sampleSize: records.reduce((sum, record) => sum + record.games, 0), visibility: 'public', details: { kind: 'count', count: 4 } }));
  const totalGames = fritz.totalWins != null && fritz.totalLosses != null ? fritz.totalWins + fritz.totalLosses : null;
  const totalWins = fritz.totalWins;
  const totalLosses = fritz.totalLosses;
  if (totalGames != null && totalGames > 0 && totalWins != null && totalLosses != null) output.push(signal({ id: 'fritz:overall-record', type: 'fritz_overall_record', domain: 'fritz', strength: 'supporting', priority: 55, label: `${totalWins}W–${totalLosses}L against Fritz`, evidence: `${totalGames} Fritz games`, value: totalGames, sampleSize: totalGames, visibility: 'public', details: { kind: 'record', wins: totalWins, losses: totalLosses, games: totalGames } }));
  if (fritz.averageScore != null) output.push(signal({ id: 'fritz:average-score', type: 'fritz_average_score', domain: 'fritz', strength: 'supporting', priority: 45, label: `Fritz average score: ${fritz.averageScore}`, evidence: 'Authoritative average score', value: fritz.averageScore, sampleSize: totalGames, visibility: 'public', details: { kind: 'score', score: fritz.averageScore, scope: 'average' } }));
  if (fritz.bestScore != null) output.push(signal({ id: 'fritz:best-score', type: 'fritz_best_score', domain: 'fritz', strength: 'notable', priority: 65, label: `Fritz best score: ${fritz.bestScore}`, evidence: 'Authoritative highest score', value: fritz.bestScore, sampleSize: totalGames, visibility: 'public', details: { kind: 'score', score: fritz.bestScore, scope: 'all_time' } }));
}

function addPuzzleSignals(model: PlayerIdentityModel, output: PlayerIdentitySignal[]): void {
  const { puzzle } = model;
  if (puzzle.completions != null && puzzle.completions > 0) output.push(signal({ id: 'puzzle:completions', type: 'puzzle_completions', domain: 'puzzle', strength: 'supporting', priority: 55, label: `${puzzle.completions} Daily Puzzle completions`, evidence: `${puzzle.completions} completed puzzles`, value: puzzle.completions, sampleSize: puzzle.completions, visibility: 'public', details: { kind: 'count', count: puzzle.completions } }));
  if (puzzle.currentStreak != null && puzzle.currentStreak > 0) output.push(signal({ id: 'puzzle:current-streak', type: 'puzzle_current_streak', domain: 'puzzle', strength: 'notable', priority: 75, label: `${puzzle.currentStreak}-day Daily Puzzle streak`, evidence: `${puzzle.currentStreak} consecutive puzzle days`, value: puzzle.currentStreak, sampleSize: puzzle.completions, visibility: 'public', details: { kind: 'streak', games: puzzle.currentStreak } }));
  if (puzzle.bestScoreEver != null) output.push(signal({ id: 'puzzle:best-score', type: 'puzzle_best_ever', domain: 'puzzle', strength: 'notable', priority: 80, label: `Puzzle best: ${puzzle.bestScoreEver}`, evidence: 'All-time Daily Puzzle best', value: puzzle.bestScoreEver, sampleSize: puzzle.completions, visibility: 'public', details: { kind: 'score', score: puzzle.bestScoreEver, scope: 'all_time' } }));
  if (puzzle.bestScoreToday != null) output.push(signal({ id: 'puzzle:best-today', type: 'puzzle_best_today', domain: 'puzzle', strength: 'supporting', priority: 35, label: `Today’s best: ${puzzle.bestScoreToday}`, evidence: 'Today-only Daily Puzzle score', value: puzzle.bestScoreToday, sampleSize: 1, visibility: 'public', details: { kind: 'score', score: puzzle.bestScoreToday, scope: 'today' } }));
  if (puzzle.perfectDays != null && puzzle.perfectDays > 0) output.push(signal({ id: 'puzzle:perfect-days', type: 'puzzle_perfect_days', domain: 'puzzle', strength: 'notable', priority: 65, label: `${puzzle.perfectDays} perfect Puzzle days`, evidence: `${puzzle.perfectDays} perfect completions`, value: puzzle.perfectDays, sampleSize: puzzle.completions, visibility: 'public', details: { kind: 'count', count: puzzle.perfectDays } }));
}

function addLearningSignals(model: PlayerIdentityModel, output: PlayerIdentitySignal[]): void {
  if (!model.subject.isCurrentUser) return;
  const { learning } = model;
  if (learning.completedNodes != null && learning.totalNodes != null && learning.totalNodes > 0) {
    const complete = learning.completedNodes >= learning.totalNodes;
    output.push(signal({ id: 'learning:journey-progress', type: 'learning_journey_progress', domain: 'learning', strength: complete ? 'signature' : 'supporting', priority: complete ? 96 : 50, label: complete ? 'Journey complete' : `${learning.completedNodes} of ${learning.totalNodes} Journey nodes complete`, evidence: `${learning.completedNodes} of ${learning.totalNodes} nodes`, value: learning.completedNodes, sampleSize: learning.totalNodes, visibility: 'self_only', details: { kind: 'journey', completed: learning.completedNodes, total: learning.totalNodes } }));
  }
  if (learning.activeChapterTitle) output.push(signal({ id: 'learning:active-chapter', type: 'learning_active_chapter', domain: 'learning', strength: 'supporting', priority: 45, label: `Currently learning: ${learning.activeChapterTitle}`, evidence: 'Active Journey chapter', value: learning.activeChapterTitle, sampleSize: null, visibility: 'self_only', details: { kind: 'chapter', title: learning.activeChapterTitle } }));
}

function addRivalrySignals(model: PlayerIdentityModel, output: PlayerIdentitySignal[]): void {
  if (model.subject.isCurrentUser) {
    const rival = model.rivalry.closestRival;
    if (rival && rival.gamesPlayed > 0) output.push(signal({ id: `rivalry:most-played:${rival.userId}`, type: 'rivalry_most_played', domain: 'rivalry', strength: 'notable', priority: 72, label: `Most-played rival: ${rival.username}`, evidence: `${rival.gamesPlayed} games together`, value: rival.username, sampleSize: rival.gamesPlayed, visibility: 'self_only', details: { kind: 'rival', userId: rival.userId, username: rival.username, games: rival.gamesPlayed } }));
    return;
  }
  const h2h = model.rivalry.currentViewerHeadToHead;
  if (h2h && h2h.wins >= 0 && h2h.losses >= 0 && h2h.wins + h2h.losses > 0) {
    const games = h2h.wins + h2h.losses;
    output.push(signal({ id: `rivalry:viewer-head-to-head:${model.subject.userId ?? 'unknown'}`, type: 'rivalry_viewer_head_to_head', domain: 'rivalry', strength: games >= MIN_FRITZ_COMPARISON_GAMES ? 'notable' : 'supporting', priority: games >= MIN_FRITZ_COMPARISON_GAMES ? 78 : 48, label: `Your record vs ${model.subject.username ?? 'this player'}`, evidence: `${h2h.wins}W–${h2h.losses}L`, value: games, sampleSize: games, visibility: 'public', details: { kind: 'record', wins: h2h.wins, losses: h2h.losses, games } }));
  }
}

function selectFeatured(signals: PlayerIdentitySignal[], self: boolean): PlayerIdentitySignal[] {
  const candidates = sortedSignals(signals).filter((item) => self || item.visibility === 'public');
  const selected: PlayerIdentitySignal[] = [];
  const counts = new Map<string, number>();
  const domains = ['competitive', 'fritz', 'puzzle', 'learning', 'rivalry'] as const;
  for (const domain of domains) {
    const candidate = candidates.find((item) => item.domain === domain && (counts.get(item.domain) ?? 0) < 2);
    if (candidate) { selected.push(candidate); counts.set(candidate.domain, 1); }
  }
  for (const candidate of candidates) {
    if (selected.length >= 5) break;
    const count = counts.get(candidate.domain) ?? 0;
    if (count >= 2 || selected.some((item) => item.id === candidate.id)) continue;
    selected.push(candidate);
    counts.set(candidate.domain, count + 1);
  }
  return sortedSignals(selected).slice(0, 5);
}

export function derivePlayerIdentitySignals(model: PlayerIdentityModel): PlayerIdentitySignals {
  const raw: PlayerIdentitySignal[] = [];
  addCompetitiveSignals(model, raw);
  addFritzSignals(model, raw);
  addPuzzleSignals(model, raw);
  addLearningSignals(model, raw);
  addRivalrySignals(model, raw);
  const all = sortedSignals(raw);
  const publicSignals = all.filter((item) => item.visibility === 'public');
  const selfSignals = model.subject.isCurrentUser ? all : [];
  return { all, publicSignals, selfSignals, featured: selectFeatured(all, model.subject.isCurrentUser) };
}
