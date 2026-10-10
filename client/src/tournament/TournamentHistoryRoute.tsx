import TournamentHistoryScreen, { useTournamentHistory, type TournamentHistoryScreenProps } from './TournamentHistoryScreen';

/** The History sub-view: loads /history on entry (lazy chunk with the screen). */
export default function TournamentHistoryRoute(props: Omit<TournamentHistoryScreenProps, 'history' | 'onRetry'>) {
  const { state, retry } = useTournamentHistory();
  return <TournamentHistoryScreen {...props} history={state} onRetry={retry} />;
}
