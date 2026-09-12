import type { JourneyContentId } from './journeyContentContract.ts';

export type JourneyPremiumHostKind = 'authored_board_lesson';

export type JourneyPremiumHostRegistration = {
  contentId: JourneyContentId;
  hostKind: JourneyPremiumHostKind;
};

export const PRODUCTION_JOURNEY_PREMIUM_HOSTS: ReadonlyArray<JourneyPremiumHostRegistration> = [
  { contentId: 'journey:ch1:open-end-discipline' as JourneyContentId, hostKind: 'authored_board_lesson' },
  { contentId: 'journey:ch1:counting-whats-left' as JourneyContentId, hostKind: 'authored_board_lesson' },
  { contentId: 'journey:ch1:doubles-arent-free' as JourneyContentId, hostKind: 'authored_board_lesson' },
  { contentId: 'journey:ch2:blocked-hand-tiebreak' as JourneyContentId, hostKind: 'authored_board_lesson' },
  { contentId: 'journey:ch3:endgame-hand-shape' as JourneyContentId, hostKind: 'authored_board_lesson' },
  { contentId: 'journey:ch4:defensive-holding' as JourneyContentId, hostKind: 'authored_board_lesson' },
];

const HOSTS_BY_CONTENT_ID = new Map(PRODUCTION_JOURNEY_PREMIUM_HOSTS.map((host) => [String(host.contentId), host]));

export function getJourneyPremiumHostRegistration(contentId: string): JourneyPremiumHostRegistration | null {
  return HOSTS_BY_CONTENT_ID.get(contentId) ?? null;
}

export function hasJourneyPremiumRuntimeHost(contentId: string): boolean {
  return HOSTS_BY_CONTENT_ID.has(contentId);
}

export function getJourneyPremiumHostKind(contentId: string): JourneyPremiumHostKind | null {
  return getJourneyPremiumHostRegistration(contentId)?.hostKind ?? null;
}
