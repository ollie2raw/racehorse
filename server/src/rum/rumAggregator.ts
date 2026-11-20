/**
 * First-party speed measurements (docs/ops/rum-beacon.md): what a sampled visit reports, and how the reports become hourly totals.
 *
 * A beacon carries no identifier. The server keeps NO individual beacon: each one is folded into per-hour histograms and dropped.
 * Totals are published (logged, optionally stored) for the whole hour and for each of five single dimensions (platform, form, screen band,
 * memory band, connection type), never for combinations of them. A group with fewer than MIN_GROUP_REPORTS summaries in the hour is not
 * published on its own: it is folded into an "other" group for its dimension, and an "other" group still under the minimum is held
 * back and carried into the next hour. The same floor applies to each row: a metric that fewer than MIN_GROUP_REPORTS summaries in a group
 * reported is withheld. Nothing under the minimum is ever logged or stored (the database table also refuses reports < 5).
 */

export const RUM_SCHEMA_VERSION = 1;
export const MIN_GROUP_REPORTS = 5;
export const MAX_MS = 600_000;

export const RUM_METRICS = [
  'nav.home_to_hub',
  'nav.hub_to_setup',
  'nav.start_to_match.pvf',
  'nav.start_to_match.daily',
  'nav.private_to_room.mp',
  'match.first_playable.pvf',
  'match.first_playable.daily',
  'match.first_playable.mp',
  'hand.end_to_playable.solo',
  'hand.end_to_playable.mp',
  'mp.hand_ready_ack',
  'mp.room_join_ack',
  'inp',
] as const;
export type RumMetric = (typeof RUM_METRICS)[number];
const METRIC_SET: ReadonlySet<string> = new Set(RUM_METRICS);

export const RUM_DIMENSIONS = {
  plat: ['web', 'ios', 'android'],
  form: ['phone', 'tablet', 'desktop'],
  scr: ['xs', 's', 'm', 'l'],
  mem: ['le2', '4', '8p', 'na'],
  net: ['slow', '3g', '4g', 'na'],
} as const;
export type RumDimension = keyof typeof RUM_DIMENSIONS;
const DIMENSIONS = Object.keys(RUM_DIMENSIONS) as RumDimension[];

export type RumBeacon = {
  v: 1;
  app: string;
  plat: (typeof RUM_DIMENSIONS.plat)[number];
  form: (typeof RUM_DIMENSIONS.form)[number];
  scr: (typeof RUM_DIMENSIONS.scr)[number];
  mem: (typeof RUM_DIMENSIONS.mem)[number];
  net: (typeof RUM_DIMENSIONS.net)[number];
  /** metric -> [observations, median, max] in whole milliseconds */
  m: Partial<Record<RumMetric, [number, number, number]>>;
};

const TOP_KEYS = new Set(['v', 'app', 'plat', 'form', 'scr', 'mem', 'net', 'm']);
const APP_ID = /^[A-Za-z0-9._-]{1,16}$/;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** Strict: unknown keys, unknown metrics, out-of-range numbers, anything off-schema is rejected whole. Returns null when invalid. */
export function parseBeacon(raw: unknown): RumBeacon | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) if (!TOP_KEYS.has(key)) return null;
  if (body.v !== RUM_SCHEMA_VERSION) return null;
  if (typeof body.app !== 'string' || !APP_ID.test(body.app)) return null;
  for (const dim of DIMENSIONS) {
    if (typeof body[dim] !== 'string' || !(RUM_DIMENSIONS[dim] as readonly string[]).includes(body[dim] as string)) return null;
  }
  const m = body.m;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const entries = Object.entries(m as Record<string, unknown>);
  if (entries.length === 0 || entries.length > RUM_METRICS.length) return null;
  const clean: RumBeacon['m'] = {};
  for (const [name, value] of entries) {
    if (!METRIC_SET.has(name) || !Array.isArray(value) || value.length !== 3) return null;
    const [n, p50, max] = value as unknown[];
    if (!isInt(n, 1, 1000) || !isInt(p50, 0, MAX_MS) || !isInt(max, 0, MAX_MS) || p50 > max) return null;
    clean[name as RumMetric] = [n, p50, max];
  }
  return { v: 1, app: body.app, plat: body.plat as RumBeacon['plat'], form: body.form as RumBeacon['form'], scr: body.scr as RumBeacon['scr'], mem: body.mem as RumBeacon['mem'], net: body.net as RumBeacon['net'], m: clean };
}

