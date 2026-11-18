// Tool dispatch — what a tool call does, over an injected call into the editor.
// Browser-safe (no Node imports): the MCP server sends over its WebSocket, the editor's
// built-in agent calls the bridge directly (SC-147…SC-150).

import {
  setUnitPreference,
  getUnitPreference,
  convertInputToEditor,
  convertOutputToMeters,
  convertProductSizesToMeters,
  DPM,
  shouldConvertInput,
  shouldConvertOutput,
} from "./units.js";
import type { UnitPreference } from "./units.js";
import {
  zoneShape,
  boundaryShape,
  siteAnalysis,
  checkZones,
  checkPins,
  fromAbsolutePolygon,
  pathPolygon,
  inside,
  type Pt,
} from "./geometry.js";
import { replyText } from "./slim.js";
import { planPlanting, hedgeRuns, bedDepth, type Canopy, type PlantChoice } from "./planting.js";
import { layeredCover, layerOf, boundsOf } from "./coverage.js";

/** Zones whose ground takes no plants: plant_zones keeps plant centres out of them */
const NO_PLANTING = new Set(["terrace", "path", "building", "entry", "parking", "lawn"]);

/** How high a zone stands, for the side a bed is seen from: its front faces lower ground — paths, lawns,
 *  terraces, places to sit or play, lower planting; buildings and fences are never a front */
const STANDS: Record<string, number> = {
  terrace: 0, path: 0, lawn: 0, entry: 0, parking: 0, relaxation: 0, activity: 0, utility: 0,
  herbs: 1, low_plants: 1, wild: 1, tall_plants: 2, privacy_screen: 3,
};

interface PlantZoneSpec {
  zoneId: string;
  plants?: Array<{
    productId?: string | number; shape?: string; width?: number; tall?: number;
    share?: number; count?: number; label?: string; notes?: string;
  }>;
  layout?: "groups" | "row";
  coverage?: number;
  replace?: boolean;
}

/** A shape as the editor sized it, metres (planting_sizes) */
interface ShapeSize {
  kind: string; widthM: number; depthM: number; heightM: number;
  depthRange?: [number, number]; warnings?: string[]; error?: string;
}

/** planting_sizes: plant heights from the plant index, shapes sized within their forms' ranges, each form's kind */
interface PlantingSizes {
  heights?: Record<string, number>;
  shapes?: ShapeSize[];
  kinds?: Record<string, string>;
}

/** What get_objects gives of a plant or a shape (editor units; a shape's height in metres) */
interface PlacedObject {
  id: string; type: string; x: number; y: number; width?: number; height?: number; rotation?: number;
  productId?: string; shape?: { shapeId: string; heightM: number };
}

/** A canopy plant_zones keeps clear of within its layer; no height = in every layer */
type Planted = Canopy & { id: string; heightM?: number };

type Choice = PlantChoice & { heightM?: number; form?: string; size?: ShapeSize; label?: string; notes?: string };

const shapeKey = (p: { shape?: string; width?: number; tall?: number }) => `${p.shape}|${p.width ?? ""}|${p.tall ?? ""}`;

/** Circles `diameter` apart along a line, standing for a hedge's or a climber's canopy */
function alongLine(a: Pt, b: Pt, diameter: number): Canopy[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.round(len / Math.max(diameter, 0.1)));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), footprint: diameter };
  });
}

/** What a plant or a shape already on the plan covers, as canopies: a hedge or a climber as circles along its line */
function canopiesOf(o: PlacedObject, sized: PlantingSizes | null): Planted[] {
  const w = (o.width ?? 0) / DPM, d = (o.height ?? 0) / DPM;
  const x = o.x / DPM, y = o.y / DPM;
  if (o.type === "plant") {
    return [{ id: o.id, x, y, footprint: Math.max(w, d), heightM: o.productId ? sized?.heights?.[String(o.productId)] : undefined }];
  }
  if (o.type !== "shape" || !o.shape) return [];
  // without the editor's kinds, a shape much longer than deep is a hedge or a climber along its line
  const kind = sized?.kinds?.[o.shape.shapeId] ?? (w >= 2.5 * d ? "hedge" : undefined);
  if (kind === "hedge" || kind === "climber") {
    const a = ((o.rotation ?? 0) * Math.PI) / 180;
    const ux = Math.cos(a) * w / 2, uy = Math.sin(a) * w / 2;
    return alongLine({ x: x - ux, y: y - uy }, { x: x + ux, y: y + uy }, Math.max(d, 0.1))
      .map((c) => ({ ...c, id: o.id, heightM: o.shape!.heightM }));
  }
  return [{ id: o.id, x, y, footprint: Math.max(w, d), heightM: o.shape.heightM }];
}

