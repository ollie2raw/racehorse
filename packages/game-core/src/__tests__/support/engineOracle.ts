/**
 * Independent reference model of the Racehorse rules, written from the documented rules (engine.ts
 * "Racehorse action invariants", scoring.ts, the board topology in types.ts) and deliberately sharing
 * NO code with engine.ts / scoring.ts / openEndsGeometry.ts. It only uses plain tile arithmetic.
 *
 * Topology
 *  - a main line of tiles; the opening tile exposes `low` on the left port and `high` on the right port;
 *  - every double placed anywhere gets the next hub id (0,1,2,... in placement order);
 *  - a double on the main line is CROSSED once it has a neighbour on both sides (interior of the line);
 *  - a crossed hub offers two arms (`branch-<hubId>-<0|1>`): an empty arm matches the hub value, a
 *    populated arm matches the exposed pip of its last tile;
 *  - a double inside an arm is itself a hub; it is crossed once a tile follows it in that arm.
 * Scoring: the sum of the exposed pips (a double tip counts twice) over the two line ends, plus the tip
 * of every populated arm of every crossed hub (recursively); a sum divisible by `scoringMultiple`
 * scores sum / multiple.
 */

export type OTile = { low: number; high: number };
export const okey = (t: OTile): string => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;
export const oIsDouble = (t: OTile): boolean => t.low === t.high;
const has = (t: OTile, pip: number): boolean => t.low === pip || t.high === pip;
const other = (t: OTile, pip: number): number => (t.low === pip ? t.high : t.low);
export const opips = (t: OTile): number => t.low + t.high;
export const canon = (t: OTile): OTile => ({ low: Math.min(t.low, t.high), high: Math.max(t.low, t.high) });

type MainTile = { tile: OTile; leftPip: number; rightPip: number };
type ArmTile = { tile: OTile; tip: number };
type Hub =
  | { id: number; value: number; where: 'main'; ref: MainTile }
  | { id: number; value: number; where: 'arm'; armKey: string; depth: number };

export type Port = { position: string; pip: number };

export class OBoard {
  main: MainTile[] = [];
  arms = new Map<string, ArmTile[]>();
  hubs: Hub[] = [];

  static empty(): OBoard { return new OBoard(); }

  clone(): OBoard {
    const b = new OBoard();
    b.main = this.main.map((m) => ({ ...m, tile: { ...m.tile } }));
    const refMap = new Map<MainTile, MainTile>();
    this.main.forEach((m, i) => refMap.set(m, b.main[i]!));
    for (const [k, v] of this.arms) b.arms.set(k, v.map((a) => ({ tile: { ...a.tile }, tip: a.tip })));
    b.hubs = this.hubs.map((h) => (h.where === 'main' ? { ...h, ref: refMap.get(h.ref)! } : { ...h }));
    return b;
  }

  tiles(): OTile[] {
    return [...this.main.map((m) => m.tile), ...[...this.arms.values()].flatMap((a) => a.map((x) => x.tile))];
  }

  private mainCrossed(ref: MainTile): boolean {
    const i = this.main.indexOf(ref);
    return i > 0 && i < this.main.length - 1;
  }

  private armCrossedHubs(armKey: string): Hub[] {
    const arm = this.arms.get(armKey) ?? [];
    return this.hubs.filter((h) => h.where === 'arm' && h.armKey === armKey && h.depth + 1 < arm.length);
  }

  private crossedHubs(): Hub[] {
    const out: Hub[] = [];
    for (const h of this.hubs) {
      if (h.where === 'main' ? this.mainCrossed(h.ref) : (this.arms.get(h.armKey)?.length ?? 0) > h.depth + 1) out.push(h);
    }
    return out;
  }

  /** Hub ids that are currently crossed (offer arms). */
  crossedHubIds(): Set<number> {
    return new Set(this.crossedHubs().map((h) => h.id));
  }

  /** Exposed pip at the tip of an arm, or null if the arm is empty. */
  armTip(hubId: number, arm: number): { pip: number; double: boolean } | null {
    const lane = this.arms.get(`${hubId}:${arm}`);
    if (!lane || lane.length === 0) return null;
    const last = lane[lane.length - 1]!;
    return { pip: last.tip, double: oIsDouble(last.tile) };
  }

