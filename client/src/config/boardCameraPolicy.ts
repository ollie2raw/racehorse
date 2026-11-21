/**
 * Which camera policy the live board uses (experiment, default OFF).
 *
 *   'full'    (default) recentre and refit the whole board after every placement: the behaviour since the spring camera.
 *   'comfort' policy B: if the board's padded bounds are already comfortably inside the viewport (boardCameraComfort.ts), hold the camera; when
 *             they leave it, do the same full refit as 'full'. No headroom, no incremental panning: the geometry and the fit are shared.
 *
 * Selected, in order, by: localStorage `racehorse_board_camera_policy` = "comfort" | "full" (read when a board mounts: lets one build be compared
 * on a device with no redeploy; remove the key to drop the override), then the build variable VITE_BOARD_CAMERA_POLICY=comfort, else 'full'.
 * Rollback: remove the key / unset the variable. Anything other than the exact strings means 'full'.
 */
export type BoardCameraPolicy = 'full' | 'comfort';

export const BOARD_CAMERA_POLICY_STORAGE_KEY = 'racehorse_board_camera_policy';

export function parseBoardCameraPolicy(value: unknown): BoardCameraPolicy | null {
  return value === 'comfort' || value === 'full' ? value : null;
}

export function resolveBoardCameraPolicy(
  envValue: unknown = import.meta.env.VITE_BOARD_CAMERA_POLICY,
  readStorage: () => string | null = () => window.localStorage.getItem(BOARD_CAMERA_POLICY_STORAGE_KEY),
): BoardCameraPolicy {
  let stored: string | null = null;
  try {
    stored = readStorage();
  } catch {
    // storage blocked or absent (private window, SSR): no override
  }
  return parseBoardCameraPolicy(stored) ?? parseBoardCameraPolicy(envValue) ?? 'full';
}
