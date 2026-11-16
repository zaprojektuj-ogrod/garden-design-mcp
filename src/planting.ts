// Planting a zone (plant_zones): where each plant goes, so the agent picks the plants and the editor
// does the geometry — nursery-style groups of 3–7 with canopies touching, rows for hedges and screens,
// clear of paths and paving. Browser-safe (no Node imports); metres throughout.

import { area, inside, minWidth, type Pt } from "./geometry.js";

export interface PlantChoice {
  productId: string;
  /** Catalog footprint (mature canopy diameter), m */
  footprint: number;
  /** Relative share of the planted area (default 1) */
  share?: number;
  /** Exact number to plant instead of a share */
  count?: number;
}

export interface Canopy { x: number; y: number; footprint: number }

export interface PlantingOptions {
  /** "groups" for beds, "row" for hedges and screens; default: row when the zone is too narrow for groups */
  layout?: "groups" | "row";
  /** Target canopy cover of the zone, 0–1.2 (default 0.9) */
  coverage?: number;
  /** Plants already there, which keep their place */
  existing?: Canopy[];
  /** Areas the plant centres must stay out of (paths, terraces, buildings…) */
  avoid?: Pt[][];
}

export interface PlantingPlan {
  placed: Array<{ productId: string; x: number; y: number }>;
  /** Plants that did not fit, by product */
  short: Record<string, number>;
  layout: "groups" | "row";
}

/** Canopies may overlap a little: plants in a nursery plan touch, and slightly overlap at maturity */
const TOUCH = 0.92;

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function edgeDist(p: Pt, poly: Pt[]): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(p, poly[j], poly[i]));
  return d;
}

/** The direction of the zone's longest edge: rows and groups line up with it (and so with the house) */
function mainAxis(poly: Pt[]): { u: Pt; v: Pt } {
  let best = { len: -1, dx: 1, dy: 0 };
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const dx = poly[i].x - poly[j].x, dy = poly[i].y - poly[j].y;
    const len = Math.hypot(dx, dy);
    if (len > best.len) best = { len, dx, dy };
  }
  const u = { x: best.dx / best.len, y: best.dy / best.len };
  return { u, v: { x: -u.y, y: u.x } };
}

interface Frame {
  u: Pt; v: Pt;
  toLocal(p: Pt): Pt;
  toWorld(s: number, t: number): Pt;
  range: { s0: number; s1: number; t0: number; t1: number };
}

function frameOf(poly: Pt[]): Frame {
  const { u, v } = mainAxis(poly);
  const toLocal = (p: Pt) => ({ x: p.x * u.x + p.y * u.y, y: p.x * v.x + p.y * v.y });
  const local = poly.map(toLocal);
  const range = {
    s0: Math.min(...local.map((p) => p.x)), s1: Math.max(...local.map((p) => p.x)),
    t0: Math.min(...local.map((p) => p.y)), t1: Math.max(...local.map((p) => p.y)),
  };
  return { u, v, toLocal, toWorld: (s, t) => ({ x: s * u.x + t * v.x, y: s * u.y + t * v.y }), range };
}

/** The zone's extent across its axis at position s along it: [tMin, tMax] or null */
function crossSection(local: Pt[], s: number): [number, number] | null {
  const ts: number[] = [];
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    const a = local[j], b = local[i];
    if ((a.x <= s && b.x > s) || (b.x <= s && a.x > s)) ts.push(a.y + ((s - a.x) / (b.x - a.x)) * (b.y - a.y));
  }
  return ts.length >= 2 ? [Math.min(...ts), Math.max(...ts)] : null;
}

