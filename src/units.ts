// Unit conversion layer — meters ↔ editor units at the MCP boundary
// DPM = 50 (Dots Per Meter): 1 meter = 50 editor units

export const DPM = 50;

export type UnitPreference = "m" | "editor";

// Session-level unit preference (default: meters for agent-friendliness)
let unitPreference: UnitPreference = "m";

export function getUnitPreference(): UnitPreference {
  return unitPreference;
}

export function setUnitPreference(unit: UnitPreference): void {
  unitPreference = unit;
}

// Fields that represent spatial coordinates/dimensions in editor units
// These get converted when unit preference is "m"
const COORDINATE_FIELDS = new Set([
  "x",
  "y",
  "width",
  "height",
  "editorX",
  "editorY",
  // M29: building summary fields returned by `import_buildings`
  "centerX",
  "centerY",
]);

// Fields in points arrays that need conversion
const POINT_COORDINATE_FIELDS = new Set(["x", "y"]);

/**
 * Convert input params from meters to editor units (before sending to browser).
 * Only converts if unit preference is "m".
 */
export function convertInputToEditor(
  params: Record<string, unknown>
): Record<string, unknown> {
  if (unitPreference !== "m") return params;
  return convertObject(params, (v) => v * DPM);
}

/**
 * Convert output result from editor units to meters (before returning to agent).
 * Only converts if unit preference is "m".
 */
export function convertOutputToMeters(result: unknown): unknown {
  if (unitPreference !== "m") return result;
  if (result == null || typeof result !== "object") return result;
  // Handle top-level arrays (e.g., get_zones returns Zone[])
  if (Array.isArray(result)) {
    return result.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? convertResultDeep(item as Record<string, unknown>)
        : item
    );
  }
  return convertResultDeep(result as Record<string, unknown>);
}

function convertObject(
  obj: Record<string, unknown>,
  transform: (v: number) => number
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (COORDINATE_FIELDS.has(key) && typeof value === "number") {
      result[key] = transform(value);
    } else if ((key === "points" || key === "polygon" || key === "pathWaypoints") && Array.isArray(value)) {
      // `polygon`: set_boundary's absolute vertices (zone tools replace theirs before this);
      // `pathWaypoints`: a path surface's centreline, in the same units as its points
      result[key] = value.map((point) => {
        if (point && typeof point === "object") {
          const converted: Record<string, unknown> = {};
          for (const [pk, pv] of Object.entries(
            point as Record<string, unknown>
          )) {
            if (POINT_COORDINATE_FIELDS.has(pk) && typeof pv === "number") {
              converted[pk] = transform(pv);
            } else {
              converted[pk] = pv;
            }
          }
          return converted;
        }
        return point;
      });
    } else if (key === "zones" && Array.isArray(value)) {
      // Batch zones
      result[key] = value.map((z) =>
        typeof z === "object" && z != null
          ? convertObject(z as Record<string, unknown>, transform)
          : z
      );
    } else if (key === "pins" && Array.isArray(value)) {
      // Batch pins
      result[key] = value.map((p) =>
        typeof p === "object" && p != null
          ? convertObject(p as Record<string, unknown>, transform)
          : p
      );
    } else if (key === "objects" && Array.isArray(value)) {
      // Batch objects
      result[key] = value.map((o) =>
        typeof o === "object" && o != null
          ? convertObject(o as Record<string, unknown>, transform)
          : o
      );
    } else {
      result[key] = value;
    }
  }

  return result;
}

function convertResultDeep(obj: Record<string, unknown>): unknown {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (COORDINATE_FIELDS.has(key) && typeof value === "number") {
      result[key] = value / DPM;
    } else if (key === "points" && Array.isArray(value)) {
      result[key] = value.map((point) => {
        if (point && typeof point === "object") {
          const converted: Record<string, unknown> = {};
          for (const [pk, pv] of Object.entries(
            point as Record<string, unknown>
          )) {
            if (POINT_COORDINATE_FIELDS.has(pk) && typeof pv === "number") {
              converted[pk] = pv / DPM;
            } else {
              converted[pk] = pv;
            }
          }
          return converted;
        }
        return point;
      });
    } else if (Array.isArray(value)) {
      // Recurse into arrays (e.g., zones[], pins[], objects[], results[])
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? convertResultDeep(item as Record<string, unknown>)
          : item
      );
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // Recurse into nested objects (e.g., gardenInfo, boundary, geoAnchor)
      result[key] = convertResultDeep(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Catalog tools return products as stored: footprint width/height and elevation in editor
 * units. Convert just those product fields — plant definitions carry their own metres.
 */
const PRODUCT_SIZE_FIELDS = ["width", "height", "elevation"];

export function convertProductSizesToMeters(result: unknown): unknown {
  if (unitPreference !== "m" || result == null || typeof result !== "object") return result;
  const toMeters = (p: unknown) => {
    if (!p || typeof p !== "object") return p;
    const out: Record<string, unknown> = { ...(p as Record<string, unknown>) };
    for (const f of PRODUCT_SIZE_FIELDS) if (typeof out[f] === "number") out[f] = (out[f] as number) / DPM;
    return out;
  };
  const r = { ...(result as Record<string, unknown>) };
  if (r.product) r.product = toMeters(r.product);
  else if (Array.isArray(r.products)) r.products = r.products.map(toMeters);
  else return toMeters(r); // get_product_details: the product itself
  return r;
}

// Tools that should NOT have their output converted (non-spatial data)
const SKIP_OUTPUT_CONVERSION = new Set([
  "connection_status",
  "search_products",
  "get_categories",
  "get_product_details",
  "get_plant_info",
  "get_plant_attributes",
  "search_plants",
  "get_zone_types",
  "capture_preview",
  "get_reference_photos",
  "upload_reference_photo",
  "set_units",
  "get_coordinate_system",
  "set_garden_description",
  "get_zone_analysis",
  "set_map_background",
  // G26: pixels and metres already (map_to_garden answers metres; zoom_image's width/height are pixels)
  "zoom_image",
  "set_survey_map",
  "map_to_garden",
]);

// Tools that should NOT have their input converted (no spatial params)
const SKIP_INPUT_CONVERSION = new Set([
  "connection_status",
  "search_products",
  "get_categories",
  "get_product_details",
  "get_plant_info",
  "get_plant_attributes",
  "search_plants",
  "get_zone_types",
  "capture_preview",
  "get_reference_photos",
  "upload_reference_photo",
  "set_view_mode",
  "get_view_mode",
  "set_layer_visible",
  "get_layer_visibility",
  "save",
  "undo",
  "redo",
  "set_units",
  "set_garden_description",
  "get_coordinate_system",
  "get_full_state",
  "get_garden_info",
  "get_zones",
  "get_pins",
  "get_objects",
  "export_state",
  "clear_all",
  "set_garden_rotation",
  "get_objects_in_zone",
  "get_zone_analysis",
  "set_map_background",
  // G26: map pixels and explicit metres
  "zoom_image",
  "set_survey_map",
  "map_to_garden",
]);

export function shouldConvertInput(toolName: string): boolean {
  return !SKIP_INPUT_CONVERSION.has(toolName);
}

export function shouldConvertOutput(toolName: string): boolean {
  return !SKIP_OUTPUT_CONVERSION.has(toolName);
}
