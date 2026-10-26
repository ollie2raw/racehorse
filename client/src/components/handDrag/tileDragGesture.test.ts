import { describe, expect, it } from 'vitest';
import { DRAG_START_PX, ZONE_SLOP_PX, dragIntent, pickDropZone, type DropZoneRect } from './tileDragGesture.ts';

describe('dragIntent', () => {
  it('is a tap until the pointer moves far enough', () => {
    expect(dragIntent(0, 0, 'touch')).toBe('pending');
    expect(dragIntent(DRAG_START_PX - 1, 0, 'mouse')).toBe('pending');
    expect(dragIntent(3, 5, 'mouse')).toBe('pending');
  });

  it('starts a drag once the pointer has moved far enough', () => {
    expect(dragIntent(0, -DRAG_START_PX, 'touch')).toBe('drag');
    expect(dragIntent(0, DRAG_START_PX, 'mouse')).toBe('drag');
  });

  it('a mouse drag may start in any direction', () => {
    expect(dragIntent(40, 0, 'mouse')).toBe('drag');
    expect(dragIntent(-40, 2, 'pen')).toBe('drag');
  });

  it('a touch that starts sideways is the rack scrolling, not a drag', () => {
    expect(dragIntent(30, 4, 'touch')).toBe('abandon');
    expect(dragIntent(-30, -4, 'touch')).toBe('abandon');
  });

  it('a touch that starts vertically, up or down, is a drag', () => {
    expect(dragIntent(4, -30, 'touch')).toBe('drag');
    expect(dragIntent(4, 30, 'touch')).toBe('drag');
  });
});

const zone = (position: string, left: number, top: number, right: number, bottom: number): DropZoneRect => ({
  position: position as DropZoneRect['position'],
  left,
  top,
  right,
  bottom,
});

describe('pickDropZone', () => {
  const left = zone('left', 100, 100, 160, 130);
  const right = zone('right', 300, 100, 360, 130);

  it('returns the zone the pointer is inside', () => {
    expect(pickDropZone([left, right], 130, 115)).toBe('left');
    expect(pickDropZone([left, right], 330, 115)).toBe('right');
  });

  it('forgives a release a little outside the zone (a thumb is not a pixel)', () => {
    expect(pickDropZone([left], 160 + ZONE_SLOP_PX - 1, 115)).toBe('left');
    expect(pickDropZone([left], 130, 130 + ZONE_SLOP_PX - 1)).toBe('left');
  });

  it('returns null when the pointer is farther than the slop from every zone', () => {
    expect(pickDropZone([left, right], 220, 115)).toBeNull();
    expect(pickDropZone([left], 160 + ZONE_SLOP_PX + 5, 115)).toBeNull();
    expect(pickDropZone([], 10, 10)).toBeNull();
  });

  it('prefers the nearer zone when the pointer is between two within the slop', () => {
    const a = zone('a', 100, 100, 160, 130);
    const b = zone('b', 170, 100, 230, 130);
    expect(pickDropZone([a, b], 162, 115)).toBe('a'); // 2 px from a, 8 px from b
    expect(pickDropZone([a, b], 168, 115)).toBe('b'); // 8 px from a, 2 px from b
  });

  it('breaks a tie between overlapping zones by the nearest centre', () => {
    const wide = zone('wide', 100, 100, 300, 130);
    const small = zone('small', 190, 100, 230, 130);
    expect(pickDropZone([wide, small], 210, 115)).toBe('small');
  });

  it('honours a custom slop', () => {
    expect(pickDropZone([left], 175, 115, 10)).toBeNull();
    expect(pickDropZone([left], 165, 115, 10)).toBe('left');
  });
});