/** Spots for a plant of one size: a lattice along the zone's axis (rows `step` apart), inside and clear */
function lattice(poly: Pt[], f: Frame, spacing: number, inset: number, ok: (p: Pt) => boolean): Pt[] {
  const out: Pt[] = [];
  const rowGap = spacing * Math.sqrt(3) / 2;
  const { s0, s1, t0, t1 } = f.range;
  // Rows centred across the zone, so a narrow bed still gets its middle row
  const rows = Math.max(1, Math.floor((t1 - t0 - 2 * inset) / rowGap) + 1);
  const tStart = (t0 + t1) / 2 - ((rows - 1) * rowGap) / 2;
  for (let r = 0; r < rows; r++) {
    const t = tStart + r * rowGap;
    const offset = r % 2 ? spacing / 2 : 0;
    for (let s = s0 + inset + offset; s <= s1 - inset + 1e-9; s += spacing) {
      const p = f.toWorld(s, t);
      if (inside(p, poly) && edgeDist(p, poly) >= inset - 1e-9 && ok(p)) out.push(p);
    }
  }
  return out;
}

/** One line down the middle of the zone, plants `spacing` apart — a hedge or a screen */
function centreLine(poly: Pt[], f: Frame, spacing: number, ok: (p: Pt) => boolean): Pt[] {
  const local = poly.map(f.toLocal);
  const out: Pt[] = [];
  const { s0, s1 } = f.range;
  const n = Math.max(1, Math.floor((s1 - s0) / spacing));
  const start = s0 + (s1 - s0 - (n - 1) * spacing) / 2;
  for (let i = 0; i < n; i++) {
    const s = start + i * spacing;
    const cut = crossSection(local, s);
    if (!cut) continue;
    const p = f.toWorld(s, (cut[0] + cut[1]) / 2);
    if (inside(p, poly) && ok(p)) out.push(p);
  }
  return out;
}

const canopyArea = (footprint: number) => Math.PI * (footprint / 2) ** 2;

/** How many of each plant: an exact count, or a share of the canopy the zone still needs */
function counts(poly: Pt[], plants: PlantChoice[], coverage: number, existing: Canopy[]): number[] {
  const have = existing.filter((c) => inside(c, poly)).reduce((n, c) => n + canopyArea(c.footprint), 0);
  const need = Math.max(0, coverage * area(poly) - have);
  const shared = plants.filter((p) => p.count === undefined);
  const total = shared.reduce((n, p) => n + (p.share ?? 1), 0) || 1;
  const fixed = plants.reduce((n, p) => n + (p.count !== undefined ? p.count * canopyArea(p.footprint) : 0), 0);
  const left = Math.max(0, need - fixed);
  return plants.map((p) =>
    p.count !== undefined ? p.count : Math.max(1, Math.round((left * (p.share ?? 1)) / total / canopyArea(p.footprint))));
}