// Upper bounds of the histogram buckets (ms). A percentile is reported as the upper bound of the bucket it falls in.
const EDGES = [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 8000, 12000, 20000, 40000, MAX_MS];

type Hist = { counts: number[]; n: number; max: number; reports: number };
const emptyHist = (): Hist => ({ counts: new Array(EDGES.length).fill(0), n: 0, max: 0, reports: 0 });
const bucketOf = (ms: number): number => { const i = EDGES.findIndex((edge) => ms <= edge); return i === -1 ? EDGES.length - 1 : i; };

function quantile(hist: Hist, q: number): number {
  if (hist.n === 0) return 0;
  const rank = Math.max(1, Math.ceil(hist.n * q));
  let seen = 0;
  for (let i = 0; i < hist.counts.length; i += 1) {
    seen += hist.counts[i]!;
    if (seen >= rank) return Math.min(EDGES[i]!, Math.max(hist.max, 0) || EDGES[i]!);
  }
  return hist.max;
}

type Group = { reports: number; metrics: Map<string, Hist> };
const emptyGroup = (): Group => ({ reports: 0, metrics: new Map() });

function mergeInto(target: Group, source: Group): void {
  target.reports += source.reports;
  for (const [metric, h] of source.metrics) {
    const t = target.metrics.get(metric) ?? emptyHist();
    for (let i = 0; i < t.counts.length; i += 1) t.counts[i]! += h.counts[i]!;
    t.n += h.n; t.max = Math.max(t.max, h.max); t.reports += h.reports;
    target.metrics.set(metric, t);
  }
}

export type RumRow = { group: string; metric: string; reports: number; n: number; p50: number; p75: number; p95: number; max: number };
export type RumPublishedHour = { hour: string; rows: RumRow[]; reports: number; withheldGroups: number };

const hourStart = (ms: number): number => Math.floor(ms / 3_600_000) * 3_600_000;

function rowsOf(group: string, g: Group, minReports: number): RumRow[] {
  return [...g.metrics.entries()].filter(([, h]) => h.reports >= minReports).sort(([a], [b]) => a.localeCompare(b)).map(([metric, h]) => ({
    group, metric, reports: h.reports, n: h.n, p50: quantile(h, 0.5), p75: quantile(h, 0.75), p95: quantile(h, 0.95), max: h.max,
  }));
}

/**
 * Complementary suppression. A group below the floor is withheld, but `all` is published, so `all` minus the published rows of
 * one dimension gives back the withheld part: its report count and, through `max`, an exact value of a single summary. For
 * every metric and every dimension: if what the published rows of that dimension leave out of `all` is between 1 and
 * minReports-1 summaries, drop that dimension's rows for the metric. What is left is `all` alone (nothing to subtract), so no
 * published number describes fewer than minReports summaries, however the rows are combined. A remainder of 0 (everything is in
 * some published row) or of at least minReports is fine.
 */
function suppressDifferenceable(rows: RumRow[], minReports: number): RumRow[] {
  const allByMetric = new Map(rows.filter((r) => r.group === 'all').map((r) => [r.metric, r.reports]));
  const dimensionOf = (group: string): string | null => {
    const [head, value] = group.split(':');
    if (head === 'all') return null;
    return head === 'other' ? value ?? null : head ?? null;
  };
  const drop = new Set<string>();
  for (const dim of DIMENSIONS) {
    for (const [metric, total] of allByMetric) {
      let published = 0;
      for (const r of rows) if (r.metric === metric && dimensionOf(r.group) === dim) published += r.reports;
      const remainder = total - published;
      if (remainder > 0 && remainder < minReports) drop.add(`${dim}\u0000${metric}`);
    }
  }
  if (drop.size === 0) return rows;
  return rows.filter((r) => {
    const dim = dimensionOf(r.group);
    return dim === null || !drop.has(`${dim}\u0000${r.metric}`);
  });
}