  /** Every place a tile may currently be attached, with the pip it must match. */
  ports(): Port[] {
    if (this.main.length === 0) return [];
    const ports: Port[] = [
      { position: 'left', pip: this.main[0]!.leftPip },
      { position: 'right', pip: this.main[this.main.length - 1]!.rightPip },
    ];
    for (const h of this.crossedHubs()) {
      for (const arm of [0, 1]) {
        const tiles = this.arms.get(`${h.id}:${arm}`);
        ports.push({ position: `branch-${h.id}-${arm}`, pip: tiles && tiles.length ? tiles[tiles.length - 1]!.tip : h.value });
      }
    }
    return ports;
  }

  place(tile: OTile, position: string): void {
    const t = canon(tile);
    if (this.main.length === 0) {
      // The opening tile is mirror-symmetric: whichever way round it is submitted defines which of its
      // pips sits on the 'left' port (the engine reads `low` as the left pip).
      const m: MainTile = { tile: t, leftPip: tile.low, rightPip: tile.high };
      this.main.push(m);
      if (oIsDouble(t)) this.hubs.push({ id: 0, value: t.high, where: 'main', ref: m });
      return;
    }
    const port = this.ports().find((p) => p.position === position);
    if (!port || !has(t, port.pip)) throw new Error(`oracle: ${okey(t)} cannot go on ${position}`);
    const exposed = other(t, port.pip);
    const nextId = this.hubs.length;
    if (position === 'left') {
      const m: MainTile = { tile: t, leftPip: exposed, rightPip: port.pip };
      this.main.unshift(m);
      if (oIsDouble(t)) this.hubs.push({ id: nextId, value: t.high, where: 'main', ref: m });
    } else if (position === 'right') {
      const m: MainTile = { tile: t, leftPip: port.pip, rightPip: exposed };
      this.main.push(m);
      if (oIsDouble(t)) this.hubs.push({ id: nextId, value: t.high, where: 'main', ref: m });
    } else {
      const [, hubId, arm] = /^branch-(\d+)-(\d)$/.exec(position)!;
      const key = `${hubId}:${arm}`;
      const lane = this.arms.get(key) ?? [];
      lane.push({ tile: t, tip: exposed });
      this.arms.set(key, lane);
      if (oIsDouble(t)) this.hubs.push({ id: nextId, value: t.high, where: 'arm', armKey: key, depth: lane.length - 1 });
    }
  }

  /** Sum of exposed pips as defined by the scoring rule. */
  openEndsSum(): number {
    if (this.main.length === 0) return 0;
    if (this.main.length === 1) return opips(this.main[0]!.tile);
    const first = this.main[0]!;
    const last = this.main[this.main.length - 1]!;
    let sum = first.leftPip * (oIsDouble(first.tile) ? 2 : 1) + last.rightPip * (oIsDouble(last.tile) ? 2 : 1);
    for (const h of this.hubs) {
      if (h.where !== 'main' || !this.mainCrossed(h.ref)) continue;
      for (const arm of [0, 1]) sum += this.armSum(`${h.id}:${arm}`);
    }
    return sum;
  }

  private armSum(key: string): number {
    const lane = this.arms.get(key);
    if (!lane || lane.length === 0) return 0;
    const tip = lane[lane.length - 1]!;
    let sum = tip.tip * (oIsDouble(tip.tile) ? 2 : 1);
    for (const h of this.armCrossedHubs(key)) for (const arm of [0, 1]) sum += this.armSum(`${h.id}:${arm}`);
    return sum;
  }

  score(multiple: number): number {
    const s = this.openEndsSum();
    return s % multiple === 0 ? s / multiple : 0;
  }
}

export type OConfig = {
  maxPips: number;
  tilesPerPlayer: number;
  deadTileCount: number;
  scoringMultiple: number;
  blockedHandRule: 'lowestPips' | 'noScore';
  endHandBonus: 'sumOpponentPenalties' | 'none';
  winningScore: number;
};

