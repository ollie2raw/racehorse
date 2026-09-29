// client/src/components/board/useShortBoardViewport.ts
//
// True on a short, wide viewport (phone held sideways): the board is ~3x wider
// than tall, so long vertical branch arms bend instead of outgrowing it. Same
// query as SHORT_LANDSCAPE_QUERY in config/responsivePolicy.js.
import { useSyncExternalStore } from 'react';

const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 430px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(SHORT_LANDSCAPE);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(SHORT_LANDSCAPE).matches;
}

export function useShortBoardViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
