// Site geometry for agents: house facades, garden depth per side, and zone checks
// (area, narrowest width, parcel overflow, overlaps). Metres, x right / y down.

import { DPM } from "./units.js";

export interface Pt { x: number; y: number }

interface RawZone {
  id: string; zoneType: string; x: number; y: number; width: number; height: number;
  points?: Pt[]; label?: string; locked?: boolean; parcelBuildingId?: string;
}
export interface Shape { id: string; zoneType: string; label?: string; locked?: boolean; parcelBuildingId?: string; poly: Pt[] }

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const rp = (p: Pt): Pt => ({ x: round(p.x), y: round(p.y) });

/** Editor-unit zone (dots, relative points) → absolute polygon in metres */
export function zoneShape(z: RawZone): Shape {
  const cx = z.x / DPM, cy = z.y / DPM;
  const poly = z.points && z.points.length >= 3
    ? z.points.map((p) => ({ x: cx + p.x / DPM, y: cy + p.y / DPM }))
    : rect(cx, cy, z.width / DPM, z.height / DPM);
  return { id: z.id, zoneType: z.zoneType, label: z.label, locked: z.locked, parcelBuildingId: z.parcelBuildingId, poly };
}

/** Editor-unit boundary ({x,y,points} in dots) → absolute polygon in metres */
export function boundaryShape(b: { x: number; y: number; points: Pt[] }): Pt[] {
  return b.points.map((p) => ({ x: (b.x + p.x) / DPM, y: (b.y + p.y) / DPM }));
}

const rect = (cx: number, cy: number, w: number, h: number): Pt[] => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];

export function area(poly: Pt[]): number {
  return Math.abs(signedArea(poly));
}
function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return s / 2;
}
export function centroid(poly: Pt[]): Pt {
  const n = poly.length;
  return { x: poly.reduce((a, p) => a + p.x, 0) / n, y: poly.reduce((a, p) => a + p.y, 0) / n };
}
export function inside(pt: Pt, poly: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function bbox(poly: Pt[]) {
  return poly.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), y0: Math.min(b.y0, p.y), x1: Math.max(b.x1, p.x), y1: Math.max(b.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
}
const STEP = 0.1; // sampling grid, m
/** Overlap area of two polygons (m², 0.1 m sampling) */
export function overlapArea(a: Pt[], b: Pt[]): number {
  const A = bbox(a), B = bbox(b);
  const x0 = Math.max(A.x0, B.x0), x1 = Math.min(A.x1, B.x1), y0 = Math.max(A.y0, B.y0), y1 = Math.min(A.y1, B.y1);
  if (x0 >= x1 || y0 >= y1) return 0;
  let n = 0;
  for (let x = x0 + STEP / 2; x < x1; x += STEP) for (let y = y0 + STEP / 2; y < y1; y += STEP)
    if (inside({ x, y }, a) && inside({ x, y }, b)) n++;
  return n * STEP * STEP;
}
/** Area of a polygon lying outside a container (m²) */
export function outsideArea(poly: Pt[], container: Pt[]): number {
  const B = bbox(poly);
  let n = 0;
  for (let x = B.x0 + STEP / 2; x < B.x1; x += STEP) for (let y = B.y0 + STEP / 2; y < B.y1; y += STEP)
    if (inside({ x, y }, poly) && !inside({ x, y }, container)) n++;
  return n * STEP * STEP;
}
/** Narrowest width: exact calipers for convex shapes; for winding strips (paths, hedges)
 *  area ÷ half-perimeter, since their extent in any direction includes the bends */
export function minWidth(poly: Pt[]): number {
  let calipers = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.05) continue;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const proj = poly.map((p) => p.x * nx + p.y * ny);
    calipers = Math.min(calipers, Math.max(...proj) - Math.min(...proj));
  }
  const a = area(poly);
  if (a >= 0.9 * area(convexHull(poly))) return calipers;
  const perimeter = poly.reduce((s, p, i) => s + Math.hypot(poly[(i + 1) % poly.length].x - p.x, poly[(i + 1) % poly.length].y - p.y), 0);
  return Math.min(calipers, (2 * a) / perimeter);
}

function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [], upper: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// ── Compass ──