export type OAction =
  | { kind: 'play'; actor: string; tile: OTile; position: string }
  | { kind: 'draw'; actor: string }
  | { kind: 'pass'; actor: string };

export type OEvent = {
  /** Kind of hand ending produced by this action, if any. */
  handEnd?: 'out' | 'blocked';
  playScore?: number;
  endBonus?: number;
  forcedDraws: number;
  chainPassed: boolean;
  scoredPlay: boolean;
};

export class OGame {
  hands = new Map<string, OTile[]>();
  scores = new Map<string, number>();
  boneyard: OTile[] = [];
  board: OBoard = OBoard.empty();
  cur = 0;
  passes = 0;
  handOpen = false;
  handOver = false;
  gameOver = false;
  winner: string | null = null;
  handNumber = 0;
  starters: string[] = [];

  ids: string[];
  cfg: OConfig;

  constructor(ids: string[], cfg: OConfig) {
    this.ids = ids;
    this.cfg = cfg;
    for (const id of ids) { this.hands.set(id, []); this.scores.set(id, 0); }
  }

  fullSet(): OTile[] {
    const out: OTile[] = [];
    for (let h = 0; h <= this.cfg.maxPips; h += 1) for (let l = 0; l <= h; l += 1) out.push({ low: l, high: h });
    return out;
  }

  /** Mirrors the documented deal: hands in player order, the rest is the boneyard, the last N of it are dead. */
  dealHand(deck: OTile[], starter?: string): void {
    if (this.gameOver) throw new Error('oracle: game over');
    this.handNumber += 1;
    let cursor = 0;
    for (const id of this.ids) {
      this.hands.set(id, deck.slice(cursor, cursor + this.cfg.tilesPerPlayer).map(canon));
      cursor += this.cfg.tilesPerPlayer;
    }
    this.boneyard = deck.slice(cursor).map(canon);
    this.board = OBoard.empty();
    this.passes = 0;
    this.handOpen = false;
    this.handOver = false;
    if (starter !== undefined) this.cur = this.ids.indexOf(starter);
    else if (this.starters.length > 0) this.cur = (this.ids.indexOf(this.starters[this.starters.length - 1]!) + 1) % this.ids.length;
    else this.cur = (this.handNumber - 1) % this.ids.length;
    this.starters.push(this.ids[this.cur]!);
  }

  get actor(): string { return this.ids[this.cur]!; }
  get deadCount(): number { return this.cfg.deadTileCount; }
  drawable(): number { return Math.max(0, this.boneyard.length - this.cfg.deadTileCount); }
  deadTiles(): OTile[] { return this.cfg.deadTileCount > 0 ? this.boneyard.slice(this.boneyard.length - this.cfg.deadTileCount) : []; }

  plays(id: string, hand = this.hands.get(id)!, board = this.board, open = this.handOpen): Array<{ tile: OTile; position: string }> {
    const out: Array<{ tile: OTile; position: string }> = [];
    if (this.handOver || this.gameOver) return out;
    if (!open) {
      for (const tile of hand) {
        const probe = OBoard.empty();
        probe.place(tile, 'left');
        if (oIsDouble(tile) || probe.score(this.cfg.scoringMultiple) > 0) out.push({ tile, position: 'left' });
      }
      return out;
    }
    const ports = board.ports();
    for (const tile of hand) {
      const seen = new Set<string>();
      for (const p of ports) {
        if (has(tile, p.pip) && !seen.has(p.position)) { seen.add(p.position); out.push({ tile, position: p.position }); }
      }
    }
    return out;
  }

  canPass(id: string): boolean { return this.plays(id).length === 0 && this.drawable() === 0 && !this.handOver && !this.gameOver; }
  canDraw(id: string): boolean { return this.plays(id).length === 0 && this.drawable() > 0 && !this.handOver && !this.gameOver; }

  private leaderOverTarget(): string | null {
    const qualified = this.ids.filter((id) => this.scores.get(id)! >= this.cfg.winningScore);
    if (qualified.length === 0) return null;
    const top = Math.max(...qualified.map((id) => this.scores.get(id)!));
    const leaders = qualified.filter((id) => this.scores.get(id) === top);
    return leaders.length === 1 ? leaders[0]! : null;
  }