export function planPlanting(poly: Pt[], plants: PlantChoice[], options: PlantingOptions = {}): PlantingPlan {
  const coverage = Math.min(1.2, Math.max(0.1, options.coverage ?? 0.9));
  const avoid = options.avoid ?? [];
  const canopies: Canopy[] = [...(options.existing ?? [])];
  const f = frameOf(poly);
  const width = minWidth(poly);
  const forceRow = options.layout === "row";
  // Each plant goes in a row when the zone is too narrow for a group of it (a hedge), else in groups
  const narrow = (footprint: number) => forceRow || width < 1.6 * footprint;
  const layout = plants.every((p) => narrow(p.footprint)) ? "row" : "groups";
  const want = counts(poly, plants, coverage, canopies);
  const placed: PlantingPlan["placed"] = [];
  const short: Record<string, number> = {};

  // Plant centres stay out of paths and paving (canopies may reach over their edge, as in a real bed)
  const clear = (p: Pt, footprint: number, touch = TOUCH) =>
    !avoid.some((a) => inside(p, a) || edgeDist(p, a) < 0.05) &&
    // (a millimetre's tolerance: spots can sit exactly at the touching distance)
    canopies.every((c) => Math.hypot(c.x - p.x, c.y - p.y) >= touch * (c.footprint + footprint) / 2 - 1e-3);
  const plant = (productId: string, p: Pt, footprint: number) => {
    placed.push({ productId, x: p.x, y: p.y });
    canopies.push({ x: p.x, y: p.y, footprint });
  };
  // Candidate spots on a grid finer than the plant, so each plant can sit right against its neighbours
  const spotsFor = (footprint: number) => {
    const step = Math.max(0.05, (TOUCH * footprint) / 2);
    const ok = (q: Pt) => clear(q, footprint);
    if (narrow(footprint)) return centreLine(poly, f, step, ok);
    const spots = lattice(poly, f, step, Math.min(0.15 * footprint, width / 2 - 0.01), ok);
    return spots.length ? spots : centreLine(poly, f, step, ok);
  };
  const near = (q: Pt, from: Pt[]) => (from.length ? Math.min(...from.map((c) => Math.hypot(c.x - q.x, c.y - q.y))) : Infinity);

  // A row is planted along its whole length whatever the cover: a hedge with gaps is not a hedge
  const length = f.range.s1 - f.range.s0;
  const rowShares = plants.filter((p) => p.count === undefined && narrow(p.footprint)).reduce((n, p) => n + (p.share ?? 1), 0);
  plants.forEach((p, i) => {
    if (p.count === undefined && narrow(p.footprint)) {
      want[i] = Math.max(1, Math.round(((Math.floor(length / (TOUCH * p.footprint)) + 1) * (p.share ?? 1)) / rowShares));
    }
  });
  const along = (q: Pt) => f.toLocal(q).x;

  // Largest plants first; each kind in drifts of 3–7, the drifts spread through a bed; in a row, one
  // drift after another from one end
  const order = plants.map((p, i) => ({ ...p, n: want[i] })).sort((a, b) => b.footprint - a.footprint);
  const mineOf = new Map<string, Pt[]>();
  for (const p of order) {
    const spacing = TOUCH * p.footprint;
    let spots = spotsFor(p.footprint);
    const groupSize = p.n < 3 ? p.n : Math.min(7, Math.max(3, Math.round(p.n / Math.ceil(p.n / 5))));
    const mine: Pt[] = [];
    mineOf.set(p.productId, mine);
    let left = p.n;
    while (left > 0) {
      spots = spots.filter((q) => clear(q, p.footprint));
      if (spots.length === 0) break;
      // A new drift starts where this kind is not yet, and next to what is planted (no stranded gaps)
      const seed = narrow(p.footprint) ? spots.reduce((a, b) => (along(a) <= along(b) ? a : b)) : spots.reduce((best, q) => {
        const fromMine = near(q, mine);
        const fromAll = near(q, canopies);
        const score = (Number.isFinite(fromMine) ? Math.min(fromMine, 4 * spacing) : 4 * spacing) - (Number.isFinite(fromAll) ? 0.5 * fromAll : 0);
        return score > best.score ? { q, score } : best;
      }, { q: spots[0], score: -Infinity }).q;
      const group: Pt[] = [seed];
      plant(p.productId, seed, p.footprint);
      mine.push(seed);
      left--;
      while (group.length < groupSize && left > 0) {
        const cx = group.reduce((n, q) => n + q.x, 0) / group.length;
        const cy = group.reduce((n, q) => n + q.y, 0) / group.length;
        let next: Pt | null = null;
        let best = Infinity;
        for (const q of spots) {
          if (near(q, group) > spacing * 1.3 || !clear(q, p.footprint)) continue;
          const d = Math.hypot(q.x - cx, q.y - cy);
          if (d < best) { best = d; next = q; }
        }
        if (!next) break;
        group.push(next);
        plant(p.productId, next, p.footprint);
        mine.push(next);
        left--;
      }
    }
    if (left > 0 && p.count !== undefined) short[p.productId] = left;
  }

  // Shares aim at a cover, not a count: where the drifts left room, extend them until the zone is covered
  const byShare = order.filter((p) => p.count === undefined).sort((a, b) => (b.share ?? 1) - (a.share ?? 1));
  for (const p of byShare) {
    const mine = mineOf.get(p.productId) ?? [];
    let spots = spotsFor(p.footprint);
    while (coverOf(poly, canopies) < coverage) {
      spots = spots.filter((q) => clear(q, p.footprint));
      if (spots.length === 0) break;
      const next = spots.reduce((a, b) => (near(a, mine) <= near(b, mine) ? a : b));
      plant(p.productId, next, p.footprint);
      mine.push(next);
    }
  }
  // A small bed hemmed in by its neighbours' canopies still gets its plants, overlapping a little more
  if (placed.length === 0) {
    for (const p of order) {
      const ok = (q: Pt) => clear(q, p.footprint, 0.6);
      const spots = centreLine(poly, f, Math.max(0.05, (TOUCH * p.footprint) / 2), ok);
      const n = Math.min(p.n, spots.length);
      for (let i = 0; i < n; i++) {
        const q = spots.find(ok);
        if (!q) break;
        plant(p.productId, q, p.footprint);
      }
    }
    for (const p of order) {
      const got = placed.filter((q) => q.productId === p.productId).length;
      if (p.count !== undefined) { if (got < p.count) short[p.productId] = p.count - got; else delete short[p.productId]; }
    }
  }
  return { placed, short, layout };
}

