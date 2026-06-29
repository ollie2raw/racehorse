import React, { Suspense, useSyncExternalStore } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { FriendInvitePopupOverlay } from '../AppOverlays';
import { useAppRoutesInput } from '../useAppRoutesInput';
import { useAppRoutesProps } from '../useAppRoutesProps';
import type { UseAppRoutesPropsSource } from '../useAppRoutesProps';
import type { FriendInviteState } from './multiplayerRuntime';
import {
  EMPTY_ROUTE_PROPS,
  getGameSnapshot,
  subscribeGameSnapshot,
} from './multiplayerGameSnapshot';

const AppRoutes = React.lazy(() => import('../AppRoutes'));

export type AppRoutesGamePropsHostSource = Omit<
  UseAppRoutesPropsSource,
  keyof typeof EMPTY_ROUTE_PROPS | 'isRoomHost' | 'friendInvitePopup' | 'actionError' | 'state' | 'startGame'
> & {
  fallbackIsRoomHost: boolean;
  friendInvite: FriendInviteState;
};

type AppRoutesGamePropsHostProps = {
  source: AppRoutesGamePropsHostSource;
};

export function AppRoutesGamePropsHost({ source }: AppRoutesGamePropsHostProps) {
  const gameSnapshot = useSyncExternalStore(subscribeGameSnapshot, getGameSnapshot, getGameSnapshot);
  const routeProps =
    source.joinedRoom
      ? gameSnapshot.routeProps
      : { ...EMPTY_ROUTE_PROPS, isRoomHost: source.fallbackIsRoomHost };

  const friendInvitePopup = (
    <FriendInvitePopupOverlay
      invite={source.friendInvite}
      joining={routeProps.pendingUiAction === 'join'}
    />
  );

  const appRoutesInput = useAppRoutesInput({
    ...source,
    ...routeProps,
    isRoomHost: routeProps.isRoomHost,
    friendInvitePopup,
    actionError: routeProps.actionError,
    state: routeProps.state,
    startGame: routeProps.startGame,
  });

  const appRoutesProps = useAppRoutesProps(appRoutesInput);

  return (
    <Suspense fallback={<ScreenLoader label="Loading…" />}>
      <AppRoutes {...appRoutesProps} />
    </Suspense>
  );
}
