import type { MutableRefObject } from 'react';
import type { SessionEvent, SessionSnapshot } from './sessionTypes';

export type UseSessionStateResult = {
  sessionRef: MutableRefObject<SessionSnapshot>;
  dispatchSession: (event: SessionEvent) => void;
  sessionSnapshot: SessionSnapshot;
};