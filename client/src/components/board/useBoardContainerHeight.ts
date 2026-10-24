// client/src/components/board/useBoardContainerHeight.ts
//
// Measures the board container's height *before* the layout is computed, so the
// viewport-aware routing (boardRouting.ts) can pick a limit in the very first
// committed render. The camera hook measures the same element for fitting, but
// it runs after the layout it needs, so it cannot feed routing. Board.tsx owns
// the ref and hands it to both.
import { useLayoutEffect, useRef, useState } from 'react';
import { bucketContainerHeight } from './boardRouting';

export function useBoardContainerHeight(enabled: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Bucketed (boardRouting.HEIGHT_BUCKET_PX): re-renders only when the routing
  // answer could change, not on every ResizeObserver tick.
  const [bucketedHeight, setBucketedHeight] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return undefined;
    const measure = () => {
      const next = bucketContainerHeight(container.getBoundingClientRect().height);
      setBucketedHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [enabled]);

  return { containerRef, containerHeight: enabled ? bucketedHeight : 0 };
}
