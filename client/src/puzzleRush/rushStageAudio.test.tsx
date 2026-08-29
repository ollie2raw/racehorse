// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Puzzle Rush was the one mode that never received the mute preference:
 * `PuzzleRushScreen({ muted = false })` and no call site passing it, so the
 * stage sound played through a mute set anywhere else in the app.
 */

const playMatchFoundSound = vi.fn();
vi.mock('../utils/sound', () => ({ playMatchFoundSound: (m: boolean) => playMatchFoundSound(m) }));

const { mutePreference } = await import('../utils/mutePreference');
const { RushStageTransition } = await import('./RushStageTransition');

describe('RushStageTransition', () => {
  beforeEach(() => {
    playMatchFoundSound.mockReset();
    mutePreference.set(false);
  });

  it('plays the stage sound when audio is on', () => {
    render(<RushStageTransition stage={{ key: 'stage-1' } as never} onDone={() => {}} />);
    expect(playMatchFoundSound).toHaveBeenCalledWith(false);
  });

  it('honors a mute set anywhere in the app, with no prop threaded to it', () => {
    mutePreference.set(true);
    render(<RushStageTransition stage={{ key: 'stage-1' } as never} onDone={() => {}} />);
    expect(playMatchFoundSound).toHaveBeenCalledWith(true);
  });
});