const SIDES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Compass bearing (deg clockwise from north) of a screen direction; rotation = garden north rotation */
function bearing(dx: number, dy: number, rotation: number): number {
  return (((Math.atan2(dx, -dy) * 180) / Math.PI + rotation) % 360 + 360) % 360;
}
const sideOf = (deg: number) => SIDES[Math.round(deg / 45) % 8];

/** Distance from p along unit direction d to the first crossing of any polygon edge */
function rayToPolygon(p: Pt, d: Pt, poly: Pt[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den;
    const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
    if (t > 1e-6 && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}
function segDist(p: Pt, a: Pt, b: Pt): number {
  const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey);
}
function edgeNearPolygon(a: Pt, b: Pt, poly: Pt[], tol: number): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return poly.some((_, i) => segDist(mid, poly[i], poly[(i + 1) % poly.length]) < tol);
}
const perimeter = (poly: Pt[]) => poly.reduce((t, a, i) => { const b = poly[(i + 1) % poly.length]; return t + Math.hypot(b.x - a.x, b.y - a.y); }, 0);
const polyDist = (p: Pt, poly: Pt[]) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));
/** A fence drawn as a building: thin — area over perimeter under 0.25 m, i.e. under about 0.5 m wide */
const isFence = (b: Shape) => area(b.poly) < 0.25 * perimeter(b.poly);

// ── Site analysis ──

/** From this much garden (the parcel less the house) a garden is large: zoned in steps (SC-231) */
export const LARGE_GARDEN_M2 = 400;

/**
 * The site's main directions in the tool's coordinates, degrees from east (y south), mod 180: the house's walls
 * and the boundary's edges of 5 m or more, longest first, those within 2° of each other merged (SC-230)
 */
export function siteAxes(boundary: Pt[], house: Pt[] | null): Array<{ deg: number; from: string }> {
  const edges = [
    ...(house ?? []).map((a, i, p) => ({ a, b: p[(i + 1) % p.length], from: "house", min: 1 })),
    ...boundary.map((a, i, p) => ({ a, b: p[(i + 1) % p.length], from: "boundary", min: 5 })),
  ].map((e) => ({ ...e, len: Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) }))
    .filter((e) => e.len >= e.min)
    .sort((x, y) => y.len - x.len);
  const out: Array<{ deg: number; from: string }> = [];
  for (const e of edges) {
    const deg = ((Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x) * 180) / Math.PI + 360) % 180;
    const near = out.find((o) => { const d = Math.abs(o.deg - deg) % 180; return Math.min(d, 180 - d) <= 2; });
    if (near) { if (!near.from.split("+").includes(e.from)) near.from += `+${e.from}`; continue; }
    out.push({ deg: round(deg, 1), from: e.from });
  }
  return out;
}

/**
 * The garden left without a zone: cells of a 0.5 m grid inside the boundary, outside every building, that no zone
 * covers, joined into patches (diagonal neighbours too, so a thin slanted sliver stays one patch); the largest first,
 * down to slivers of 1 m², each with its area, centre, extent and what it lies between — the zones, a building or
 * the boundary — so the agent finds the gaps itself and knows whose edge to move, rather than the user pointing at
 * them (SC-237). Pieces under 3 m² are gathered by what they lie between: a zone edge running just off a slanted fence
 * leaves a thin gap the grid breaks into dozens of pieces, and that gap is listed as one patch with its `bits`. Ground
 * that touches only the plot line and a fence drawn as a thin building lies outside the fence and is left out.
 */
