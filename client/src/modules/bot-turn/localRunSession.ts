import { useCallback, useRef, type MutableRefObject } from 'react';
import type { LocalRunToken } from '../match/types.ts';

export type LocalRunSession = {
  invalidateLocalRuns: () => void;
  beginLocalRun: (kind: LocalRunToken['kind']) => LocalRunToken;
  isLocalRunCurrent: (token: LocalRunToken) => boolean;
  hasActiveLocalRun: () => boolean;
  finishLocalRun: (token: LocalRunToken) => void;
  lifecycleVersionRef: MutableRefObject<number>;
};

export function useLocalRunSession(
  setDrawSequenceActiveBoth: (val: boolean) => void,
): LocalRunSession {
  const lifecycleVersionRef = useRef(0);
  const localRunIdRef = useRef(0);
  const activeLocalRunRef = useRef<LocalRunToken | null>(null);

  const invalidateLocalRuns = useCallback(() => {
    lifecycleVersionRef.current += 1;
    activeLocalRunRef.current = null;
    setDrawSequenceActiveBoth(false);
  }, [setDrawSequenceActiveBoth]);

  const beginLocalRun = useCallback((kind: LocalRunToken['kind']): LocalRunToken => {
    const token: LocalRunToken = {
      id: ++localRunIdRef.current,
      lifecycleVersion: lifecycleVersionRef.current,
      kind,
    };
    activeLocalRunRef.current = token;
    return token;
  }, []);

  const isLocalRunCurrent = useCallback((token: LocalRunToken): boolean => {
    const active = activeLocalRunRef.current;
    return Boolean(
      active &&
      active.id === token.id &&
      active.lifecycleVersion === token.lifecycleVersion &&
      lifecycleVersionRef.current === token.lifecycleVersion,
    );
  }, []);

  const hasActiveLocalRun = useCallback((): boolean => {
    const active = activeLocalRunRef.current;
    return Boolean(active && lifecycleVersionRef.current === active.lifecycleVersion);
  }, []);

  const finishLocalRun = useCallback((token: LocalRunToken) => {
    if (activeLocalRunRef.current?.id === token.id) {
      activeLocalRunRef.current = null;
    }
  }, []);

  return {
    invalidateLocalRuns,
    beginLocalRun,
    isLocalRunCurrent,
    hasActiveLocalRun,
    finishLocalRun,
    lifecycleVersionRef,
  };
}