/** A polyline with the points that add no turn left out (Douglas–Peucker, `tolerance` m) */
function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points;
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], points[0], points[points.length - 1]);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

const polyLength = (points: Pt[]) => points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

/**
 * A hedge along a zone: the zone's centreline as straight runs, and the zone's width across it. A zone
 * drawn as a corridor (a `path` zone: one side out, the other back) gives its own centreline, bends
 * included; any other zone a line down the middle along its longest edge.
 */
export function hedgeRuns(poly: Pt[]): { runs: Array<[Pt, Pt]>; width: number } {
  const n = poly.length;
  // A corridor: vertex i and vertex n-1-i face each other across it
  if (n >= 4 && n % 2 === 0) {
    const mids: Pt[] = [];
    const widths: number[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = poly[i], b = poly[n - 1 - i];
      mids.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      widths.push(Math.hypot(a.x - b.x, a.y - b.y));
    }
    const width = [...widths].sort((p, q) => p - q)[Math.floor(widths.length / 2)];
    const even = Math.max(...widths) <= 2.5 * Math.min(...widths);
    if (even && width > 0 && polyLength(mids) >= 2 * width) {
      const line = simplify(mids, Math.max(0.1, width / 4));
      return { runs: line.slice(1).map((p, i) => [line[i], p] as [Pt, Pt]), width };
    }
  }
  // Any other zone: down the middle along its main axis, following its cross-sections
  const f = frameOf(poly);
  const local = poly.map(f.toLocal);
  const { s0, s1 } = f.range;
  const step = Math.max(0.25, (s1 - s0) / 200);
  const centre: Pt[] = [];
  for (let s = s0 + 0.01; s <= s1 - 0.01 + 1e-9; s += step) {
    const cut = crossSection(local, s);
    if (cut) centre.push(f.toWorld(s, (cut[0] + cut[1]) / 2));
  }
  const width = minWidth(poly);
  if (centre.length < 2) return { runs: [], width };
  const line = simplify(centre, Math.max(0.1, width / 4));
  return { runs: line.slice(1).map((p, i) => [line[i], p] as [Pt, Pt]), width };
}

/** Canopy cover of a zone, added up: the plants whose centre is in it — the planting's own aim, plants of one layer touching */
export function coverOf(poly: Pt[], canopies: Canopy[]): number {
  const a = area(poly);
  return a ? canopies.filter((c) => inside(c, poly)).reduce((n, c) => n + canopyArea(c.footprint), 0) / a : 0;
}
