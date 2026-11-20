/**
 * Audit D3: the floor of five withholds a small group's own row, but `all` is published, so `all` minus the published rows of
 * one dimension returned the withheld part: its report count and, through `max`, an exact value of a single summary. The
 * aggregator now drops a dimension's rows for a metric whenever what they leave out of `all` is 1..4 summaries.
 */
import { describe, expect, it } from 'vitest';
import { MIN_GROUP_REPORTS, RUM_DIMENSIONS, RumAggregator, type RumBeacon, type RumPublishedHour } from './rumAggregator';

const beacon = (over: Partial<RumBeacon> = {}, m: RumBeacon['m'] = { inp: [1, 90, 90] }): RumBeacon => ({
  v: 1, app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g', m, ...over,
});
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 16, 10, 5);

function publishOne(feed: (agg: RumAggregator) => void): RumPublishedHour {
  let nowMs = T0;
  const agg = new RumAggregator(() => nowMs);
  feed(agg);
  nowMs += H;
  return agg.rollover()[0]!;
}

/** What `all` has that the published rows of one dimension do not account for, per metric: the part a reader can recover. */
function remainders(hour: RumPublishedHour): { dim: string; metric: string; remainder: number }[] {
  const out: { dim: string; metric: string; remainder: number }[] = [];
  for (const row of hour.rows.filter((r) => r.group === 'all')) {
    for (const dim of Object.keys(RUM_DIMENSIONS)) {
      const published = hour.rows
        .filter((r) => r.metric === row.metric && (r.group.startsWith(`${dim}:`) || r.group === `other:${dim}`))
        .reduce((sum, r) => sum + r.reports, 0);
      out.push({ dim, metric: row.metric, remainder: row.reports - published });
    }
  }
  return out;
}
const leaks = (hour: RumPublishedHour) => remainders(hour).filter((r) => r.remainder > 0 && r.remainder < MIN_GROUP_REPORTS);

describe('the floor of five cannot be undone by subtracting published rows', () => {
  it('the audit repro: 6 web + 1 iOS no longer reveals the iOS summary or its exact slowest tap', () => {
    const hour = publishOne((agg) => {
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'web' }, { inp: [1, 90, 120] }));
      agg.ingest(beacon({ plat: 'ios' }, { inp: [1, 90, 4321] }));
    });
    expect(hour.rows.find((r) => r.group === 'all' && r.metric === 'inp')).toBeDefined(); // `all` is still published
    expect(hour.rows.some((r) => r.group.endsWith(':plat') || r.group.startsWith('plat:'))).toBe(false); // the platform split is not
    expect(leaks(hour)).toEqual([]);
  });

  it('the per-metric variant: a group over the floor whose metric is not, leaves that metric\'s split out', () => {
    const hour = publishOne((agg) => {
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'web' }, { inp: [1, 90, 120] }));
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'ios' }, i < 2 ? { inp: [1, 90, 120], 'mp.hand_ready_ack': [1, 40, 5000] } : { inp: [1, 90, 120] }));
    });
    // inp: web 6 + ios 6 = all 12, nothing left over: both published. hand_ready_ack: only 2 ios reports, below the floor, so its
    // `all` row (2 < 5) is withheld and no plat row exists for it.
    expect(hour.rows.filter((r) => r.metric === 'inp' && r.group.startsWith('plat:')).length).toBe(2);
    expect(hour.rows.some((r) => r.metric === 'mp.hand_ready_ack')).toBe(false);
    expect(leaks(hour)).toEqual([]);
  });

  it('a metric present in 7 reports but in only 2 of the 7 web ones leaves nothing recoverable', () => {
    const hour = publishOne((agg) => {
      for (let i = 0; i < 7; i += 1) agg.ingest(beacon({ plat: 'web' }, i < 5 ? { inp: [1, 90, 100], 'nav.home_to_hub': [1, 50, 60] } : { inp: [1, 90, 100] }));
      for (let i = 0; i < 2; i += 1) agg.ingest(beacon({ plat: 'ios' }, { inp: [1, 90, 100], 'nav.home_to_hub': [1, 50, 9999] }));
    });
    expect(leaks(hour)).toEqual([]);
  });

  it('does not over-suppress: when every group is over the floor all dimension rows are still published', () => {
    const hour = publishOne((agg) => {
      for (let i = 0; i < 5; i += 1) agg.ingest(beacon({ plat: 'web' }));
      for (let i = 0; i < 5; i += 1) agg.ingest(beacon({ plat: 'ios' }));
    });
    expect(hour.rows.filter((r) => r.group === 'plat:web' || r.group === 'plat:ios').length).toBe(2);
    expect(leaks(hour)).toEqual([]);
  });

  it('a remainder of five or more is allowed (it is itself a floor-sized aggregate): the published split is kept', () => {
    const hour = publishOne((agg) => {
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'web' }, { inp: [1, 90, 100], 'nav.home_to_hub': [1, 50, 60] }));
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'ios' }, i < 3 ? { inp: [1, 90, 100], 'nav.home_to_hub': [1, 50, 70] } : { inp: [1, 90, 100] }));
      for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'android' }, i < 3 ? { inp: [1, 90, 100], 'nav.home_to_hub': [1, 50, 80] } : { inp: [1, 90, 100] }));
    });
    // nav.home_to_hub: web 6 (published), ios 3 + android 3 (each below the floor, so no row): `all` has 12, the web row 6, the
    // 6 left over are a floor-sized aggregate, so nothing is dropped.
    const nav = hour.rows.filter((r) => r.metric === 'nav.home_to_hub');
    expect(nav.find((r) => r.group === 'all')?.reports).toBe(12);
    expect(nav.find((r) => r.group === 'plat:web')?.reports).toBe(6);
    expect(leaks(hour)).toEqual([]);
  });

  it('property: over 300 random hours of random beacons no dimension and metric ever leaves a 1..4 remainder', () => {
    let seed = 20261119;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    const metrics = ['inp', 'nav.home_to_hub', 'mp.hand_ready_ack', 'match.first_playable.pvf'] as const;
    for (let hourIndex = 0; hourIndex < 300; hourIndex += 1) {
      const total = Math.floor(rand() * 40);
      const hour = publishOne((agg) => {
        for (let i = 0; i < total; i += 1) {
          const m: RumBeacon['m'] = {};
          for (const name of metrics) if (rand() < 0.6) m[name] = [1 + Math.floor(rand() * 3), 20 + Math.floor(rand() * 400), 400 + Math.floor(rand() * 4000)];
          if (Object.keys(m).length === 0) m.inp = [1, 90, 90];
          agg.ingest(beacon({ plat: pick(RUM_DIMENSIONS.plat), form: pick(RUM_DIMENSIONS.form), scr: pick(RUM_DIMENSIONS.scr), mem: pick(RUM_DIMENSIONS.mem), net: pick(RUM_DIMENSIONS.net) }, m));
        }
      });
      expect(leaks(hour), `hour ${hourIndex} with ${total} reports`).toEqual([]);
      for (const row of hour.rows) expect(row.reports).toBeGreaterThanOrEqual(MIN_GROUP_REPORTS);
    }
  });

  it('the published hour does not carry a bare count below the floor', () => {
    expect(publishOne((agg) => { for (let i = 0; i < 3; i += 1) agg.ingest(beacon()); }).reports).toBe(0);
    expect(publishOne((agg) => { for (let i = 0; i < 6; i += 1) agg.ingest(beacon()); }).reports).toBe(6);
  });
});
