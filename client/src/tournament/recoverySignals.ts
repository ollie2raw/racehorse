type VisibilityDocument = {
  visibilityState: 'visible' | 'hidden' | string;
  addEventListener(event: 'visibilitychange', handler: () => void): void;
  removeEventListener(event: 'visibilitychange', handler: () => void): void;
};

/** Document visibility recovery — socket connect recovery is owned by registerTournamentSocketHandlers. */
export function bindTournamentRecoverySignals(input: {
  documentLike: VisibilityDocument;
  onRecover: () => void;
}): () => void {
  const { documentLike, onRecover } = input;
  const onVisible = () => {
    if (documentLike.visibilityState === 'visible') onRecover();
  };

  documentLike.addEventListener('visibilitychange', onVisible);

  return () => {
    documentLike.removeEventListener('visibilitychange', onVisible);
  };
}