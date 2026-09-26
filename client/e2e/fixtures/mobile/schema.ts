import type { FriendRecord } from '../../../src/friends/friendsApi';

export type MobileFixtureStateId =
  | 'home/not-played'
  | 'home/completed'
  | 'solo/empty'
  | 'solo/populated'
  | 'solo/journey-locked';

export type MobileApiResponse = { method: 'GET' | 'POST' | 'DELETE'; path: string; status: number; body: unknown };

export type MobileFixtureDocument = {
  schemaVersion: 1;
  stateId: MobileFixtureStateId;
  route: string;
  clock: string;
  timezone: 'America/Los_Angeles';
  auth: { userId: string; bearer: 'e2e-daily-fritz' };
  profile: { username: string; rating: number; friends: FriendRecord[] };
  apiResponses: MobileApiResponse[];
  localStorage: Record<string, string>;
  socketScript?: Array<{ event: string; payload: unknown; afterMs: number }>;
  expected: { visibleText: string[]; absentText?: string[] };
};

export type MobileFixtureOverlay = Omit<MobileFixtureDocument, 'apiResponses' | 'localStorage'> & {
  apiResponses: MobileApiResponse[];
  localStorage?: Record<string, string>;
};
