import { describe, expect, it } from 'vitest';
import {
  DEAL_FLIGHT_MS,
  DEAL_FLIP_MS,
  DEAL_MAX_TILT_DEG,
  DEAL_STAGGER_MS,
  dealOrder,
  planDeal,
  tiltFor,
  type DealTarget,
} from './dealPlan';

const rect = { left: 0, top: 0, width: 40, height: 80 };
const hand = (count: number, owner: DealTarget['owner']): DealTarget[] =>
  Array.from({ length: count }, (_, i) => ({ owner, rect: { ...rect, left: i * 50 } }));

describe('dealOrder', () => {
  it('alternates you and Fritz, starting with you', () => {
    const order = dealOrder([...hand(3, 'you'), ...hand(3, 'fritz')]);
    expect(order.map((t) => t.owner)).toEqual(['you', 'fritz', 'you', 'fritz', 'you', 'fritz']);
  });

  it('keeps each hand in its own left-to-right order', () => {
    const order = dealOrder([...hand(3, 'you'), ...hand(3, 'fritz')]);
    expect(order.filter((t) => t.owner === 'you').map((t) => t.rect.left)).toEqual([0, 50, 100]);
  });

  it('lets the longer hand finish alone (a hand with extra tiles)', () => {
    const order = dealOrder([...hand(4, 'you'), ...hand(2, 'fritz')]);
    expect(order.map((t) => t.owner)).toEqual(['you', 'fritz', 'you', 'fritz', 'you', 'you']);
  });

  it('is empty for nothing to deal', () => {
    expect(dealOrder([])).toEqual([]);
  });
});

describe('planDeal', () => {
  const plan = planDeal([...hand(7, 'you'), ...hand(7, 'fritz')]);

  it('sends a card out every stagger, in order', () => {
    expect(plan.steps).toHaveLength(14);
    plan.steps.forEach((step, i) => expect(step.delayMs).toBe(i * DEAL_STAGGER_MS));
  });

  it('turns only your cards face up', () => {
    for (const step of plan.steps) expect(step.flipMs).toBe(step.owner === 'you' ? DEAL_FLIP_MS : 0);
  });

  it('ends when the last card is face up, so a whole 7+7 deal stays under a second and a half', () => {
    // The latest card to finish is one of YOURS (it turns over; Fritz's stay face down), not necessarily the last out.
    const latest = Math.max(...plan.steps.map((step) => step.delayMs + step.flightMs + step.flipMs));
    expect(plan.totalMs).toBe(latest);
    expect(plan.totalMs).toBeLessThan(1500);
  });

  it('scales every duration with pace, so Fast Fritz deals quicker', () => {
    const fast = planDeal([...hand(7, 'you'), ...hand(7, 'fritz')], 0.5);
    expect(fast.totalMs).toBeLessThan(plan.totalMs * 0.6);
    expect(fast.steps[1].delayMs).toBe(Math.round(DEAL_STAGGER_MS * 0.5));
    expect(fast.steps[0].flightMs).toBe(Math.round(DEAL_FLIGHT_MS * 0.5));
  });

  it('treats a nonsense pace as the standard one', () => {
    expect(planDeal(hand(2, 'you'), 0).totalMs).toBe(planDeal(hand(2, 'you'), 1).totalMs);
    expect(planDeal(hand(2, 'you'), -3).totalMs).toBe(planDeal(hand(2, 'you'), 1).totalMs);
  });

  it('has a zero length for an empty deal', () => {
    expect(planDeal([]).totalMs).toBe(0);
  });
});

describe('tiltFor', () => {
  it('is the same every time and never more than the maximum', () => {
    for (let i = 0; i < 60; i += 1) {
      expect(tiltFor(i)).toBe(tiltFor(i));
      expect(Math.abs(tiltFor(i))).toBeLessThanOrEqual(DEAL_MAX_TILT_DEG);
    }
  });

  it('varies from card to card, so the pile does not look machine-stamped', () => {
    const tilts = new Set(Array.from({ length: 14 }, (_, i) => tiltFor(i)));
    expect(tilts.size).toBeGreaterThan(8);
  });
});
