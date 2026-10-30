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

// ── Site analysis ──

export function siteAnalysis(boundary: Pt[], zones: Shape[], rotation: number) {
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
    howToUse: [
      "Doors and windows sit ON a facade line: pick a point between `from` and `to` of the facade on the side the brief or photos indicate (e.g. 30% along: from + 0.3·(to−from)).",
      "`gardenDepth` is the free distance from the facade midpoint straight out to the parcel boundary — compare it with the minimum size of anything you want to place on that side (a terrace for 6 needs ≥3.5 m).",
      "A facade with `sharedWallWith` is a party wall: no doors, no garden in front of it.",
      "`outward` is the facade's unit normal; a pin 0.3–0.5 m out from the facade along it marks a door clearly.",
    ],
  };
}

// ── Zone checks ──

/** Facts and warnings for each new or changed zone against the parcel and existing zones */
export function checkZones(targets: Shape[], all: Shape[], boundary: Pt[] | null) {
  return targets.map((t) => {
    const warnings: string[] = [];
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