/** Calls one editor method; `timeoutMs` matters only where the transport can time out */
export type Send = (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

// A type alias, not an interface: the MCP SDK's result type needs the implicit index signature
export type ToolResult = {
  content: ToolContent[];
  isError?: boolean;
};

export const DESIGN_GUIDE_TOOL = {
  name: "get_design_guide",
  description:
    "The design guide: step-by-step first-session workflow, how to read photos and floor plans onto facades, pin rules, the three zone passes with minimum sizes, the journal template and verification. Call once at the start of a session. Detailing — Step 3: surfaces, objects, the planting as shapes, the species — comes apart: call with `part: \"detailing\"` before you detail.",
  inputSchema: {
    type: "object" as const,
    properties: { part: { type: "string", enum: ["detailing"], description: "\"detailing\": Step 3 and choosing species" } },
  },
};

/** The guide's sections for detailing, served apart: the whole guide passes what an MCP client takes in one
 *  tool result (Claude Code keeps about 50 KB and shows the agent only a preview of more) */
const DETAILING = ["Step 3 — Detailing, in three passes (stop after each pass)", "Botanical Decision-Making"];

/** The guide without its detailing sections, or (`part: "detailing"`) those sections alone */
export function guidePart(guide: string, part?: string): string {
  const sections = guide.split(/^(?=#{1,3} )/m);
  const detailing = (s: string) => /^#{1,3} /.test(s) && DETAILING.includes(s.split("\n")[0].replace(/^#+ /, "").trim());
  if (part === "detailing") return "Design guide — detailing\n\n" + sections.filter(detailing).join("");
  return sections.filter((s) => !detailing(s)).join("");
}

// M29: Per-tool WebSocket-bridge timeout overrides (ms). The default is 30 s in
// `bridge.ts`; tools that wrap genuinely slow remote services need more.
// `import_buildings` waits on the ULDK grid scan — typically 1–2 minutes for
// a residential parcel — so 3 minutes gives comfortable headroom.
const TOOL_TIMEOUTS_MS: Record<string, number> = {
  import_buildings: 180000,
  save: 180000,
};

// ── Zone geometry helpers (over the browser's raw state) ──

type ZoneSpec = Record<string, unknown> & {
  polygon?: Pt[];
  path?: { waypoints: Pt[]; width: number };
  locked?: boolean;
};

/** `polygon` / `path` (absolute) → the editor's centre + relative points form */
function normaliseZoneSpec(spec: ZoneSpec): ZoneSpec {
  const { polygon, path, ...rest } = spec;
  const abs = polygon ?? (path ? pathPolygon(path.waypoints, path.width) : null);
  if (!abs) return rest;
  if (abs.length < 3) throw new Error("A zone polygon needs at least 3 points (a path needs 2 waypoints)");
  return { ...rest, ...fromAbsolutePolygon(abs) };
}

type ObjectSpec = Record<string, unknown> & {
  polygon?: Pt[];
  path?: { waypoints: Pt[]; width: number };
  line?: Array<Pt | [number, number]>;
};

/**
 * A surface given as an absolute `polygon` or `path` (metres, like a zone) → centre + relative points;
 * a hedge shape given as a `line` from one end to the other → its centre, length and turn
 */
export function normaliseObjectSpec(spec: ObjectSpec): Record<string, unknown> {
  const { polygon, path, line, ...rest } = spec;
  if (line) {
    if (line.length !== 2) throw new Error("A line is two points: [[x1, y1], [x2, y2]]");
    const [a, b] = line.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
    return {
      ...rest, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: Math.hypot(b.x - a.x, b.y - a.y),
      rotation: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  }
  if (polygon) {
    if (polygon.length < 3) throw new Error("A polygon surface needs at least 3 points");
    return { ...rest, type: rest.type ?? "polygon", ...fromAbsolutePolygon(polygon) };
  }
  if (path) {
    if (path.waypoints.length < 2) throw new Error("A path surface needs at least 2 waypoints");
    const { x, y, width, height } = fromAbsolutePolygon(pathPolygon(path.waypoints, path.width));
    return {
      ...rest, type: rest.type ?? "path", x, y, width, height,
      pathWaypoints: path.waypoints.map((p) => ({ x: p.x - x, y: p.y - y })),
      pathWidth: path.width,
    };
  }
  return rest;
}

const OBJECT_WRITE_TOOLS = new Set(["add_object", "add_objects", "update_object", "update_objects"]);
const OBJECT_READ_TOOLS = new Set(["get_objects", "get_objects_in_zone"]);

/**
 * Objects keep `elevation` (the catalog's raised beds and planters lift plants by it) and a
 * path's `pathWidth` in editor units, and the generic conversion knows neither — unlike zones,
 * whose elevation is metres already — so the object tools scale them here.
 * Handles one object, a list of objects, or `{ objects: [...] }`.
 */
export function scaleObjectElevation<T>(value: T, factor: number): T {
  if (Array.isArray(value)) return value.map((v) => scaleObjectElevation(v, factor)) as T;
  if (!value || typeof value !== "object") return value;
  const o = { ...(value as Record<string, unknown>) };
  if (typeof o.elevation === "number") o.elevation = o.elevation * factor;
  if (typeof o.pathWidth === "number") o.pathWidth = o.pathWidth * factor;
  if (Array.isArray(o.objects)) o.objects = scaleObjectElevation(o.objects, factor);
  return o as T;
}

/** A reply as compact JSON, trimmed per tool (slim.ts): every token here is re-read on each later turn */
const textResult = (value: unknown, name = "", args: Record<string, unknown> = {}): ToolResult => ({
  content: [{ type: "text" as const, text: replyText(name, value, args) }],
});

/** Previews are re-read on every later turn too: 800 px is enough to check a layout */
const PREVIEW_SIZE = 800;

export function createDispatcher(send: Send, designGuide: string) {
  async function siteState() {
    const [info, zones] = (await Promise.all([
      send("get_garden_info", {}),
      send("get_zones", {}),
    ])) as [
      { rotation?: number; boundary?: { x: number; y: number; points: Pt[] } | null },
      Array<Parameters<typeof zoneShape>[0]>,
    ];
    return {
      rotation: info?.rotation ?? 0,
      boundary: info?.boundary?.points?.length ? boundaryShape(info.boundary) : null,
      shapes: (zones ?? []).map(zoneShape),
    };
  }

  async function zoneChecks(ids: string[]) {
    const { boundary, shapes } = await siteState();
    return checkZones(shapes.filter((s) => ids.includes(s.id)), shapes, boundary);
  }

  async function callTool(name: string, args: Record<string, unknown> | undefined): Promise<ToolResult> {
    try {
      // set_units is handled locally
      if (name === "set_units") {
        const unit = args?.unit as string;
        setUnitPreference(unit as UnitPreference);
        return textResult({
          success: true,
          unit: getUnitPreference(),
          message:
            unit === "m"
              ? "Units set to meters. All spatial values (x, y, width, height, points) are now in meters."
              : "Units set to editor units. All spatial values use raw editor units (50 = 1 meter).",
        });
      }

      if (name === "get_design_guide") {
        return { content: [{ type: "text" as const, text: guidePart(designGuide, args?.part as string | undefined) }] };
      }

      if (name === "get_site_analysis") {
        const { rotation, boundary, shapes } = await siteState();
        if (!boundary) {
          return textResult({ error: "No plot boundary. Call import_parcel (a parcel in Poland) or set_boundary first." });
        }
        // The trees standing on the plot, so zones round a tree take its real crown (SC-234)
        const rawObjects = await send("get_objects", {});
        const objectList = (Array.isArray(rawObjects) ? rawObjects : (rawObjects as { objects?: unknown[] })?.objects ?? []) as
          Array<PlacedObject & { label?: string; productName?: string }>;
        const r1 = (v: number) => Math.round(v * 10) / 10;
        const trees = objectList
          .filter((o) => o.type === "plant" && Math.max(o.width ?? 0, o.height ?? 0) / DPM >= 4)
          .map((o) => ({
            id: o.id, name: o.label || o.productName || "tree",
            trunk: { x: r1(o.x / DPM), y: r1(o.y / DPM) }, crownM: r1(Math.max(o.width ?? 0, o.height ?? 0) / DPM),
          }));
        // the bad views, so each step can be checked for a screen along them (SC-238)
        const pins = ((await send("get_pins", {})) as Array<{ id: string; pinType: string; x: number; y: number; label?: string }> ?? [])
          .map((p) => ({ ...p, x: p.x / DPM, y: p.y / DPM }));
        // the plant shapes, so a planted screen is judged by how tall it is where it stands
        const crowns = objectList.filter((o) => o.type === "shape").flatMap((o) => canopiesOf(o, null));
        const viewHeights = (args?.viewHeights ?? {}) as Record<string, number>;
        return textResult({ ...siteAnalysis(boundary, shapes, rotation, pins, crowns, viewHeights), trees });
      }

      // Zones: absolute polygon/path → editor form; lock after creating; answer with checks
      if (name === "add_zone" || name === "add_zones" || name === "update_zone") {
        const raw = args ?? {};
        const specs = name === "add_zones" ? (raw.zones as ZoneSpec[]) : [raw as ZoneSpec];
        const normalised = specs.map((s) => {
          const n = normaliseZoneSpec(s);
          return shouldConvertInput(name) ? convertInputToEditor(n) : n;
        });
        const result = (await send(
          name,
          name === "add_zones" ? { zones: normalised } : normalised[0],
        )) as { id?: string; results?: Array<{ id: string }> };
        const ids =
          name === "update_zone" ? [raw.id as string]
          : name === "add_zone" ? [result.id as string]
          : (result.results ?? []).map((r) => r.id);
        if (name !== "update_zone") {
          for (const [i, s] of specs.entries()) {
            if (s.locked && ids[i]) await send("update_zone", { id: ids[i], locked: true });
          }
        }
        return textResult({ ...result, checks: await zoneChecks(ids) }, name);
      }

      if (name === "add_pin" || name === "add_pins") {
        const raw = args ?? {};
        const result = (await send(name, shouldConvertInput(name) ? convertInputToEditor(raw) : raw)) as
          { id?: string; results?: Array<{ id: string }> };
        const ids = name === "add_pin" ? [result.id as string] : (result.results ?? []).map((r) => r.id);
        const { rotation, boundary, shapes } = await siteState();
        const pins = ((await send("get_pins", {})) as Array<{ id: string; pinType: string; x: number; y: number }>)
          .filter((p) => ids.includes(p.id))
          .map((p) => ({ ...p, x: p.x / DPM, y: p.y / DPM }));
        return textResult({ ...result, checks: checkPins(pins, shapes, boundary, rotation) }, name);
      }

      // A plan of the surfaces and plants: zones and pins hidden for the picture, shown again after
      if (name === "capture_preview" && args?.hideZones === true) {
        const { hideZones: _hide, ...rest } = args;
        await send("set_layer_visible", { layer: "metadata", visible: false });
        try {
          return await callTool("capture_preview", rest);
        } finally {
          await send("set_layer_visible", { layer: "metadata", visible: true });
        }
      }

      if (name === "capture_preview" && args?.maxSize === undefined) {
        args = { ...(args ?? {}), maxSize: PREVIEW_SIZE };
      }

      // Planting: the agent picks the plants — species or generic plant shapes — the editor places them (planting.ts)
      if (name === "plant_zones") {
        const specs = (args?.zones ?? []) as PlantZoneSpec[];
        if (!Array.isArray(specs) || specs.length === 0) {
          return textResult({ error: "Give zones: [{ zoneId, plants: [{ productId or shape, share or count }] }]" });
        }
        const [rawZones, rawObjects] = (await Promise.all([send("get_zones", {}), send("get_objects", {})])) as [
          Array<Parameters<typeof zoneShape>[0]>,
          unknown,
        ];
        const shapes = (rawZones ?? []).map(zoneShape);
        const objectList = (Array.isArray(rawObjects) ? rawObjects : (rawObjects as { objects?: unknown[] })?.objects ?? []) as PlacedObject[];

        // Each product's catalog footprint, m (plants are drawn at it)
        const sizes = new Map<string, number>();
        const asked = specs.flatMap((s) => s.plants ?? []);
        const productIds = [...new Set(asked.filter((p) => !p.shape && p.productId !== undefined).map((p) => String(p.productId)))];
        await Promise.all(productIds.map(async (id) => {
          try {
            const p = (await send("get_product_details", { productId: id })) as { width?: number; height?: number };
            const size = Math.max(p?.width ?? 0, p?.height ?? 0) / DPM;
            if (size > 0) sizes.set(id, size);
          } catch { /* reported as missing below */ }
        }));
        // Heights (plant index) and the shapes' sizes within their forms' ranges, from the editor; without
        // them every plant shares one layer, as before the layers were told apart
        const shapeAsks = [...new Map(asked.filter((p) => p.shape).map((p) => [shapeKey(p), { shape: p.shape, width: p.width, tall: p.tall }])).entries()];
        let sized: PlantingSizes | null = null;
        try {
          sized = (await send("planting_sizes", {
            productIds: [...new Set([...productIds, ...objectList.filter((o) => o.type === "plant" && o.productId).map((o) => String(o.productId))])],
            shapes: shapeAsks.map(([, ask]) => ask),
          })) as PlantingSizes;
        } catch { sized = null; }
        const shapeSize = new Map(shapeAsks.map(([key], i) => [key, sized?.shapes?.[i]]));
        let plantsNow: Planted[] = objectList.flatMap((o) => canopiesOf(o, sized));

        const objects: Array<Record<string, unknown>> = [];
        const report: Array<Record<string, unknown>> = [];
        const removed: string[] = [];
        for (const spec of specs) {
          const zone = shapes.find((s) => s.id === spec.zoneId);
          if (!zone) { report.push({ zoneId: spec.zoneId, error: "No such zone" }); continue; }
          const missing: string[] = [];
          const warnings: string[] = [];
          const choices: Choice[] = [];
          const hedges: Array<{ form: string; size: ShapeSize; label?: string; notes?: string }> = [];
          for (const [i, p] of (spec.plants ?? []).entries()) {
            if (p.shape) {
              const size = shapeSize.get(shapeKey(p));
              if (!size || size.error) { missing.push(p.shape); if (size?.error) warnings.push(size.error); continue; }
              warnings.push(...(size.warnings ?? []));
              if (size.kind === "hedge") { hedges.push({ form: p.shape, size, label: p.label, notes: p.notes }); continue; }
              choices.push({
                productId: `shape:${p.shape}#${i}`, footprint: Math.max(size.widthM, size.depthM), share: p.share, count: p.count,
                heightM: size.heightM, form: p.shape, size, label: p.label, notes: p.notes,
                // a drift of perennials or grasses, a mat of ground cover: one shape a drift, uneven drift to drift
                drift: size.kind === "clump" || size.kind === "groundcover",
              });
            } else {
              const id = String(p.productId);
              if (!sizes.has(id)) { missing.push(id); continue; }
              choices.push({ productId: id, footprint: sizes.get(id)!, share: p.share, count: p.count, heightM: sized?.heights?.[id], label: p.label });
            }
          }
          if (choices.length === 0 && hedges.length === 0) {
            report.push({
              zoneId: zone.id,
              error: (spec.plants ?? []).some((p) => p.shape) ? "No size for these plants or shapes" : "No catalog size for these products",
              missing,
              ...(warnings.length ? { warnings } : {}),
            });
            continue;
          }
          if (spec.replace) {
            const gone = new Set(plantsNow.filter((c) => c.id && inside(c, zone.poly)).map((c) => c.id));
            removed.push(...gone);
            plantsNow = plantsNow.filter((c) => !gone.has(c.id));
          }
          // A bed set into paving or lawn (pots at the door, a clump by the bench) is planted all the same
          const avoid = shapes
            .filter((s) => s.id !== zone.id && NO_PLANTING.has(s.zoneType) && !zone.poly.every((p) => inside(p, s.poly)))
            .map((s) => s.poly);
          // The bed is composed toward the side it is seen from: each kind's depth by its height among the bed's
          // heights, the plants already there counted — the tallest at the back, the lowest at the front
          const stands = STANDS[zone.zoneType] ?? 1;
          const depthAt = bedDepth(zone.poly, shapes.filter((s) => s.id !== zone.id && (STANDS[s.zoneType] ?? 9) < stands).map((s) => s.poly));
          const tenth = (h: number) => Math.round(h * 10) / 10;
          const heights = [...new Set([...choices.map((c) => c.heightM), ...plantsNow.filter((c) => inside(c, zone.poly)).map((c) => c.heightM)]
            .filter((h): h is number => h !== undefined).map(tenth))].sort((a, b) => a - b);
          if (depthAt && heights.length >= 2) {
            for (const c of choices) if (c.heightM !== undefined) c.depth = heights.indexOf(tenth(c.heightM)) / (heights.length - 1);
          }

          // A hedge shape: one line along each straight run of the zone, as wide as the zone (within its range)
          const hedgeLines: Array<{ form: string; lines: number; lengthM: number }> = [];
          for (const h of hedges) {
            const { runs, width } = hedgeRuns(zone.poly);
            const depth = Math.min(Math.max(width, h.size.depthRange?.[0] ?? 0), h.size.depthRange?.[1] ?? Infinity);
            let length = 0;
            let lines = 0;
            for (const [a, b] of runs) {
              const len = Math.hypot(b.x - a.x, b.y - a.y);
              if (len < 0.3) continue;
              length += len;
              lines++;
              const rotation = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              objects.push({
                type: "shape", shape: h.form, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, width: len, height: depth, tall: h.size.heightM,
                rotation, zoneId: zone.id, ...(h.label ? { label: h.label } : {}), ...(h.notes ? { notes: h.notes } : {}),
              });
              plantsNow.push(...alongLine(a, b, depth).map((c) => ({ ...c, id: "", heightM: h.size.heightM })));
            }
            hedgeLines.push({ form: h.form, lines, lengthM: Math.round(length * 10) / 10 });
          }

          // Each height layer is planted on its own, tallest first: ground cover goes under shrubs and
          // trees, and the cover aimed at is each layer's
          const byLayer = new Map<string, Choice[]>();
          for (const c of choices) {
            const key = c.heightM === undefined ? "any" : layerOf(c.heightM);
            byLayer.set(key, [...(byLayer.get(key) ?? []), c]);
          }
          let layout: "groups" | "row" | undefined;
          const short: Record<string, number> = {};
          const placedCount = new Map<string, number>();
          for (const key of ["tree", "shrub", "ground", "any"]) {
            const group = byLayer.get(key);
            if (!group) continue;
            const existing = plantsNow.filter((c) => key === "any" || c.heightM === undefined || layerOf(c.heightM) === key);
            const plan = planPlanting(zone.poly, group, { layout: spec.layout, coverage: spec.coverage, existing, avoid, depthAt });
            layout ??= plan.layout;
            Object.assign(short, plan.short);
            for (const p of plan.placed) {
              const c = group.find((g) => g.productId === p.productId)!;
              placedCount.set(c.productId, (placedCount.get(c.productId) ?? 0) + 1);
              const r2 = (v: number) => Math.round(v * 100) / 100;
              objects.push(c.form && c.size
                ? {
                  type: "shape", shape: c.form, x: p.x, y: p.y, tall: c.size.heightM,
                  ...(p.oval
                    ? { width: r2(p.oval.w), height: r2(p.oval.d), rotation: Math.round(p.oval.rotation) }
                    : { width: c.size.widthM, height: c.size.depthM }),
                  zoneId: zone.id, ...(c.label ? { label: c.label } : {}), ...(c.notes ? { notes: c.notes } : {}),
                }
                : { type: "plant", productId: c.productId, x: p.x, y: p.y, zoneId: zone.id, ...(c.label ? { label: c.label } : {}) });
              plantsNow.push({ id: "", x: p.x, y: p.y, footprint: p.oval ? Math.sqrt(p.oval.w * p.oval.d) : c.footprint, heightM: c.heightM });
            }
          }
          const cover = layeredCover(boundsOf(zone.poly), (q) => inside(q, zone.poly),
            plantsNow.map((c) => ({ kind: "circle" as const, x: c.x, y: c.y, diameter: c.footprint, heightM: c.heightM })));
          const r2 = (v: number) => Math.round(v * 100) / 100;
          const nameOf = (key: string) => choices.find((c) => c.productId === key)?.form ?? key;
          report.push({
            zoneId: zone.id,
            ...(layout ? { layout } : {}),
            // the catalog size too: it can differ from search_plants' botanical spread
            planted: [
              ...choices.map((c) => (c.form
                ? { shape: c.form, size: r2(c.footprint), tall: r2(c.heightM ?? 0), count: placedCount.get(c.productId) ?? 0 }
                : { productId: c.productId, size: c.footprint, count: placedCount.get(c.productId) ?? 0 })),
              ...hedgeLines.map((h) => ({ shape: h.form, lines: h.lines, lengthM: h.lengthM })),
            ],
            // counted once where plants overlap; each height layer on its own
            cover: r2(cover.cover),
            ...(sized ? { coverByLayer: { ground: r2(cover.layers.ground), shrub: r2(cover.layers.shrub), tree: r2(cover.layers.tree) } } : {}),
            ...(Object.keys(short).length ? { short: Object.fromEntries(Object.entries(short).map(([k, v]) => [nameOf(k), v])) } : {}),
            ...(missing.length ? { missing } : {}),
            ...(warnings.length ? { warnings } : {}),
          });
        }
        if (removed.length) await send("delete_objects", { ids: removed });
        let added: { issues?: unknown; error?: string } = {};
        if (objects.length) {
          const reply = await callTool("add_objects", { objects });
          const text = (reply.content[0] as { text?: string } | undefined)?.text ?? "";
          try { added = JSON.parse(text); } catch { added = { error: text }; }
        }
        return textResult({
          zones: report,
          ...(removed.length ? { removed: removed.length } : {}),
          ...(added.issues ? { issues: added.issues } : {}),
          ...(added.error ? { error: added.error } : {}),
        });
      }

      // Surfaces: absolute `polygon` / `path`, as for zones → the editor's centre + relative points form
      if (name === "add_object" || name === "add_objects") {
        const raw = args ?? {};
        const specs = name === "add_objects" ? (raw.objects as ObjectSpec[]) : [raw as ObjectSpec];
        const normalised = specs.map(normaliseObjectSpec);
        args = name === "add_objects" ? { ...raw, objects: normalised } : normalised[0];
      }

      // Apply unit conversion on input (meters → editor units)
      let browserArgs = args ?? {};
      if (shouldConvertInput(name)) {
        browserArgs = convertInputToEditor(browserArgs);
        // An object's elevation (a raised bed's lift) is stored in editor units like its footprint
        if (OBJECT_WRITE_TOOLS.has(name)) browserArgs = scaleObjectElevation(browserArgs, DPM);
      }

      // Forward to the browser
      let result = await send(name, browserArgs, TOOL_TIMEOUTS_MS[name]);

      // Apply unit conversion on output (editor units → meters)
      if (shouldConvertOutput(name)) {
        result = convertOutputToMeters(result);
        if (OBJECT_READ_TOOLS.has(name)) result = scaleObjectElevation(result, 1 / DPM);
      }
      if (name === "get_product_details" || name === "get_plant_info" || name === "search_products") {
        result = convertProductSizesToMeters(result);
      }

      // M32: capture_preview returns an MCP ImageContent block so agents can
      // view the screenshot inline. Browser side returns {dataUri}; we strip
      // the prefix and return raw base64 + mimeType per the MCP spec.
      if (name === "capture_preview") {
        const dataUri = (result as { dataUri?: string } | undefined)?.dataUri ?? "";
        const match = dataUri.match(/^data:(image\/[a-z]+);base64,(.+)$/);
        if (!match) {
          return {
            content: [{ type: "text", text: "Error: capture_preview returned no image data" }],
            isError: true,
          };
        }
        return {
          content: [{ type: "image", mimeType: match[1], data: match[2] }],
        };
      }

      // G36: the house from a few sides, as pictures the agent compares with the photos
      if (name === "house_preview") {
        const { views = [], ...about } = (result ?? {}) as { views?: Array<{ view: string; dataUri: string }> };
        const content: ToolContent[] = [{ type: "text", text: JSON.stringify({ ...about, views: views.map((v) => v.view) }) }];
        for (const v of views) {
          const match = v.dataUri.match(/^data:(image\/[a-z]+);base64,(.+)$/);
          if (match) content.push({ type: "text", text: v.view }, { type: "image", mimeType: match[1], data: match[2] });
        }
        return { content };
      }

      // G26: a close-up comes back as the picture plus its view id and size
      if (name === "zoom_image") {
        const { dataUri = "", ...about } = (result ?? {}) as { dataUri?: string };
        const match = dataUri.match(/^data:(image\/[a-z]+);base64,(.+)$/);
        if (!match) return textResult({ error: "zoom_image returned no image data" });
        return {
          content: [
            { type: "text", text: JSON.stringify(about) },
            { type: "image", mimeType: match[1], data: match[2] },
          ],
        };
      }

      return textResult(result, name, args ?? {});
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  return { callTool };
}
