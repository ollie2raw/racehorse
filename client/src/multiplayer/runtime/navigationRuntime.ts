import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AppMode } from '../../types';

/** App-mode navigation callbacks/refs for multiplayer flows. */
export type MultiplayerNavigationRuntime = {
  appModeRef: MutableRefObject<AppMode>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
};

/** Navigation refs read by useTournamentMatchSession attach paths. */
export type TournamentAttachNavigationRuntime = Pick<
  MultiplayerNavigationRuntime,
  'appModeRef' | 'setAppMode'
>;