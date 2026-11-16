// Planting cover of an area, counted once and per height layer (SC-117): where plants at different
// heights overlap — something planted under a tree — the ground beneath them counts once, not twice.
// The layers go by a plant's height, alike for a species and a generic plant shape. Browser-safe
// (no Node imports); metres throughout. The zone analysis and plant_zones both count with it.

export type HeightLayer = "ground" | "shrub" | "tree";
export const LAYERS: readonly HeightLayer[] = ["ground", "shrub", "tree"];

/** Where the lower layers end, m: ground cover and low plants under 0.5, shrubs under 3, trees from 3 */
export const LAYER_TOPS = { ground: 0.5, shrub: 3 } as const;

export function layerOf(heightM: number): HeightLayer {
  return heightM < LAYER_TOPS.ground ? "ground" : heightM < LAYER_TOPS.shrub ? "shrub" : "tree";
}

/**
 * What a plant or a shape covers, seen from above: a crown (circle), an oval crown or mat, or a
 * rectangle (a hedge, a climber's panel), turned by `rotation` degrees. With no `heightM` it counts
 * in the cover but in no layer.
 */
export type Footprint =
  | { kind: "circle"; x: number; y: number; diameter: number; heightM?: number }
  | { kind: "oval" | "rect"; x: number; y: number; width: number; depth: number; rotation: number; heightM?: number };

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface LayeredCover {
  /** Share of the area covered by planting of any height, counted once (0–1) */
  cover: number;
  /** Share of the area each layer covers on its own (0–1) */
  layers: Record<HeightLayer, number>;
  /** The footprints standing in the area (by their centre), added up with every overlap (0–1+) */
  footprintSum: number;
  /** Plants of one layer crowding each other: the layer's footprints add up to far more than it covers */
  crowded: boolean;
}

/** How far a layer's added-up footprints may exceed its counted-once cover before it reads as crowded */
const CROWDED = 1.5;
/** Grid cells sampled at most: about 0.1 m apart on a bed, coarser on a large lawn */
const MAX_CELLS = 40000;

export function footprintArea(f: Footprint): number {
  if (f.kind === "circle") return Math.PI * (f.diameter / 2) ** 2;
  return f.kind === "oval" ? (Math.PI * f.width * f.depth) / 4 : f.width * f.depth;
}

function reach(f: Footprint): number {
  return f.kind === "circle" ? f.diameter / 2 : f.kind === "oval" ? Math.max(f.width, f.depth) / 2 : Math.hypot(f.width, f.depth) / 2;
}

function covers(f: Footprint, px: number, py: number): boolean {
  const dx = px - f.x;
  const dy = py - f.y;
  if (f.kind === "circle") return dx * dx + dy * dy <= (f.diameter / 2) ** 2;
  const a = (f.rotation * Math.PI) / 180;
  const u = dx * Math.cos(a) + dy * Math.sin(a);
  const v = -dx * Math.sin(a) + dy * Math.cos(a);
  if (f.kind === "oval") return f.width > 0 && f.depth > 0 && (2 * u / f.width) ** 2 + (2 * v / f.depth) ** 2 <= 1;
  return Math.abs(u) <= f.width / 2 && Math.abs(v) <= f.depth / 2;
}

/**
 * The cover of the area `inside` tells apart within `bounds`, sampled on a grid: each sample point
 * counts once however many footprints reach it, and once in each layer one of that layer's reaches.
 */
export function layeredCover(bounds: Bounds, inside: (p: { x: number; y: number }) => boolean, footprints: Footprint[]): LayeredCover {
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  const step = Math.max(0.1, Math.sqrt((width * height) / MAX_CELLS));
  const nx = Math.max(1, Math.ceil(width / step));
  const ny = Math.max(1, Math.ceil(height / step));
  const at = (i: number, j: number) => ({ x: bounds.minX + (i + 0.5) * step, y: bounds.minY + (j + 0.5) * step });

  const inArea = new Uint8Array(nx * ny);
  let cells = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (inside(at(i, j))) { inArea[j * nx + i] = 1; cells++; }
  const empty: LayeredCover = { cover: 0, layers: { ground: 0, shrub: 0, tree: 0 }, footprintSum: 0, crowded: false };
  if (cells === 0) return empty;

  const any = new Uint8Array(nx * ny);
  const byLayer: Record<HeightLayer, Uint8Array> = { ground: new Uint8Array(nx * ny), shrub: new Uint8Array(nx * ny), tree: new Uint8Array(nx * ny) };
  const sums: Record<HeightLayer, number> = { ground: 0, shrub: 0, tree: 0 };
  let sum = 0;
  const areaM2 = cells * step * step;
  for (const f of footprints) {
    const layer = f.heightM === undefined ? null : layerOf(f.heightM);
    if (inside(f)) {
      sum += footprintArea(f);
      if (layer) sums[layer] += footprintArea(f);
    }
    const r = reach(f);
    const i0 = Math.max(0, Math.floor((f.x - r - bounds.minX) / step));
    const i1 = Math.min(nx - 1, Math.floor((f.x + r - bounds.minX) / step));
    const j0 = Math.max(0, Math.floor((f.y - r - bounds.minY) / step));
    const j1 = Math.min(ny - 1, Math.floor((f.y + r - bounds.minY) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * nx + i;
        if (!inArea[k]) continue;
        const p = at(i, j);
        if (!covers(f, p.x, p.y)) continue;
        any[k] = 1;
        if (layer) byLayer[layer][k] = 1;
      }
    }
  }
  const share = (mask: Uint8Array) => mask.reduce((n, v) => n + v, 0) / cells;
  const layers = { ground: share(byLayer.ground), shrub: share(byLayer.shrub), tree: share(byLayer.tree) };
  const crowded = LAYERS.some((l) => layers[l] > 0 && sums[l] / areaM2 > CROWDED * layers[l]);
  return { cover: share(any), layers, footprintSum: sum / areaM2, crowded };
}

/** The bounds of a polygon */
export function boundsOf(poly: Array<{ x: number; y: number }>): Bounds {
  return {
    minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)),
    minY: Math.min(...poly.map((p) => p.y)), maxY: Math.max(...poly.map((p) => p.y)),
  };
}