export class RumAggregator {
  private hour: number;
  private groups = new Map<string, Group>();
  /** below-minimum groups held over from earlier hours (so a quiet hour never publishes a tiny group) */
  private carried = new Map<string, Group>();
  private totalReports = 0;

  /** Summaries folded into the current hour so far. Internal (tests, ingest checks); never published, because a count below the floor is itself a small total. */
  get ingested(): number {
    return this.totalReports;
  }

  constructor(private readonly now: () => number = Date.now, private readonly minReports = MIN_GROUP_REPORTS) {
    this.hour = hourStart(this.now());
  }

  /** Folds one validated beacon into the current hour. The beacon itself is not kept. */
  ingest(beacon: RumBeacon): void {
    const keys = ['all', ...DIMENSIONS.map((dim) => `${dim}:${beacon[dim]}`)];
    for (const key of keys) {
      const group = this.groups.get(key) ?? emptyGroup();
      group.reports += 1;
      for (const [metric, [n, p50, max]] of Object.entries(beacon.m) as [string, [number, number, number]][]) {
        const hist = group.metrics.get(metric) ?? emptyHist();
        hist.counts[bucketOf(p50)]! += n; // the visit's median stands for its n observations
        hist.n += n; hist.max = Math.max(hist.max, max); hist.reports += 1;
        group.metrics.set(metric, hist);
      }
      this.groups.set(key, group);
    }
    this.totalReports += 1;
  }

  /** Publishes every hour that has ended (normally one). Returns nothing when the hour has not rolled over. */
  rollover(): RumPublishedHour[] {
    const current = hourStart(this.now());
    if (current <= this.hour) return [];
    const published = this.publish(this.hour, true);
    this.hour = current;
    this.groups = new Map();
    this.totalReports = 0;
    return [published];
  }

  /** What the current hour would publish now (floor applied, nothing carried or cleared). For the token-protected summary. */
  preview(): RumPublishedHour {
    return this.publish(this.hour, false);
  }

  private publish(hourMs: number, commit: boolean): RumPublishedHour {
    const rows: RumRow[] = [];
    let withheld = 0;
    const carried = new Map(this.carried);
    const take = (key: string): Group => {
      const merged = emptyGroup();
      const own = this.groups.get(key);
      const held = carried.get(key);
      if (own) mergeInto(merged, own);
      if (held) mergeInto(merged, held);
      return merged;
    };

    const all = take('all');
    if (all.reports >= this.minReports) { rows.push(...rowsOf('all', all, this.minReports)); carried.delete('all'); } else { if (all.reports) withheld += 1; carried.set('all', all); }

    for (const dim of DIMENSIONS) {
      const small = emptyGroup();
      for (const value of RUM_DIMENSIONS[dim]) {
        const key = `${dim}:${value}`;
        const g = take(key);
        if (g.reports === 0) continue;
        if (g.reports >= this.minReports) { rows.push(...rowsOf(key, g, this.minReports)); carried.delete(key); } else { mergeInto(small, g); carried.delete(key); }
      }
      const otherKey = `other:${dim}`;
      const heldOther = carried.get(otherKey);
      if (heldOther) mergeInto(small, heldOther);
      if (small.reports >= this.minReports) { rows.push(...rowsOf(otherKey, small, this.minReports)); carried.delete(otherKey); }
      else if (small.reports > 0) { withheld += 1; carried.set(otherKey, small); }
    }

    if (commit) this.carried = carried;
    return {
      hour: new Date(hourMs).toISOString(),
      rows: suppressDifferenceable(rows, this.minReports),
      // A bare count below the floor would itself be a "total" of fewer than five summaries, so it is not published.
      reports: this.totalReports >= this.minReports ? this.totalReports : 0,
      withheldGroups: withheld,
    };
  }
}
