/** Friends presence delegates — owned by FriendsScreen, invoked by the registrar only. */
export type FriendsPresenceSocketDelegates = {
  onConnect: () => void;
  onPresenceUpdate?: (userId: string, status: string) => void;
};

export type FriendsSocketScope = {
  presence: FriendsPresenceSocketDelegates | null;
};