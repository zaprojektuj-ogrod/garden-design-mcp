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
import { planPlanting, coverOf, type Canopy } from "./planting.js";

/** Zones whose ground takes no plants: plant_zones keeps plant centres out of them */
const NO_PLANTING = new Set(["terrace", "path", "building", "entry", "parking", "lawn"]);

interface PlantZoneSpec {
  zoneId: string;
  plants?: Array<{ productId: string | number; share?: number; count?: number }>;
  layout?: "groups" | "row";
  coverage?: number;
  replace?: boolean;
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
    "The full design guide: step-by-step first-session workflow, how to read photos and floor plans onto facades, pin rules, the three zone passes with minimum sizes, the journal template, plant selection and verification. Call once at the start of a session.",
  inputSchema: { type: "object" as const, properties: {} },
};

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
};

/** A surface given as an absolute `polygon` or `path` (metres, like a zone) → centre + relative points */
export function normaliseObjectSpec(spec: ObjectSpec): Record<string, unknown> {
  const { polygon, path, ...rest } = spec;
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
        return { content: [{ type: "text" as const, text: designGuide }] };
      }

      if (name === "get_site_analysis") {
        const { rotation, boundary, shapes } = await siteState();
        if (!boundary) {
          return textResult({ error: "No plot boundary. Call import_parcel (a parcel in Poland) or set_boundary first." });
        }
        // The trees standing on the plot, so zones round a tree take its real crown (SC-234)
        const rawObjects = await send("get_objects", {});
        const objectList = (Array.isArray(rawObjects) ? rawObjects : (rawObjects as { objects?: unknown[] })?.objects ?? []) as
          Array<{ id: string; type: string; x: number; y: number; width?: number; height?: number; label?: string; productName?: string }>;
        const r1 = (v: number) => Math.round(v * 10) / 10;
        const trees = objectList
          .filter((o) => o.type === "plant" && Math.max(o.width ?? 0, o.height ?? 0) / DPM >= 4)
          .map((o) => ({
            id: o.id, name: o.label || o.productName || "tree",
            trunk: { x: r1(o.x / DPM), y: r1(o.y / DPM) }, crownM: r1(Math.max(o.width ?? 0, o.height ?? 0) / DPM),
          }));
        return textResult({ ...siteAnalysis(boundary, shapes, rotation), trees });
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

      // Planting: the agent picks the plants, the editor places them (planting.ts)
      if (name === "plant_zones") {
        const specs = (args?.zones ?? []) as PlantZoneSpec[];
        if (!Array.isArray(specs) || specs.length === 0) {
          return textResult({ error: "Give zones: [{ zoneId, plants: [{ productId, share or count }] }]" });
        }
        const [rawZones, rawObjects] = (await Promise.all([send("get_zones", {}), send("get_objects", {})])) as [
          Array<Parameters<typeof zoneShape>[0]>,
          unknown,
        ];
        const shapes = (rawZones ?? []).map(zoneShape);
        const objectList = (Array.isArray(rawObjects) ? rawObjects : (rawObjects as { objects?: unknown[] })?.objects ?? []) as
          Array<{ id: string; type: string; x: number; y: number; width?: number; height?: number }>;
        let plantsNow: Array<Canopy & { id: string }> = objectList
          .filter((o) => o.type === "plant")
          .map((o) => ({ id: o.id, x: o.x / DPM, y: o.y / DPM, footprint: Math.max(o.width ?? 0, o.height ?? 0) / DPM }));

        // Each product's catalog footprint, m (plants are drawn at it)
        const sizes = new Map<string, number>();
        const productIds = [...new Set(specs.flatMap((s) => (s.plants ?? []).map((p) => String(p.productId))))];
        await Promise.all(productIds.map(async (id) => {
          try {
            const p = (await send("get_product_details", { productId: id })) as { width?: number; height?: number };
            const size = Math.max(p?.width ?? 0, p?.height ?? 0) / DPM;
            if (size > 0) sizes.set(id, size);
          } catch { /* reported as missing below */ }
        }));

        const objects: Array<Record<string, unknown>> = [];
        const report: Array<Record<string, unknown>> = [];
        const removed: string[] = [];
        for (const spec of specs) {
          const zone = shapes.find((s) => s.id === spec.zoneId);
          if (!zone) { report.push({ zoneId: spec.zoneId, error: "No such zone" }); continue; }
          const asked = (spec.plants ?? []).map((p) => ({ ...p, productId: String(p.productId) }));
          const missing = asked.filter((p) => !sizes.has(p.productId)).map((p) => p.productId);
          const choices = asked.filter((p) => sizes.has(p.productId))
            .map((p) => ({ productId: p.productId, footprint: sizes.get(p.productId)!, share: p.share, count: p.count }));
          if (choices.length === 0) { report.push({ zoneId: zone.id, error: "No catalog size for these products", missing }); continue; }
          if (spec.replace) {
            const gone = plantsNow.filter((c) => c.id && inside(c, zone.poly));
            removed.push(...gone.map((c) => c.id));
            plantsNow = plantsNow.filter((c) => !gone.includes(c));
          }
          // A bed set into paving or lawn (pots at the door, a clump by the bench) is planted all the same
          const avoid = shapes
            .filter((s) => s.id !== zone.id && NO_PLANTING.has(s.zoneType) && !zone.poly.every((p) => inside(p, s.poly)))
            .map((s) => s.poly);
          const plan = planPlanting(zone.poly, choices, { layout: spec.layout, coverage: spec.coverage, existing: plantsNow, avoid });
          for (const p of plan.placed) {
            objects.push({ type: "plant", productId: p.productId, x: p.x, y: p.y, zoneId: zone.id });
            plantsNow.push({ id: "", x: p.x, y: p.y, footprint: sizes.get(p.productId)! });
          }
          report.push({
            zoneId: zone.id,
            layout: plan.layout,
            // the catalog size too: it can differ from search_plants' botanical spread
            planted: choices.map((c) => ({ productId: c.productId, size: c.footprint, count: plan.placed.filter((p) => p.productId === c.productId).length })),
            cover: Math.round(coverOf(zone.poly, plantsNow) * 100) / 100,
            ...(Object.keys(plan.short).length ? { short: plan.short } : {}),
            ...(missing.length ? { missing } : {}),
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
