import type { FriendsSocketScope } from './friendsSocketTypes';

/** Mutable scope read by the friends registrar — FriendsScreen assigns delegates. */
export const friendsSocketScopeRef: { current: FriendsSocketScope } = {
  current: {
    presence: null,
  },
};