import type { MutableRefObject } from 'react';
import type { SessionEvent, SessionSnapshot } from './sessionTypes';

/** Imperative session surface wired through multiplayer scopes — not recovery. */
export type MultiplayerSessionStateRuntime = {
  sessionRef: MutableRefObject<SessionSnapshot>;
  dispatchSession: (event: SessionEvent) => void;
};