  private pipsIn(id: string): number { return this.hands.get(id)!.reduce((s, t) => s + opips(t), 0); }

  private finishHand(kind: 'out' | 'blocked', outId?: string): { endBonus: number } {
    this.handOver = true;
    let endBonus = 0;
    if (kind === 'out') {
      if (this.cfg.endHandBonus === 'sumOpponentPenalties') {
        endBonus = this.ids.filter((i) => i !== outId).reduce((s, i) => s + Math.round(this.pipsIn(i) / this.cfg.scoringMultiple), 0);
      }
      this.scores.set(outId!, this.scores.get(outId!)! + endBonus);
    } else if (this.cfg.blockedHandRule === 'lowestPips') {
      const lows = this.ids.map((i) => this.pipsIn(i));
      const min = Math.min(...lows);
      const winners = this.ids.filter((_, k) => lows[k] === min);
      if (winners.length === 1) {
        const w = winners[0]!;
        if (this.cfg.endHandBonus === 'sumOpponentPenalties') {
          endBonus = this.ids.filter((i) => i !== w).reduce((s, i) => s + Math.round(this.pipsIn(i) / this.cfg.scoringMultiple), 0);
        }
        this.scores.set(w, this.scores.get(w)! + endBonus);
      }
    }
    this.winner = this.leaderOverTarget();
    this.gameOver = this.winner !== null;
    return { endBonus };
  }

  private doPass(ev: OEvent): void {
    this.passes += 1;
    if (this.passes >= this.ids.length) {
      ev.handEnd = 'blocked';
      ev.endBonus = this.finishHand('blocked').endBonus;
      return;
    }
    this.cur = (this.cur + 1) % this.ids.length;
  }

  /** Applies a rules-legal action. Throws (without effect on `this`) if the action is not legal. */
  apply(a: OAction): OEvent {
    const ev: OEvent = { forcedDraws: 0, chainPassed: false, scoredPlay: false };
    if (this.gameOver || this.handOver) throw new Error('oracle: terminal');
    if (a.actor !== this.actor) throw new Error('oracle: not your turn');
    if (a.kind === 'pass') {
      if (!this.canPass(a.actor)) throw new Error('oracle: illegal pass');
      this.doPass(ev);
      return ev;
    }
    if (a.kind === 'draw') {
      if (!this.canDraw(a.actor)) throw new Error('oracle: illegal draw');
      this.hands.get(a.actor)!.push(this.boneyard.shift()!);
      return ev;
    }
    const legal = this.plays(a.actor).some((p) => okey(p.tile) === okey(a.tile) && p.position === a.position);
    if (!legal) throw new Error('oracle: illegal play');
    const hand = this.hands.get(a.actor)!;
    hand.splice(hand.findIndex((t) => okey(t) === okey(a.tile)), 1);
    this.board.place(a.tile, a.position);
    const scored = this.board.score(this.cfg.scoringMultiple);
    this.scores.set(a.actor, this.scores.get(a.actor)! + scored);
    ev.playScore = scored;
    ev.scoredPlay = scored > 0;
    this.passes = 0;
    this.handOpen = true;
    const extra = oIsDouble(a.tile) || scored > 0;
    if (extra && this.drawable() > 0 && this.plays(a.actor).length === 0) {
      // Forced-draw chain: draw until a play exists or the drawable boneyard is exhausted.
      for (;;) {
        hand.push(this.boneyard.shift()!);
        ev.forcedDraws += 1;
        if (this.plays(a.actor).length > 0) return ev;
        if (this.drawable() === 0) break;
      }
      ev.chainPassed = true;
      this.doPass(ev);
      return ev;
    }
    if (hand.length === 0) {
      ev.handEnd = 'out';
      ev.endBonus = this.finishHand('out', a.actor).endBonus;
      return ev;
    }
    if (!extra) this.cur = (this.cur + 1) % this.ids.length;
    return ev;
  }
}
