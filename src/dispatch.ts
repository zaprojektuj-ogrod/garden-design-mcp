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
  type Pt,
} from "./geometry.js";

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

const textResult = (value: unknown): ToolResult => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

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
        return textResult(siteAnalysis(boundary, shapes, rotation));
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
        return textResult({ ...result, checks: await zoneChecks(ids) });
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
        return textResult({ ...result, checks: checkPins(pins, shapes, boundary, rotation) });
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

      return textResult(result);
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