export function blankAreas(boundary: Pt[], zones: Shape[], maxPatches = 12) {
  const G = 0.5;
  const MIN_CELLS = 4;     // 1 m² listed: a lone smaller piece is the grid catching a curved edge, not a gap anyone sees
  const PIECE_CELLS = 12;  // under 3 m² a piece is gathered with the others along the same edge
  const xs = boundary.map((p) => p.x), ys = boundary.map((p) => p.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const nx = Math.ceil((Math.max(...xs) - x0) / G), ny = Math.ceil((Math.max(...ys) - y0) / G);
  const buildings = zones.filter((z) => z.zoneType === "building");
  const cover = zones.filter((z) => z.zoneType !== "building");
  // the ground between a fence and the plot line is outside the garden, not a gap to fill
  const fenceShapes = buildings.filter(isFence);
  const fences = new Set(fenceShapes.map((b) => b.id));
  // a fence thinner than the grid falls between its points, so the strip outside it is found by distance too:
  // within half a metre of a fence and three quarters of a metre of the plot line
  const atFence = (p: Pt) => fenceShapes.some((f) => polyDist(p, f.poly) <= 0.5) && polyDist(p, boundary) <= 0.75;
  let outside = 0;
  // what holds each cell: -1 blank, -2 outside the boundary, else the index of the zone or building in `holders`
  const holders = [...cover, ...buildings];
  const held = new Int32Array(nx * ny).fill(-2);
  let garden = 0, empty = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = { x: x0 + (i + 0.5) * G, y: y0 + (j + 0.5) * G };
    if (!inside(p, boundary)) continue;
    const b = buildings.findIndex((z) => inside(p, z.poly));
    if (b >= 0) { held[j * nx + i] = cover.length + b; continue; }
    const c = cover.findIndex((z) => inside(p, z.poly));
    if (c < 0 && fenceShapes.length && atFence(p)) continue;   // outside the fence: not garden
    garden++;
    held[j * nx + i] = c;
    if (c < 0) empty++;
  }
  type Cells = { n: number; sx: number; sy: number; i0: number; i1: number; j0: number; j1: number; between: string[]; bits: number };
  const patchOf = (c: Cells) => ({
    areaM2: round(c.n * G * G, 1),
    centre: rp({ x: x0 + (c.sx / c.n + 0.5) * G, y: y0 + (c.sy / c.n + 0.5) * G }),
    from: rp({ x: x0 + c.i0 * G, y: y0 + c.j0 * G }),
    to: rp({ x: x0 + (c.i1 + 1) * G, y: y0 + (c.j1 + 1) * G }),
    between: c.between,
    ...(c.bits > 1 ? { bits: c.bits } : {}),
  });
  const patches: Array<ReturnType<typeof patchOf>> = [];
  const crumbs = new Map<string, Cells>();
  const seen = new Uint8Array(nx * ny);
  for (let s = 0; s < held.length; s++) {
    if (held[s] !== -1 || seen[s]) continue;
    let n = 0, sx = 0, sy = 0, i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
    const around = new Map<string, number>();
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % nx, j = (c - i) / nx;
      n++; sx += i; sy += j;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj, q = jj * nx + ii;
        const h = ii >= 0 && ii < nx && jj >= 0 && jj < ny ? held[q] : -2;
        if (h === -1) { if (!seen[q]) { seen[q] = 1; stack.push(q); } continue; }
        if (di && dj) continue;   // what a patch lies between: its side neighbours only
        const name = h === -2 ? "boundary" : holders[h].id;
        around.set(name, (around.get(name) ?? 0) + 1);
      }
    }
    if ([...around.keys()].every((k) => k === "boundary" || fences.has(k))) { outside += n; continue; }   // outside a fence
    const between = [...around].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name);
    if (n >= PIECE_CELLS) { patches.push(patchOf({ n, sx, sy, i0, i1, j0, j1, between, bits: 1 })); continue; }
    // a piece: often one of many a zone edge leaves when it runs just off a fence or another zone — gathered by what
    // it lies between, so a long thin gap reads as one patch rather than forty small ones filling the list
    const key = between.slice(0, 2).sort().join("|");
    const g = crumbs.get(key);
    if (!g) { crumbs.set(key, { n, sx, sy, i0, i1, j0, j1, between, bits: 1 }); continue; }
    g.n += n; g.sx += sx; g.sy += sy; g.bits++;
    g.i0 = Math.min(g.i0, i0); g.i1 = Math.max(g.i1, i1); g.j0 = Math.min(g.j0, j0); g.j1 = Math.max(g.j1, j1);
  }
  for (const g of crumbs.values()) if (g.n >= MIN_CELLS) patches.push(patchOf(g));
  patches.sort((a, b) => b.areaM2 - a.areaM2);
  const shown = patches.slice(0, maxPatches);
  const shownM2 = shown.reduce((t, p) => t + p.areaM2, 0);
  empty -= outside; garden -= outside;
  return {
    m2: round(empty * G * G, 1), shareOfGarden: garden ? round(empty / garden, 3) : 0,
    patches: shown, morePatches: Math.max(0, patches.length - maxPatches),
    unlistedM2: round(empty * G * G - shownM2, 1),
  };
}

