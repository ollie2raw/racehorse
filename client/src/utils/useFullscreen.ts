import { useState, useEffect, useCallback } from 'react';

export type UseFullscreenResult = {
  isFullscreen: boolean;
  toggleFullscreen: () => Promise<void>;
};

export function useFullscreen(
  containerRef: React.RefObject<HTMLElement | null>,
  onError: (msg: string) => void,
): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (containerRef.current) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to toggle fullscreen.';
      onError(`Fullscreen error: ${message}`);
    }
  }, [containerRef, onError]);

  return { isFullscreen, toggleFullscreen };
}
