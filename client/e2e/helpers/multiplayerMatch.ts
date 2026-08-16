import { expect, type BrowserContext, type Page } from '@playwright/test';

const TRANSPORT_LOSS_DETECT_MS = 70_000;

const LAST_ROOM_STORAGE_KEY = 'racehorse_last_room_code';
const GUEST_ID_STORAGE_KEY = 'racehorse_guest_identity_v1';
const GUEST_NAME_STORAGE_KEY = 'racehorse_guest_display_name_v1';

export const MULTIPLAYER_SHELL_LOCATOR =
  '.mm-page.multiplayer-hub, .mm-page.mm-mp-bridge, .pml-root.pml-mp-bridge';
export const GAME_SCREEN_LOCATOR = '.game-screen';
export const RECONNECTING_TEXT = /Reconnecting/i;
export const OPPONENT_DISCONNECTED_TEXT = /Opponent disconnected/i;

export type E2EPlayerIdentity = {
  guestId: string;
  username: string;
};

export const E2E_PLAYER_A: E2EPlayerIdentity = {
  guestId: 'e2e_mp_player_a_stable',
  username: 'E2E_PlayerA',
};

export const E2E_PLAYER_B: E2EPlayerIdentity = {
  guestId: 'e2e_mp_player_b_stable',
  username: 'E2E_PlayerB',
};

/** Unique guest IDs per test run — avoids stale server room sessions across serial E2E runs. */
export function makeRunIdentity(role: 'a' | 'b', runId: string): E2EPlayerIdentity {
  const suffix = runId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  // Must use guest_ prefix — getOrCreateGuestIdentityId() only preserves existing guest_* ids on reload.
  // Display name must match getOrCreateGuestDisplayName()'s `Guest NNNN` contract.
  const guestId = `guest_e2e_mp_${role}_${suffix}`;
  let hash = 0;
  for (let index = 0; index < guestId.length; index += 1) {
    hash = (hash * 31 + guestId.charCodeAt(index)) >>> 0;
  }
  return {
    guestId,
    username: `Guest ${String(hash % 10000).padStart(4, '0')}`,
  };
}

export async function seedPlayerIdentity(context: BrowserContext, identity: E2EPlayerIdentity) {
  // Seed guest id + display name. Do NOT clear last room code here; addInitScript runs on every
  // navigation including mid-test reload, and refresh-recovery depends on persistence.
  await context.addInitScript(
    ({ guestId, username, guestKey, nameKey }) => {
      window.localStorage.setItem(guestKey, guestId);
      window.localStorage.setItem(nameKey, username);
    },
    {
      guestId: identity.guestId,
      username: identity.username,
      guestKey: GUEST_ID_STORAGE_KEY,
      nameKey: GUEST_NAME_STORAGE_KEY,
    },
  );
}

export async function gotoHome(page: Page) {
  await page.goto('/');
  await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 20_000 });
}

export async function waitForMultiplayerSocketConnected(page: Page) {
  await expect
    .poll(async () => {
      const status = await page.locator('.mp-topbar__status-text').first().textContent().catch(() => '');
      return /\d+\s+online/i.test(status ?? '');
    })
    .toBeTruthy();
}

export async function openPrivateMultiplayerHub(page: Page) {
  await gotoHome(page);
  await page.getByText('Multiplayer', { exact: false }).first().click();
  await expect(page.locator(MULTIPLAYER_SHELL_LOCATOR).first()).toBeVisible({ timeout: 20_000 });
  await waitForMultiplayerSocketConnected(page);
  const privateTab = page.getByRole('tab', { name: /Private/i });
  if (await privateTab.isVisible().catch(() => false)) {
    await privateTab.click();
  } else {
    await page.getByRole('button', { name: /^Private$/i }).click();
  }
  await expect
    .poll(async () => {
      const crashed = await page.getByText(/Maximum update depth exceeded/i).isVisible().catch(() => false);
      if (crashed) {
        await page.getByRole('button', { name: /Try again/i }).click().catch(() => {});
        await page.goto('/');
        await page.getByText('Multiplayer', { exact: false }).first().click();
        await waitForMultiplayerSocketConnected(page);
        await privateTab.click().catch(() => page.getByRole('button', { name: /^Private$/i }).click());
      }
      const inLobby = await page.locator('.pml-root, .pml-mp-bridge').first().isVisible().catch(() => false);
      const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
      return inLobby || inMatch;
    })
    .toBeTruthy();
  const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
  const inRoom = await page.locator('.pml-roomcode-bar-code').isVisible().catch(() => false);
  if (!inMatch && !inRoom) {
    await expect(page.getByRole('tab', { name: /Create lobby/i })).toBeVisible({ timeout: 20_000 });
  }
}