type ViewPin = { id: string; pinType: string; x: number; y: number; label?: string };

/** Where people stay in a garden: what a bad view is screened from */
const PLACE_KINDS = new Set(["terrace", "relaxation", "activity", "lawn"]);

/** A crown on the plan (a plant shape), metres; a hedge comes as circles along its line */
export interface Crown { x: number; y: number; footprint: number; heightM?: number }

/** Eye level at the place a bad view is seen from, and the top of what a bad view shows unless told: a neighbour's
 *  garden and ground floor (upper-floor windows are about 5 m) */
export const EYE_M = 1.6;
export const VIEW_TOP_M = 2;
/** The slants a bad view is looked at besides straight in, degrees off the plot line's normal */
const SLANTS = [30, -30, 50, -50, 65, -65];

/**
 * Each bad view (a `view_bad` pin): the plot line `reach` metres either side of it, looked at from inside. A sightline
 * straight in from the plot line that reaches a place people stay (a terrace, a seating or activity area, a lawn)
 * within `depth` metres, crossing no screen on the way — a privacy screen, tall planting, or a building that isn't a
 * fence — is the view still in sight: `seenFrom` gives that place and the stretch of plot line it sees (SC-238).
 * Once plant shapes stand in a screen zone, the zone no longer stands for its screen: the shapes do, where they reach
 * the line of sight from eye level at the place to the top of the view at the plot line (`viewHeights` by pin id,
 * else VIEW_TOP_M); a seen stretch then says the height needed where the screen stands (`needM`) and the tallest
 * planting on its line (`hasM`)
 */
