/**
 * CI validator — socket event registry ownership enforcement.
 * Run: npm run check:socket-registry
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_SOCKET_REGISTRAR_FILES,
  getEnforcedMatchmakingRegistryEntries,
  getEnforcedTournamentRegistryEntries,
  GRANDFATHERED_DIRECT_SOCKET_ON,
  MATCHMAKING_SOCKET_EVENTS,
  MATCHMAKING_SOCKET_EVENT_VALUES,
  SOCKET_EVENT_REGISTRY,
  SOCKET_EVENTS,
  TOURNAMENT_SOCKET_EVENTS,
  TOURNAMENT_SOCKET_EVENT_VALUES,
  type SocketEventRegistryEntry,
} from '../src/multiplayer/socketEventRegistry.ts';

const SOCKET_EVENT_CONST_VALUES = new Map(
  Object.entries(SOCKET_EVENTS).map(([key, value]) => [`SOCKET_EVENTS.${key}`, value]),
);

const TOURNAMENT_SOCKET_EVENT_CONST_VALUES = new Map(
  Object.entries(TOURNAMENT_SOCKET_EVENTS).map(([key, value]) => [`TOURNAMENT_SOCKET_EVENTS.${key}`, value]),
);

const MATCHMAKING_SOCKET_EVENT_CONST_VALUES = new Map(
  Object.entries(MATCHMAKING_SOCKET_EVENTS).map(([key, value]) => [`MATCHMAKING_SOCKET_EVENTS.${key}`, value]),
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = path.resolve(__dirname, '../src');

type RawRegistration = { file: string; socketEvent: string };
type NormalizedRegistration = { file: string; routerKey: string };
type DirectSocketOn = { file: string; socketEvent: string; line: number };

const errors: string[] = [];

function relativeSrcPath(absolutePath: string): string {
  return path.relative(CLIENT_SRC, absolutePath).split(path.sep).join('/');
}

function walkTsFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkTsFiles(fullPath, results);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|behaviorTests|invariantTests)\./.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function resolveSocketEventToken(token: string): string | null {
  const trimmed = token.trim();
  if (/^['"`]/.test(trimmed)) {
    return trimmed.replace(/^['"`]/, '').replace(/['"`]$/, '');
  }
  return (
    SOCKET_EVENT_CONST_VALUES.get(trimmed) ??
    TOURNAMENT_SOCKET_EVENT_CONST_VALUES.get(trimmed) ??
    MATCHMAKING_SOCKET_EVENT_CONST_VALUES.get(trimmed) ??
    null
  );
}

function scanRawRegistrations(content: string, file: string): RawRegistration[] {
  const results: RawRegistration[] = [];
  const patterns = [
    /registerRawSocketEventHandler\(\s*([^,\s)]+)/g,
    /\bregister\(\s*([^,\s)]+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const resolved = resolveSocketEventToken(match[1]);
      if (resolved) {
        results.push({ file, socketEvent: resolved });
      }
    }
  }
  return results;
}

const NORMALIZED_ROUTER_KEYS = [
  'roomJoinOk',
  'stateUpdate',
  'resyncNeeded',
  'transportFail',
  'roomJoinTerminal',
] as const;

function scanNormalizedRegistrations(content: string, file: string): NormalizedRegistration[] {
  if (!content.includes('registerNormalizedSocketRouter')) {
    return [];
  }
  const results: NormalizedRegistration[] = [];
  for (const routerKey of NORMALIZED_ROUTER_KEYS) {
    const pattern = new RegExp(`\\b${routerKey}\\s*:`);
    if (pattern.test(content)) {
      results.push({ file, routerKey });
    }
  }
  return results;
}

function scanDirectSocketOn(content: string, file: string): DirectSocketOn[] {
  const results: DirectSocketOn[] = [];
  const lines = content.split('\n');
  const pattern = /\.on\(\s*['"`]([^'"`]+)['"`]/g;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.includes('socketEventBus.ts') && line.includes('socket.on')) continue;
    let match: RegExpExecArray | null;
    const linePattern = /\.on\(\s*['"`]([^'"`]+)['"`]/g;
    while ((match = linePattern.exec(line)) !== null) {
      results.push({ file, socketEvent: match[1], line: i + 1 });
    }
  }
  return results;
}

function allowedRegistrarFiles(entry: SocketEventRegistryEntry): Set<string> {
  const allowed = new Set<string>([entry.registrar]);
  for (const extra of entry.additionalRegistrars ?? []) {
    allowed.add(extra);
  }
  return allowed;
}

function main(): void {
  const sourceFiles = walkTsFiles(CLIENT_SRC);
  const rawRegistrations: RawRegistration[] = [];
  const normalizedRegistrations: NormalizedRegistration[] = [];
  const directSocketOn: DirectSocketOn[] = [];

  for (const absolutePath of sourceFiles) {
    const file = relativeSrcPath(absolutePath);
    const content = fs.readFileSync(absolutePath, 'utf8');
    if (file === 'multiplayer/socketEventBus.ts') {
      directSocketOn.push(...scanDirectSocketOn(content, file));
      continue;
    }
    rawRegistrations.push(...scanRawRegistrations(content, file));
    normalizedRegistrations.push(...scanNormalizedRegistrations(content, file));
    directSocketOn.push(...scanDirectSocketOn(content, file));
  }

  const enforcedRaw = SOCKET_EVENT_REGISTRY.filter(
    (entry) => entry.enforced && entry.registrationKind === 'raw',
  );
  const enforcedNormalized = SOCKET_EVENT_REGISTRY.filter(
    (entry) => entry.enforced && entry.registrationKind === 'normalized',
  );
  const busIngress = SOCKET_EVENT_REGISTRY.filter(
    (entry) => entry.enforced && entry.registrationKind === 'bus-ingress',
  );

  for (const entry of enforcedRaw) {
    const allowedFiles = allowedRegistrarFiles(entry);
    const matches = rawRegistrations.filter((reg) => reg.socketEvent === entry.socketEvent);
    if (matches.length === 0) {
      errors.push(
        `Missing raw registration for "${entry.socketEvent}" — expected in ${entry.registrar}`,
      );
      continue;
    }
    const matchFiles = new Set(matches.map((reg) => reg.file));
    for (const matchFile of matchFiles) {
      if (!allowedFiles.has(matchFile)) {
        errors.push(
          `Orphan raw registration: "${entry.socketEvent}" in ${matchFile} — owner ${entry.owner} allows only ${[...allowedFiles].join(', ')}`,
        );
      }
    }
    for (const allowed of allowedFiles) {
      if (allowed === entry.registrar && !matchFiles.has(allowed)) {
        errors.push(
          `Missing raw registration for "${entry.socketEvent}" in ${allowed} (primary registrar for owner ${entry.owner})`,
        );
      }
      if (
        entry.additionalRegistrars?.includes(allowed) &&
        !matchFiles.has(allowed)
      ) {
        errors.push(
          `Missing raw registration for "${entry.socketEvent}" in ${allowed} (additional registrar for owner ${entry.owner})`,
        );
      }
    }
  }

  for (const entry of enforcedNormalized) {
    const allowedFiles = new Set([entry.registrar, ...(entry.additionalRegistrars ?? [])]);
    const routerKey = entry.normalizedRouterKey;
    if (!routerKey) {
      errors.push(`Normalized registry entry "${entry.socketEvent}" missing normalizedRouterKey`);
      continue;
    }
    const matches = normalizedRegistrations.filter((reg) => reg.routerKey === routerKey);
    if (matches.length === 0) {
      errors.push(
        `Missing normalized registration "${routerKey}" — expected in ${entry.registrar}`,
      );
      continue;
    }
    const matchFiles = new Set(matches.map((reg) => reg.file));
    for (const matchFile of matchFiles) {
      if (!allowedFiles.has(matchFile)) {
        errors.push(
          `Orphan normalized registration "${routerKey}" in ${matchFile} — owner ${entry.owner} allows only ${[...allowedFiles].join(', ')}`,
        );
      }
    }
  }

  for (const reg of rawRegistrations) {
    if (!APPROVED_SOCKET_REGISTRAR_FILES.includes(reg.file as (typeof APPROVED_SOCKET_REGISTRAR_FILES)[number])) {
      const known = SOCKET_EVENT_REGISTRY.some(
        (entry) =>
          entry.socketEvent === reg.socketEvent &&
          (entry.registrationKind === 'raw' || entry.registrationKind === 'bus-ingress'),
      );
      if (known) {
        errors.push(
          `Raw registration "${reg.socketEvent}" in non-approved registrar ${reg.file}`,
        );
      }
    }
    const enforcedEntry = enforcedRaw.find((entry) => entry.socketEvent === reg.socketEvent);
    if (!enforcedEntry) {
      errors.push(`Unknown raw socket event registration "${reg.socketEvent}" in ${reg.file}`);
    }
  }

  for (const reg of normalizedRegistrations) {
    if (!APPROVED_SOCKET_REGISTRAR_FILES.includes(reg.file as (typeof APPROVED_SOCKET_REGISTRAR_FILES)[number])) {
      errors.push(
        `Normalized registration "${reg.routerKey}" in non-approved registrar ${reg.file}`,
      );
    }
    const known = enforcedNormalized.some((entry) => entry.normalizedRouterKey === reg.routerKey);
    if (!known) {
      errors.push(`Unknown normalized router key "${reg.routerKey}" in ${reg.file}`);
    }
  }

  if (busIngress.length === 0) {
    errors.push('Registry missing bus-ingress entry for state:update');
  }

  const grandfatherSet = new Set(
    GRANDFATHERED_DIRECT_SOCKET_ON.map((item) => `${item.file}::${item.socketEvent}`),
  );

  for (const direct of directSocketOn) {
    const key = `${direct.file}::${direct.socketEvent}`;
    if (grandfatherSet.has(key)) continue;
    if (direct.file === 'multiplayer/socketEventBus.ts') continue;
    errors.push(
      `Direct socket.on("${direct.socketEvent}") outside approved infrastructure at ${direct.file}:${direct.line}`,
    );
  }

  const registrySocketEvents = new Set(
    SOCKET_EVENT_REGISTRY.map((entry) => entry.socketEvent),
  );
  for (const item of GRANDFATHERED_DIRECT_SOCKET_ON) {
    if (!registrySocketEvents.has(item.socketEvent) && item.socketEvent !== 'connect' && item.socketEvent !== 'disconnect') {
      // Grandfathered events should still be documented in registry as direct entries - optional
    }
  }

  const enforcedTournament = getEnforcedTournamentRegistryEntries();
  const tournamentRegistrar = 'tournament/registerTournamentSocketHandlers.ts';
  for (const socketEvent of TOURNAMENT_SOCKET_EVENT_VALUES) {
    const entry = enforcedTournament.find((item) => item.socketEvent === socketEvent);
    if (!entry) {
      errors.push(`Missing enforced tournament registry entry for "${socketEvent}"`);
      continue;
    }
    if (entry.registrar !== tournamentRegistrar) {
      errors.push(
        `Tournament event "${socketEvent}" must register in ${tournamentRegistrar}, found owner ${entry.registrar}`,
      );
    }
    const matches = rawRegistrations.filter((reg) => reg.socketEvent === socketEvent);
    if (!matches.some((reg) => reg.file === tournamentRegistrar)) {
      errors.push(
        `Missing tournament raw registration for "${socketEvent}" in ${tournamentRegistrar}`,
      );
    }
  }

  const tournamentHubEvents = new Set(TOURNAMENT_SOCKET_EVENT_VALUES);
  for (const reg of rawRegistrations) {
    if (!tournamentHubEvents.has(reg.socketEvent as (typeof TOURNAMENT_SOCKET_EVENT_VALUES)[number])) {
      continue;
    }
    if (reg.file !== tournamentRegistrar) {
      errors.push(
        `Orphan tournament raw registration "${reg.socketEvent}" in ${reg.file} — must register only in ${tournamentRegistrar}`,
      );
    }
  }

  const enforcedMatchmaking = getEnforcedMatchmakingRegistryEntries();
  const matchmakingRegistrar = 'matchmaking/registerMatchmakingSocketHandlers.ts';
  for (const socketEvent of MATCHMAKING_SOCKET_EVENT_VALUES) {
    const entry = enforcedMatchmaking.find((item) => item.socketEvent === socketEvent);
    if (!entry) {
      errors.push(`Missing enforced matchmaking registry entry for "${socketEvent}"`);
      continue;
    }
    if (entry.registrar !== matchmakingRegistrar) {
      errors.push(
        `Matchmaking event "${socketEvent}" must register in ${matchmakingRegistrar}, found owner ${entry.registrar}`,
      );
    }
    const matches = rawRegistrations.filter((reg) => reg.socketEvent === socketEvent);
    if (!matches.some((reg) => reg.file === matchmakingRegistrar)) {
      errors.push(
        `Missing matchmaking raw registration for "${socketEvent}" in ${matchmakingRegistrar}`,
      );
    }
  }

  const matchmakingHubEvents = new Set(MATCHMAKING_SOCKET_EVENT_VALUES);
  for (const reg of rawRegistrations) {
    if (!matchmakingHubEvents.has(reg.socketEvent as (typeof MATCHMAKING_SOCKET_EVENT_VALUES)[number])) {
      continue;
    }
    if (reg.file !== matchmakingRegistrar) {
      errors.push(
        `Orphan matchmaking raw registration "${reg.socketEvent}" in ${reg.file} — must register only in ${matchmakingRegistrar}`,
      );
    }
  }

  const friendsRegistrar = 'friends/registerFriendsSocketHandlers.ts';
  const friendsConnectRegs = rawRegistrations.filter(
    (reg) => reg.socketEvent === SOCKET_EVENTS.CONNECT && reg.file === friendsRegistrar,
  );
  if (friendsConnectRegs.length === 0) {
    errors.push(`Missing friends connect registration in ${friendsRegistrar}`);
  }

  if (GRANDFATHERED_DIRECT_SOCKET_ON.length > 0) {
    errors.push(
      `Grandfather list must be empty (Phase S zero-tolerance) — found ${GRANDFATHERED_DIRECT_SOCKET_ON.length} entries`,
    );
  }

  if (errors.length > 0) {
    console.error('Socket event registry validation failed:\n');
    for (const error of errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exit(1);
  }

  console.log('Socket event registry validation passed.');
  console.log(`  Enforced raw events: ${enforcedRaw.length}`);
  console.log(`  Enforced normalized routes: ${enforcedNormalized.length}`);
  console.log(`  Enforced tournament events: ${enforcedTournament.length}`);
  console.log(`  Enforced matchmaking events: ${enforcedMatchmaking.length}`);
  console.log(`  Grandfathered direct socket.on sites: ${GRANDFATHERED_DIRECT_SOCKET_ON.length}`);
}

main();