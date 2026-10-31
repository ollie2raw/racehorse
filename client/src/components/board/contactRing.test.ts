// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTACT_RING_GROWTH, CONTACT_RING_MS, spawnContactRing } from './contactRing';

describe('spawnContactRing', () => {
  let finish: (() => void) | null = null;
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    finish = null;
    animate = vi.fn(() => {
      const animation = {
        onfinish: null as null | (() => void),
        oncancel: null as null | (() => void),
      };
      finish = () => animation.onfinish?.();
      return animation;
    });
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  });
  afterEach(() => {
    document.body.innerHTML = '';
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  it('draws a ring over the tile\'s footprint, at the tile\'s rotation', () => {
    spawnContactRing({ cx: 200, cy: 100, width: 60, height: 120 }, 90);
    const ring = document.querySelector<HTMLElement>('.tile-contact-ring');
    expect(ring).not.toBeNull();
    expect(ring!.style.left).toBe('170px');
    expect(ring!.style.top).toBe('40px');
    expect(ring!.style.width).toBe('60px');
    expect(ring!.style.height).toBe('120px');
    expect(ring!.style.transform).toBe('rotate(90deg)');
    expect(ring!.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves the footprint and fades over a short, fixed time', () => {
    spawnContactRing({ cx: 0, cy: 0, width: 10, height: 20 }, 0);
    const [keyframes, options] = animate.mock.calls[0] as [Array<{ opacity: number; scale: string }>, { duration: number }];
    expect(options.duration).toBe(CONTACT_RING_MS);
    expect(keyframes[0].scale).toBe('1');
    expect(keyframes[1].scale).toBe(String(CONTACT_RING_GROWTH));
    expect(keyframes[1].opacity).toBe(0);
  });

  it('removes itself when it has faded', () => {
    spawnContactRing({ cx: 0, cy: 0, width: 10, height: 20 }, 0);
    expect(document.querySelectorAll('.tile-contact-ring')).toHaveLength(1);
    finish?.();
    expect(document.querySelectorAll('.tile-contact-ring')).toHaveLength(0);
  });

  it('draws nothing without the Web Animations API, or for an empty footprint', () => {
    spawnContactRing({ cx: 0, cy: 0, width: 0, height: 20 }, 0);
    expect(document.querySelectorAll('.tile-contact-ring')).toHaveLength(0);

    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    spawnContactRing({ cx: 0, cy: 0, width: 10, height: 20 }, 0);
    expect(document.querySelectorAll('.tile-contact-ring')).toHaveLength(0);
  });
});