export function badViews(boundary: Pt[], zones: Shape[], pins: ViewPin[], reach = 8, depth = 15,
  crowns: Crown[] = [], viewHeights: Record<string, number> = {}) {
  const screens = zones.filter((z) =>
    z.zoneType === "privacy_screen" || z.zoneType === "tall_plants" ||
    (z.zoneType === "building" && !isFence(z) && inside(centroid(z.poly), boundary)));
  const shaped = crowns.filter((c) => c.heightM !== undefined);
  // a screen zone with shapes in it is judged by them; an empty one (while zoning) stands for its screen
  const planted = new Set(screens.filter((z) => z.zoneType !== "building" && shaped.some((c) => inside(c, z.poly))).map((z) => z.id));
  const heightAt = (p: Pt) => shaped.reduce((h, c) =>
    Math.hypot(c.x - p.x, c.y - p.y) <= c.footprint / 2 ? Math.max(h, c.heightM!) : h, 0);
  const places = zones.filter((z) => PLACE_KINDS.has(z.zoneType));
  const edges = boundary.map((a, i) => ({ a, b: boundary[(i + 1) % boundary.length] }));
  const lens = edges.map(({ a, b }) => Math.hypot(b.x - a.x, b.y - a.y));
  const total = lens.reduce((t, l) => t + l, 0);
  // the point `s` metres along the plot line, with the unit normal pointing into the plot
  const along = (s: number): { q: Pt; n: Pt; i: number } => {
    s = ((s % total) + total) % total;
    let i = 0;
    while (i < edges.length - 1 && s > lens[i]) s -= lens[i++];
    const { a, b } = edges[i], l = lens[i] || 1, t = Math.min(1, s / l);
    const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    const n = { x: -(b.y - a.y) / l, y: (b.x - a.x) / l };
    return inside({ x: q.x + 0.1 * n.x, y: q.y + 0.1 * n.y }, boundary) ? { q, n, i } : { q, n: { x: -n.x, y: -n.y }, i };
  };
  return pins.filter((p) => p.pinType === "view_bad").map((pin) => {
    // where the pin meets the plot line, as metres along it
    let best = { d: Infinity, s: 0, i: 0 }, run = 0;
    edges.forEach(({ a, b }, i) => {
      const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey;
      const t = l2 ? Math.max(0, Math.min(1, ((pin.x - a.x) * ex + (pin.y - a.y) * ey) / l2)) : 0;
      const d = Math.hypot(pin.x - a.x - t * ex, pin.y - a.y - t * ey);
      if (d < best.d) best = { d, s: run + t * lens[i], i };
      run += lens[i];
    });
    const top = viewHeights[pin.id] ?? VIEW_TOP_M;
    const seen: Array<{ zone: string; label: string | null; from: Pt; to: Pt; needM?: number; hasM?: number }> = [];
    let current: (typeof seen)[number] | null = null;
    // One sightline in from the plot line at `q` along `n`: the place it reaches unscreened, if any
    const look = (q: Pt, n: Pt, reachIn: number) => {
      let place: Shape | null = null, at = 0;
      const line: Array<{ t: number; h: number; screen: boolean }> = [];   // the planting on the way
      for (let t = 0.25; t <= reachIn; t += 0.25) {
        const p = { x: q.x + t * n.x, y: q.y + t * n.y };
        if (!inside(p, boundary)) break;
        const screen = screens.find((z) => inside(p, z.poly));
        if (screen && !planted.has(screen.id)) break;
        const h = heightAt(p);
        if (h > 0 || screen) line.push({ t, h, screen: !!screen });
        place = places.find((z) => inside(p, z.poly)) ?? null;
        if (place) { at = t; break; }
      }
      // the line of sight from the eye, a metre into the place, to the top of the view at the plot line
      const need = (t: number) => top + ((EYE_M - top) * t) / (at + 1);
      if (place && line.some((s) => s.h >= need(s.t))) place = null;
      return { place, line, need };
    };
    for (let k = -reach * 2; k <= reach * 2; k++) {   // a sightline every 0.5 m
      const { q, n: normal, i: edge } = along(best.s + k / 2);
      // straight in, then slanting either way along the pin's own side: a place further along the fence sees
      // the view at an angle
      let sight = look(q, normal, depth);
      for (const deg of edge === best.i ? SLANTS : []) {
        if (sight.place) break;
        const c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180);
        sight = look(q, { x: normal.x * c - normal.y * s, y: normal.x * s + normal.y * c }, depth / c);
      }
      const { place, line, need } = sight;
      if (!place) { current = null; continue; }
      const where = line.find((s) => s.screen) ?? line.reduce<(typeof line)[number] | null>((a, s) => (!a || s.h > a.h ? s : a), null);
      const needM = where ? Math.round(need(where.t) * 10) / 10 : undefined;
      const hasM = where ? Math.round(Math.max(...line.map((s) => s.h)) * 10) / 10 : undefined;
      const last = current as (typeof seen)[number] | null;   // (the loop's narrowing loses the stretch carried over)
      if (last?.zone === place.id) {
        last.to = rp(q);
        if (needM !== undefined) { last.needM = Math.max(last.needM ?? 0, needM); last.hasM = Math.min(last.hasM ?? Infinity, hasM!); }
      } else {
        seen.push(current = { zone: place.id, label: place.label ?? null, from: rp(q), to: rp(q), ...(needM !== undefined ? { needM, hasM } : {}) });
      }
    }
    return { id: pin.id, label: pin.label ?? null, seenFrom: seen };
  });
}

