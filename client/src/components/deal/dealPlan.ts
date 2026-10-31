// client/src/components/deal/dealPlan.ts
//
// The choreography of a deal, as pure numbers: which card goes where, when, and how it travels. useHandDeal.ts
// does the DOM work; nothing here touches the document, so the timing is unit-tested.
//
// A real deal alternates: one to you, one to Fritz, and so on, each card leaving the pile a beat after the last.

export interface DealRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type DealOwner = 'you' | 'fritz';

export interface DealTarget {
  owner: DealOwner;
  rect: DealRect;
}

export interface DealStep extends DealTarget {
  /** Position in the deal order (0 = first card out of the pile). */
  order: number;
  /** When this card leaves the pile, from the start of the deal. */
  delayMs: number;
  /** How long it travels. */
  flightMs: number;
  /** How long your card takes to turn face up (zero for Fritz's: his stay face down). */
  flipMs: number;
  /** Tilt it leaves the pile with; it straightens as it travels. */
  fromRotateDeg: number;
  /** How big it is as it leaves the pile, as a fraction of its final size. */
  fromScale: number;
}

export interface DealPlan<T extends DealTarget = DealTarget> {
  steps: Array<DealStep & T>;
  /** From the start of the deal to the last card being face up. */
  totalMs: number;
}

/** A card leaves the pile this often. */
export const DEAL_STAGGER_MS = 42;
/** Time in the air. */
export const DEAL_FLIGHT_MS = 340;
/** Your cards turn face up over this. Fritz's stay face down. */
export const DEAL_FLIP_MS = 170;
/** The pile's cards are a little smaller than the ones in hand. */
export const DEAL_FROM_SCALE = 0.55;
/** The most a card is tilted as it leaves the pile. */
export const DEAL_MAX_TILT_DEG = 14;

/** The order cards leave the pile: yours and Fritz's alternating, the longer hand finishing alone. */
export function dealOrder<T extends DealTarget>(targets: T[]): T[] {
  const yours = targets.filter((target) => target.owner === 'you');
  const his = targets.filter((target) => target.owner === 'fritz');
  const ordered: T[] = [];
  for (let i = 0; i < Math.max(yours.length, his.length); i += 1) {
    if (yours[i]) ordered.push(yours[i]);
    if (his[i]) ordered.push(his[i]);
  }
  return ordered;
}

/** A tilt that looks random but is the same every time: a deal that replays differently each hand would be noise. */
export function tiltFor(order: number): number {
  const spread = DEAL_MAX_TILT_DEG * 2 + 1;
  return ((order * 37 + 11) % spread) - DEAL_MAX_TILT_DEG;
}

/**
 * `pace` scales every duration: 1 is the standard deal, below 1 is quicker (Fast Fritz). Whatever else a target
 * carries (the element it is for) comes through on its step.
 */
export function planDeal<T extends DealTarget>(targets: T[], pace = 1): DealPlan<T> {
  const scale = pace > 0 ? pace : 1;
  const steps = dealOrder(targets).map((target, order) => ({
    ...target,
    order,
    delayMs: Math.round(order * DEAL_STAGGER_MS * scale),
    flightMs: Math.round(DEAL_FLIGHT_MS * scale),
    flipMs: target.owner === 'you' ? Math.round(DEAL_FLIP_MS * scale) : 0,
    fromRotateDeg: tiltFor(order),
    fromScale: DEAL_FROM_SCALE,
  }));
  const totalMs = steps.reduce((latest, step) => Math.max(latest, step.delayMs + step.flightMs + step.flipMs), 0);
  return { steps, totalMs };
}