export async function createPrivateLobbyAsHost(page: Page): Promise<string> {
  await openPrivateMultiplayerHub(page);
  await page.getByRole('tab', { name: /Create lobby/i }).click();
  await page.locator('.pml-panel-footer').getByRole('button', { name: /^Create lobby/i }).click();
  const roomCodeLocator = page.locator('.pml-roomcode-bar-code');
  await expect(roomCodeLocator).toBeVisible({ timeout: 20_000 });
  const roomCode = (await roomCodeLocator.innerText()).trim().toUpperCase();
  expect(roomCode).toMatch(/^[A-Z0-9]{4,6}$/);
  return roomCode;
}

export async function joinPrivateLobby(page: Page, roomCode: string) {
  await openPrivateMultiplayerHub(page);
  const alreadyInMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
  if (alreadyInMatch) {
    expect(await readLastRoomCode(page)).toBe(roomCode);
    return;
  }
  const roomCodeOnScreen = page.locator('.pml-roomcode-bar-code');
  if (await roomCodeOnScreen.isVisible().catch(() => false)) {
    await expect(roomCodeOnScreen).toHaveText(roomCode, { timeout: 10_000 });
    return;
  }
  await page.getByRole('tab', { name: /Join lobby/i }).click();
  await page.getByPlaceholder('ROOM CODE').fill(roomCode);
  await page.locator('.claude-mode-join-box').getByRole('button', { name: /^Join$/i }).click();
  await expect
    .poll(
      async () => {
        const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
        const roomBar = page.locator('.pml-roomcode-bar-code');
        const inRoom = await roomBar.isVisible().catch(() => false);
        if (inMatch) return true;
        if (inRoom) {
          const text = (await roomBar.innerText()).trim().toUpperCase();
          return text === roomCode;
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();
}

export async function assertNoReactCrash(page: Page, label: string) {
  const crashed = await page
    .getByText(/Maximum update depth exceeded|Something went wrong/i)
    .isVisible()
    .catch(() => false);
  if (crashed) {
    const detail = await page
      .getByText(/Maximum update depth exceeded/i)
      .textContent()
      .catch(() => 'React error boundary');
    throw new Error(`${label}: ${detail ?? 'UI crashed'}`);
  }
}

export async function waitForLobbyReadyOrMatch(hostPage: Page) {
  await expect
    .poll(
      async () => {
        await assertNoReactCrash(hostPage, 'Host lobby');
        const inMatch = await hostPage.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
        const canStart = await hostPage
          .getByRole('button', { name: /Start Match/i })
          .isVisible()
          .catch(() => false);
        return inMatch || canStart;
      },
      { timeout: 60_000 },
    )
    .toBeTruthy();
}

export async function startPrivateMatchFromLobby(hostPage: Page, guestPage?: Page) {
  if (guestPage) {
    await waitForLobbyReadyOrMatch(hostPage);
  }
  const alreadyInMatch = await hostPage.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
  if (!alreadyInMatch) {
    const startButton = hostPage.getByRole('button', { name: /Start Match/i });
    await expect(startButton).toBeEnabled({ timeout: 30_000 });
    await startButton.click();
  }
  await Promise.all([
    waitForActiveMatch(hostPage),
    guestPage ? waitForActiveMatch(guestPage) : Promise.resolve(),
  ]);
}

const LIVE_HAND_TILE_LOCATOR =
  '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .hand-area:not(.pre-game-draw-hand-dock) .domino-body, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-body';

export async function completePreGameDrawUntilHandVisible(page: Page) {
  await expect
    .poll(
      async () => {
        const handVisible = await page
          .locator(LIVE_HAND_TILE_LOCATOR)
          .first()
          .isVisible()
          .catch(() => false);
        if (handVisible) return true;

        const pickable = page.locator('.pre-game-draw-board__tile-slot.is-pickable').first();
        if (await pickable.isVisible().catch(() => false)) {
          await pickable.click();
        }
        return false;
      },
      { timeout: 60_000 },
    )
    .toBeTruthy();
}

export async function waitForActiveMatch(page: Page) {
  await expect(page.locator(GAME_SCREEN_LOCATOR)).toBeVisible({ timeout: 45_000 });
  await completePreGameDrawUntilHandVisible(page);
  await expect(page.locator('.wl-turn-label, .rh-turn-label').first()).toBeVisible({ timeout: 20_000 });
}

export async function readLastRoomCode(page: Page): Promise<string> {
  return page.evaluate((roomKey) => {
    const raw = window.localStorage.getItem(roomKey);
    return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  }, LAST_ROOM_STORAGE_KEY);
}

/**
 * Read numeric scores from the live HUD pills.
 * Prefer `.wl-player-score` over full pill text — display names can resolve/change
 * after reconnect without any score mutation.
 */
export async function readHudScorePair(page: Page): Promise<{ you: string; opponent: string }> {
  const pills = page.locator('.wl-player-pill, .rh-player-pill');
  await expect(pills.first()).toBeVisible({ timeout: 10_000 });
  const count = await pills.count();

  const readScore = async (pillIndex: number): Promise<string> => {
    const score = pills.nth(pillIndex).locator('.wl-player-score, .rh-player-score');
    if ((await score.count()) > 0) {
      return ((await score.first().innerText()) ?? '').trim();
    }
    const raw = ((await pills.nth(pillIndex).innerText()) ?? '').trim();
    const parts = raw.split(/\s+/);
    return parts[parts.length - 1] ?? raw;
  };

  if (count < 2) {
    return { you: await readScore(0), opponent: '' };
  }
  return {
    you: await readScore(0),
    opponent: await readScore(1),
  };
}

const LIVE_HAND_TILE_CLICKABLE =
  '.hand-area:not(.pre-game-draw-hand-dock) .domino-tile, .wl-hand-area:not(.pre-game-draw-hand-dock) .domino-tile';

/** Attempt one legal play on the active seat when it is their turn. */
export async function tryPlayOneHandTileIfMyTurn(page: Page): Promise<boolean> {
  const yourMove = page.locator('.wl-turn-label.your-turn, .rh-turn-label.your-turn');
  if (!(await yourMove.first().isVisible().catch(() => false))) {
    return false;
  }
  const tile = page.locator(LIVE_HAND_TILE_CLICKABLE).first();
  if (!(await tile.isVisible().catch(() => false))) {
    return false;
  }
  const sequenceBefore = await page
    .locator('.wl-player-score, .rh-player-score')
    .first()
    .innerText()
    .catch(() => '');
  await tile.click();
  // End target may appear for placement; click first legal end if present.
  const endTarget = page.locator('.end-target, .board-end-target, [data-end-target]').first();
  if (await endTarget.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await endTarget.click();
  }
  await page.waitForTimeout(500);
  void sequenceBefore;
  return true;
}

export async function expectRecoveryReconnecting(page: Page) {
  await expect(page.getByText(RECONNECTING_TEXT)).toBeVisible({ timeout: 20_000 });
}

export async function expectRecoveryCleared(page: Page) {
  await expect(page.getByText(RECONNECTING_TEXT)).toHaveCount(0, { timeout: 45_000 });
}

type E2eSocketWindow = Window & {
  __racehorseE2eSocket?: {
    io?: { engine?: { close?: () => void }; opts?: { reconnection?: boolean } };
  };
};

/**
 * Simulate mid-match transport loss without voluntary socket.disconnect()
 * (namespace disconnect clears joinedRoom and skips in-match recovery UI).
 *
 * Blocks only Socket.IO traffic — not full browser offline — so HTTP/Vite stay up
 * and the recovery machine can reconnect when routes are restored.
 */
export async function forceSocketTransportDown(page: Page, _context: BrowserContext) {
  await page.route(/\/socket\.io\//, (route) => route.abort('failed'));
  await page.evaluate(() => {
    const sock = (window as E2eSocketWindow).__racehorseE2eSocket;
    try {
      const transport = sock?.io?.engine as { close?: () => void; transport?: { close?: () => void } } | undefined;
      transport?.transport?.close?.();
      transport?.close?.();
    } catch {
      /* best-effort transport tear-down */
    }
  });
}

export async function restoreSocketTransport(page: Page, _context: BrowserContext) {
  await page.unroute(/\/socket\.io\//);
  await page.evaluate(() => {
    const sock = (window as E2eSocketWindow).__racehorseE2eSocket;
    if (sock && !sock.connected) {
      sock.connect();
    }
  });
}

export async function readE2eSocketConnected(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const sock = (window as E2eSocketWindow).__racehorseE2eSocket;
    if (!sock) return null;
    return sock.connected === true;
  });
}

/** Host enters recovery overlay/toast, stays on board, or shows lobby recovery copy. */
export async function waitForHostRecoveryUi(page: Page) {
  await expect
    .poll(
      async () => {
        const recoveryCopy = await page
          .getByText(/Reconnecting|Connection lost|Rejoining room|Restoring your room/i)
          .isVisible()
          .catch(() => false);
        const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
        const socketDown = (await readE2eSocketConnected(page)) === false;
        return recoveryCopy || inMatch || socketDown;
      },
      { timeout: TRANSPORT_LOSS_DETECT_MS },
    )
    .toBeTruthy();
}

/** Guest must stay in match; opponent-disconnect banner is preferred when grace fires in time. */
export async function waitForGuestDisconnectSignal(guestPage: Page) {
  await expect
    .poll(
      async () => {
        const banner = await guestPage
          .getByText(OPPONENT_DISCONNECTED_TEXT)
          .isVisible()
          .catch(() => false);
        const inMatch = await guestPage.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
        return banner || inMatch;
      },
      { timeout: TRANSPORT_LOSS_DETECT_MS },
    )
    .toBeTruthy();
  await expect(guestPage.locator(GAME_SCREEN_LOCATOR)).toBeVisible();
}

export async function waitForHostBackInMatch(page: Page) {
  await expect(page.locator(GAME_SCREEN_LOCATOR)).toBeVisible({ timeout: 90_000 });
  await completePreGameDrawUntilHandVisible(page);
  await expect
    .poll(async () => (await readE2eSocketConnected(page)) !== false, { timeout: 45_000 })
    .toBeTruthy();
  await expect(page.getByText(/Reconnecting|Connection lost/i)).toHaveCount(0, { timeout: 45_000 });
}

/** After full page reload, re-enter multiplayer and wait for saved-room auto-rejoin (guest userId path). */
export async function resumeMultiplayerAfterReload(page: Page, expectedRoomCode: string) {
  await expect(page.getByText('RACEHORSE', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(async () => (await readLastRoomCode(page)) === expectedRoomCode, { timeout: 10_000 })
    .toBeTruthy();

  const routedDirectlyToMultiplayer = new URL(page.url()).pathname.startsWith('/multiplayer');
  const restoredMatchIsVisible = await expect
    .poll(() => page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false), { timeout: 30_000 })
    .toBeTruthy()
    .then(() => true)
    .catch(() => false);
  if (!routedDirectlyToMultiplayer && !restoredMatchIsVisible) {
    await page
      .getByText('Multiplayer', { exact: false })
      .first()
      .click({ timeout: 10_000 })
      .catch(async (error: unknown) => {
        const matchAppearedDuringClick = await page
          .locator(GAME_SCREEN_LOCATOR)
          .isVisible()
          .catch(() => false);
        if (!matchAppearedDuringClick) throw error;
      });
  }
  await expect
    .poll(
      async () => {
        const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
        const inHub = await page.locator(MULTIPLAYER_SHELL_LOCATOR).first().isVisible().catch(() => false);
        return inMatch || inHub;
      },
      { timeout: 30_000 },
    )
    .toBeTruthy();

  const alreadyInMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
  if (!alreadyInMatch) {
    await waitForMultiplayerSocketConnected(page);
    await expect
      .poll(
        async () => {
          const inMatch = await page.locator(GAME_SCREEN_LOCATOR).isVisible().catch(() => false);
          const rejoinedToast = await page
            .getByText(/Rejoined room|Reconnected to room/i)
            .isVisible()
            .catch(() => false);
          const recoveryCopy = await page
            .getByText(/Rejoining room|Connection lost|Reconnecting/i)
            .isVisible()
            .catch(() => false);
          return inMatch || rejoinedToast || recoveryCopy;
        },
        { timeout: 90_000 },
      )
      .toBeTruthy();
  }
}

export async function waitForGameServerReady(baseUrl = 'http://127.0.0.1:3001') {
  const deadline = Date.now() + 60_000;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/ping`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Game server not ready at ${baseUrl}: ${lastError}`);
}

type E2eServerStateSnapshot = {
  at: number;
  sequence: number | null;
  scores: Record<string, number> | null;
  boardLen: number | null;
  currentPlayerIndex: number | null;
};

export async function attachServerStateProbe(page: Page) {
  await page.evaluate(() => {
    const win = window as E2eSocketWindow & {
      __e2eServerStateLog?: E2eServerStateSnapshot[];
    };
    win.__e2eServerStateLog = [];
    const sock = win.__racehorseE2eSocket as
      | (NonNullable<E2eSocketWindow['__racehorseE2eSocket']> & {
          on?: (event: string, handler: (payload: unknown) => void) => void;
        })
      | undefined;
    sock?.on?.('state:update', (payload: unknown) => {
      const record = payload as { state?: Record<string, unknown> };
      const state = record?.state ?? (payload as Record<string, unknown>);
      const players = state?.players as Record<string, { score?: number }> | undefined;
      const scores = players
        ? Object.fromEntries(
            Object.entries(players).map(([id, player]) => [id, Number(player?.score ?? 0)]),
          )
        : null;
      win.__e2eServerStateLog?.push({
        at: Date.now(),
        sequence: typeof state?.sequence === 'number' ? state.sequence : null,
        scores,
        boardLen: Array.isArray(state?.board) ? state.board.length : null,
        currentPlayerIndex:
          typeof state?.currentPlayerIndex === 'number' ? state.currentPlayerIndex : null,
      });
    });
  });
}

export async function readLastServerStateSnapshot(page: Page): Promise<E2eServerStateSnapshot | null> {
  return page.evaluate(() => {
    const log = (window as { __e2eServerStateLog?: E2eServerStateSnapshot[] }).__e2eServerStateLog;
    return log && log.length > 0 ? log[log.length - 1]! : null;
  });
}

export async function wipeNonIdentityLocalStorage(page: Page) {
  await page.evaluate((keys) => {
    const keep = new Set(keys);
    const toRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && !keep.has(key)) toRemove.push(key);
    }
    toRemove.forEach((key) => window.localStorage.removeItem(key));
  }, [GUEST_ID_STORAGE_KEY, GUEST_NAME_STORAGE_KEY, LAST_ROOM_STORAGE_KEY]);
}

export async function installStaleMoveProbe(page: Page, roomCode: string) {
  await page.evaluate((code) => {
    const win = window as E2eSocketWindow & { __e2eStaleMoveAck?: unknown };
    const sock = win.__racehorseE2eSocket as
      | (NonNullable<E2eSocketWindow['__racehorseE2eSocket']> & {
          on?: (event: string, handler: () => void) => void;
          emit?: (...args: unknown[]) => void;
          connected?: boolean;
        })
      | undefined;
    if (!sock?.on || !sock.emit) return;
    const emitStaleMove = () => {
      sock.emit?.(
        'game:action',
        code,
        {
          type: 'MOVE',
          requestId: `e2e-stale-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          move: { tile: { low: 0, high: 0 }, position: 'left' },
        },
        (ack: unknown) => {
          win.__e2eStaleMoveAck = ack;
        },
      );
    };
    sock.on('room:session:superseded', emitStaleMove);
  }, roomCode);
}

export async function readStaleMoveAck(page: Page): Promise<{ ok?: boolean; error?: string } | null> {
  return page.evaluate(() => {
    const ack = (window as { __e2eStaleMoveAck?: { ok?: boolean; error?: string } }).__e2eStaleMoveAck;
    return ack ?? null;
  });
}

export async function emitStaleMoveNow(page: Page, roomCode: string) {
  await page.evaluate((code) => {
    const win = window as E2eSocketWindow & { __e2eStaleMoveAck?: unknown };
    const sock = win.__racehorseE2eSocket as
      | (NonNullable<E2eSocketWindow['__racehorseE2eSocket']> & {
          emit?: (...args: unknown[]) => void;
        })
      | undefined;
    sock?.emit?.(
      'game:action',
      code,
      {
        type: 'MOVE',
        requestId: `e2e-stale-late-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        move: { tile: { low: 0, high: 0 }, position: 'left' },
      },
      (ack: unknown) => {
        win.__e2eStaleMoveAck = ack;
      },
    );
  }, roomCode);
}

export async function fetchDisconnectGraceSeats(roomCode: string): Promise<string[]> {
  const response = await fetch(`http://127.0.0.1:3001/api/e2e/disconnect-grace/${roomCode}`);
  if (!response.ok) {
    throw new Error(`disconnect-grace inspect failed: ${response.status}`);
  }
  const body = (await response.json()) as { seats?: string[] };
  return Array.isArray(body.seats) ? body.seats : [];
}