export function siteAnalysis(boundary: Pt[], zones: Shape[], rotation: number, pins: ViewPin[] = [],
  crowns: Crown[] = [], viewHeights: Record<string, number> = {}) {
  const buildings = zones.filter((z) => z.zoneType === "building");
  const inParcel = buildings.filter((b) => inside(centroid(b.poly), boundary));
  const house = [...inParcel].sort((a, b) => area(b.poly) - area(a.poly))[0];
  const ccw = signedArea(boundary) < 0; // orientation in y-down screen space

  const parcelEdges = boundary.map((a, i) => {
    const b = boundary[(i + 1) % boundary.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (ccw ? (b.y - a.y) : -(b.y - a.y)) / len, ny = (ccw ? -(b.x - a.x) : (b.x - a.x)) / len;
    return { side: sideOf(bearing(nx, ny, rotation)), length: round(len, 1), from: rp(a), to: rp(b) };
  });

  if (!house) {
    return {
      parcel: { areaM2: round(area(boundary), 1), edges: parcelEdges },
      house: null,
      note: "No building centred inside the parcel. Call import_buildings first, or draw the house as a 'building' zone.",
    };
  }

  const hp = house.poly;
  const hccw = signedArea(hp) < 0;
  const others = buildings.filter((b) => b.id !== house.id);
  const facades = hp.map((a, i) => {
    const b = hp[(i + 1) % hp.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = (hccw ? (b.y - a.y) : -(b.y - a.y)) / len, ny = (hccw ? -(b.x - a.x) : (b.x - a.x)) / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const sharedWith = others.find((o) => edgeNearPolygon(a, b, o.poly, 0.5));
    const toBoundary = rayToPolygon(mid, { x: nx, y: ny }, boundary);
    const facesOutOfParcel = !inside({ x: mid.x + nx * 0.3, y: mid.y + ny * 0.3 }, boundary);
    return {
      side: sideOf(bearing(nx, ny, rotation)),
      length: round(len, 1),
      from: rp(a), to: rp(b), midpoint: rp(mid),
      outward: { x: round(nx, 3), y: round(ny, 3) },
      sharedWallWith: sharedWith?.id ?? null,
      gardenDepth: sharedWith || facesOutOfParcel || toBoundary === null ? 0 : round(toBoundary, 1),
    };
  }).filter((f) => f.length >= 1);

  const neighbours = others.map((o) => {
    const c = centroid(o.poly), hc = centroid(hp);
    return {
      id: o.id, label: o.label ?? null,
      relation: hp.some((a, i) => edgeNearPolygon(a, hp[(i + 1) % hp.length], o.poly, 0.5)) ? "attached (shared wall)" : "detached",
      direction: sideOf(bearing(c.x - hc.x, c.y - hc.y, rotation)),
      distance: round(Math.hypot(c.x - hc.x, c.y - hc.y), 1),
    };
  });

  return {
    parcel: { areaM2: round(area(boundary), 1), edges: parcelEdges },
    house: {
      id: house.id, parcelBuildingId: house.parcelBuildingId ?? null,
      footprintM2: round(area(hp), 1), centre: rp(centroid(hp)),
      facades,
    },
    neighbours,
    gardenAreaM2: round(area(boundary) - (area(hp) - outsideArea(hp, boundary)), 1),
    largeGarden: area(boundary) - (area(hp) - outsideArea(hp, boundary)) >= LARGE_GARDEN_M2,
    axes: siteAxes(boundary, hp),
    blank: blankAreas(boundary, zones),
    ...(pins.some((p) => p.pinType === "view_bad") ? { badViews: badViews(boundary, zones, pins, 8, 15, crowns, viewHeights) } : {}),
    howToUse: [
      "Doors and windows sit ON a facade line: pick a point between `from` and `to` of the facade on the side the brief or photos indicate (e.g. 30% along: from + 0.3·(to−from)).",
      "`gardenDepth` is the free distance from the facade midpoint straight out to the parcel boundary — compare it with the minimum size of anything you want to place on that side (a terrace for 6 needs ≥3.5 m).",
      "A facade with `sharedWallWith` is a party wall: no doors, no garden in front of it.",
      "`outward` is the facade's unit normal; a pin 0.3–0.5 m out from the facade along it marks a door clearly.",
      "`axes` are the site's main directions (degrees from east, y south): draw zone edges along them — the house walls and the fences — not along north/east, unless an axis runs north.",
      `\`largeGarden\` (${LARGE_GARDEN_M2} m² of garden or more): zone it in steps — feasibility and style first, your concept, the spaces, their connections, then each space — with a sign-off after each (the guide's Step 2 › Large garden).`,
      "`trees` are the trees standing on the plot, each with its trunk and crown width: draw zones under and round a tree by its real crown, not by eye.",
      "`blank` is the garden no zone covers yet, its largest patches first down to thin slivers (`from`–`to` is each patch's extent; `between` is what it lies between — zones, a building, the `boundary` — so you know whose edge to move to close it; a patch with `bits` is a thin gap in that many pieces along the same edge, e.g. a zone stopping just short of the fence): call this again after each step and, before you report, fill each patch or say what it is for (e.g. the corridor the next step's path takes). `unlistedM2` is blank left off the list (bits under 1 m², or past the first patches; `morePatches` > 0: call again once the listed ones are closed). After the paths step the corridors are paths: a patch left then is a gap the user sees on the plan, slivers too.",
      "`badViews` takes each bad view (a `view_bad` pin) with the plot line 8 m either side of it, looked at from inside: `seenFrom` lists each place people stay (a terrace, a seating or activity area, a lawn) that sees part of that stretch with no privacy screen, tall planting or building between — `from`–`to` is the stretch it sees. Before you report a step, screen each, or say why it stays open. Once plant shapes stand in a screen, they are the screen: a line of sight is closed only where they reach it, from eye level (1.6 m) at the place to the top of the view at the plot line (2 m — a neighbour's garden and ground floor — unless you give `viewHeights`, e.g. `{ \"<pin id>\": 5 }` for upper-floor windows); a stretch still seen past planting gives `needM`, the height needed where the screen stands, and `hasM`, the tallest planting on its line — raise the screen there or close its gaps.",
    ],
  };
}

// ── Zone checks ──

/** Facts and warnings for each new or changed zone against the parcel and existing zones */
/** Ground a tree's trunk can't stand in: paving, a path, a terrace, parking, an entry */
const HARD_GROUND = new Set(["path", "terrace", "parking", "entry"]);

/** A tree on the plan by its trunk: a plant the size of a tree, or a tree shape */
export interface Trunk { id: string; label: string | null; x: number; y: number }

/**
 * The trees whose trunk a hard zone covers. One of the two is likely misplaced: an aerial photo shows a tree's crown,
 * not its trunk, and a crown by a fence or a drive can hang over it — ask before paving over a trunk
 */
export function trunksUnder(zones: Shape[], trunks: Trunk[]) {
  const out: Array<{ zone: string; zoneType: string; tree: string; label: string | null; at: Pt }> = [];
  for (const z of zones) {
    if (!HARD_GROUND.has(z.zoneType)) continue;
    for (const t of trunks) if (inside(t, z.poly)) out.push({ zone: z.id, zoneType: z.zoneType, tree: t.id, label: t.label, at: rp(t) });
  }
  return out;
}

const trunkWarning = (u: ReturnType<typeof trunksUnder>[number]) =>
  `covers the trunk of tree ${u.tree}${u.label ? ` ("${u.label}")` : ""} at (${u.at.x}, ${u.at.y}): ask whether the trunk really stands there or only the crown hangs over (an aerial photo shows the crown), then move the zone's edge off the trunk or the tree to its trunk`;

/** A tree placed or moved with its trunk in a hard zone: the warning the object call answers with */
export function treesOnHardGround(zones: Shape[], trunks: Trunk[]): string[] {
  return trunksUnder(zones, trunks).map((u) =>
    `tree ${u.tree}${u.label ? ` ("${u.label}")` : ""} stands with its trunk in ${u.zoneType} ${u.zone} at (${u.at.x}, ${u.at.y}): ask whether the trunk really stands there or only the crown hangs over (an aerial photo shows the crown)`);
}

export function checkZones(targets: Shape[], all: Shape[], boundary: Pt[] | null, trunks: Trunk[] = []) {
  return targets.map((t) => {
    const warnings: string[] = trunksUnder([t], trunks).map(trunkWarning);
    const a = area(t.poly);
    if (boundary) {
      const out = outsideArea(t.poly, boundary);
      if (out > 0.2) warnings.push(`${round(out, 1)} m² lies outside the parcel boundary`);
    }
    for (const o of all) {
      if (o.id === t.id) continue;
      const m2 = overlapArea(t.poly, o.poly);
      if (m2 < 0.2) continue;
      if (o.zoneType === "building") warnings.push(`overlaps building ${o.id} by ${round(m2, 1)} m²`);
      else if (o.locked) warnings.push(`overlaps LOCKED zone ${o.id} (${o.zoneType}) by ${round(m2, 1)} m²`);
      else warnings.push(`overlaps ${o.id} (${o.zoneType}${o.label ? `, "${o.label}"` : ""}) by ${round(m2, 1)} m²`);
    }
    const bb = bbox(t.poly);
    return {
      id: t.id, zoneType: t.zoneType,
      areaM2: round(a, 1), narrowestWidth: round(minWidth(t.poly), 2),
      bounds: { x0: round(bb.x0, 1), y0: round(bb.y0, 1), x1: round(bb.x1, 1), y1: round(bb.y1, 1) },
      warnings,
    };
  });
}

// ── Authoring helpers ──

/** Absolute polygon (m) → editor zone fields: centre + relative points + size */
export function fromAbsolutePolygon(poly: Pt[]) {
  const bb = bbox(poly);
  const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
  return {
    x: cx, y: cy, width: bb.x1 - bb.x0, height: bb.y1 - bb.y0,
    points: poly.map((p) => ({ x: p.x - cx, y: p.y - cy })),
  };
}

/** Centreline + width → corridor polygon (m), mitred joins */
export function pathPolygon(waypoints: Pt[], width: number): Pt[] {
  const h = width / 2;
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const p = waypoints[i];
    const prev = waypoints[Math.max(0, i - 1)], next = waypoints[Math.min(waypoints.length - 1, i + 1)];
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    // Mitre: scale the offset so the corridor keeps its width through bends (capped)
    let scale = 1;
    if (i > 0 && i < waypoints.length - 1) {
      const ax = p.x - prev.x, ay = p.y - prev.y, la = Math.hypot(ax, ay) || 1;
      const cos = (ax / la) * dx + (ay / la) * dy;
      scale = Math.min(2, 1 / Math.max(0.5, cos));
    }
    left.push({ x: p.x - dy * h * scale, y: p.y + dx * h * scale });
    right.push({ x: p.x + dy * h * scale, y: p.y - dx * h * scale });
  }
  return [...left, ...right.reverse()];
}

// ── Pin checks ──

/** Where each opening pin sits: nearest facade, position along it, and placement warnings */
export function checkPins(pins: Array<{ id: string; pinType: string; x: number; y: number }>, zones: Shape[], boundary: Pt[] | null, rotation: number) {
  const buildings = zones.filter((z) => z.zoneType === "building");
  const house = boundary
    ? [...buildings.filter((b) => inside(centroid(b.poly), boundary))].sort((a, b) => area(b.poly) - area(a.poly))[0]
    : undefined;
  return pins.map((pin) => {
    const warnings: string[] = [];
    let onFacade: string | null = null;
    if (["door", "patio_door", "window"].includes(pin.pinType) && buildings.length) {
      let best: { b: Shape; i: number; d: number; t: number } | null = null;
      for (const b of buildings) for (let i = 0; i < b.poly.length; i++) {
        const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
        const ex = c.x - a.x, ey = c.y - a.y, l2 = ex * ex + ey * ey;
        const t = l2 ? Math.max(0, Math.min(1, ((pin.x - a.x) * ex + (pin.y - a.y) * ey) / l2)) : 0;
        const d = Math.hypot(pin.x - a.x - t * ex, pin.y - a.y - t * ey);
        if (!best || d < best.d) best = { b, i, d, t };
      }
      if (best) {
        const { b, i, d, t } = best;
        const a = b.poly[i], c = b.poly[(i + 1) % b.poly.length];
        const ccw = signedArea(b.poly) < 0;
        const len = Math.hypot(c.x - a.x, c.y - a.y);
        const nx = (ccw ? (c.y - a.y) : -(c.y - a.y)) / len, ny = (ccw ? -(c.x - a.x) : (c.x - a.x)) / len;
        const side = sideOf(bearing(nx, ny, rotation));
        const startSide = sideOf(bearing(a.x - c.x, a.y - c.y, rotation));
        const isHouse = house && b.id === house.id;
        onFacade = `${isHouse ? "house" : `building ${b.id}`} ${side} facade, ${Math.round(t * 100)}% along from its ${startSide} end, ${round(d, 1)} m from the wall`;
        if (house && !isHouse) warnings.push(`nearest wall belongs to ${b.id}, not the user's house ${house.id}`);
        if (d > 1.5) warnings.push(`${round(d, 1)} m from the nearest wall — a ${pin.pinType} pin should sit on a facade`);
        const shared = buildings.some((o) => o.id !== b.id && edgeNearPolygon(a, c, o.poly, 0.5));
        if (shared) warnings.push("this wall is a party wall shared with the neighbour");
      }
    }
    if (boundary && !inside(pin, boundary)) warnings.push("outside the parcel boundary");
    return { id: pin.id, pinType: pin.pinType, onFacade, warnings };
  });
}
