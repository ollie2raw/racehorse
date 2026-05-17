type SocketLike = {
  on(event: 'connect', handler: () => void): void;
  off(event: 'connect', handler: () => void): void;
};

type VisibilityDocument = {
  visibilityState: 'visible' | 'hidden' | string;
  addEventListener(event: 'visibilitychange', handler: () => void): void;
  removeEventListener(event: 'visibilitychange', handler: () => void): void;
};

export function bindTournamentRecoverySignals(input: {
  socket: SocketLike | null;
  documentLike: VisibilityDocument;
  onRecover: () => void;
}): () => void {
  const { socket, documentLike, onRecover } = input;
  const onVisible = () => {
    if (documentLike.visibilityState === 'visible') onRecover();
  };
  const onConnect = () => {
    onRecover();
  };

  socket?.on('connect', onConnect);
  documentLike.addEventListener('visibilitychange', onVisible);

  return () => {
    socket?.off('connect', onConnect);
    documentLike.removeEventListener('visibilitychange', onVisible);
  };
}
