// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getEnforcedMatchmakingRegistryEntries,
  getEnforcedRegistryEntries,
  getEnforcedTournamentRegistryEntries,
  MATCHMAKING_SOCKET_EVENT_VALUES,
  SOCKET_EVENT_REGISTRY,
  SOCKET_EVENTS,
  TOURNAMENT_SOCKET_EVENT_VALUES,
} from './socketEventRegistry';

describe('socketEventRegistry', () => {
  it('declares every SOCKET_EVENTS constant in the enforced registry', () => {
    const enforcedSocketEvents = new Set(
      getEnforcedRegistryEntries()
        .filter((entry) => entry.registrationKind === 'raw' || entry.registrationKind === 'bus-ingress')
        .map((entry) => entry.socketEvent),
    );
    for (const socketEvent of Object.values(SOCKET_EVENTS)) {
      expect(enforcedSocketEvents.has(socketEvent)).toBe(true);
    }
  });

  it('keeps enforced raw events uniquely owned per primary registrar', () => {
    const primaryOwners = new Map<string, string>();
    for (const entry of SOCKET_EVENT_REGISTRY) {
      if (!entry.enforced || entry.registrationKind !== 'raw') continue;
      const existing = primaryOwners.get(entry.socketEvent);
      if (existing) {
        throw new Error(
          `Duplicate primary raw owner for ${entry.socketEvent}: ${existing} and ${entry.registrar}`,
        );
      }
      primaryOwners.set(entry.socketEvent, entry.registrar);
    }
    expect(primaryOwners.size).toBeGreaterThan(0);
  });

  it('declares every tournament socket event in the enforced registry', () => {
    const enforcedTournamentEvents = new Set(
      getEnforcedTournamentRegistryEntries().map((entry) => entry.socketEvent),
    );
    for (const socketEvent of TOURNAMENT_SOCKET_EVENT_VALUES) {
      expect(enforcedTournamentEvents.has(socketEvent)).toBe(true);
    }
  });

  it('routes all tournament hub events through the tournament registrar', () => {
    const connectionOwnedTournamentEvents = new Set(['tournament:match:assigned']);
    for (const entry of getEnforcedTournamentRegistryEntries()) {
      if (entry.socketEvent === 'room:match_abandoned') continue;
      if (connectionOwnedTournamentEvents.has(entry.socketEvent)) continue;
      expect(entry.registrar).toBe('tournament/registerTournamentSocketHandlers.ts');
    }
  });

  it('declares every matchmaking socket event in the enforced registry', () => {
    const enforcedMatchmakingEvents = new Set(
      getEnforcedMatchmakingRegistryEntries().map((entry) => entry.socketEvent),
    );
    for (const socketEvent of MATCHMAKING_SOCKET_EVENT_VALUES) {
      expect(enforcedMatchmakingEvents.has(socketEvent)).toBe(true);
    }
  });

  it('routes all matchmaking events through the matchmaking registrar', () => {
    for (const entry of getEnforcedMatchmakingRegistryEntries()) {
      expect(entry.registrar).toBe('matchmaking/registerMatchmakingSocketHandlers.ts');
    }
  });
});