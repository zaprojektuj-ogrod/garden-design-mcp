// Phase 3: Zone tools — zone CRUD, clear, export/import, zone types

import type { Tool } from "./types.js";

const ZONE_TYPES = [
  "entry", "relaxation", "activity", "utility", "wild",
  "tall_plants", "privacy_screen", "low_plants", "herbs", "lawn",
  "path", "building", "terrace", "parking",
];

const ZONE_TYPE_REFERENCE = `Available zone types (type → default height → category):
• entry — 0.3m — functional (entrance area)
• relaxation — 0.5m — functional (seating, lounging)
• activity — 0.3m — functional (play, sports)
• utility — 0.4m — functional (compost, storage, bins)
• wild — 0.6m — functional (naturalistic area)
• tall_plants — 2.0m — planting (trees, large shrubs)
• privacy_screen — 1.8m — planting (hedges, screening)
• low_plants — 0.5m — planting (perennials, groundcover)
• herbs — 0.3m — planting (herb garden)
• lawn — 0.05m — planting (grass area)
• path — 0.05m — infrastructure (walkways)
• building — 3.0m — infrastructure (structures)
• terrace — 0.2m — infrastructure (paved patio)
• parking — 0.05m — infrastructure (driveway, car space)`;

const POINT = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
};

const ZONE_SHAPE_PROPS = {
  polygon: {
    type: "array",
    description: "Absolute polygon vertices in metres (garden coordinates). Replaces x/y/width/height/points.",
    items: POINT,
  },
  path: {
    type: "object",
    description: "Corridor along a centreline: absolute waypoints (metres) and corridor width. Replaces x/y/width/height/points.",
    properties: {
      waypoints: { type: "array", items: POINT, description: "Centreline points, at least 2; space them 0.5–2 m apart for smooth curves" },
      width: { type: "number", description: "Corridor width in metres (paths ≥0.9, hedges 0.6–1.2)" },
    },
    required: ["waypoints", "width"],
  },
  x: { type: "number", description: "Rectangle centre X (metres by default)" },
  y: { type: "number", description: "Rectangle centre Y (metres by default)" },
  width: { type: "number", description: "Rectangle width (plan size, not height)" },
  height: { type: "number", description: "Rectangle depth on the plan (NOT vertical height — that is `elevation`)" },
  points: {
    type: "array",
    description: "With x/y: polygon vertices as offsets from (x, y). Prefer `polygon` (absolute) instead.",
    items: POINT,
  },
};

const ZONE_SPEC_SCHEMA = {
  type: "object" as const,
  properties: {
    zoneType: {
      type: "string",
      enum: ZONE_TYPES,
      description: "Type of zone to create",
    },
    ...ZONE_SHAPE_PROPS,
    elevation: { type: "number", description: "Optional: vertical height of the zone prism in metres (default varies by type)" },
    label: { type: "string", description: "Optional: Custom label for the zone" },
    notes: { type: "string", description: "Optional: Design notes — why this zone was placed here, constraints, alternatives considered" },
    locked: { type: "boolean", description: "Optional: lock the zone (existing features the design must not change — paving, sheds, existing hedges). Locked zones are flagged when other zones overlap them." },
  },
  required: ["zoneType"] as string[],
};

export const tools: Tool[] = [
  {
    name: "add_zone",
    description: `Add a new zone to the garden. Returns the zone ID.\n\n${ZONE_TYPE_REFERENCE}`,
    inputSchema: ZONE_SPEC_SCHEMA,
  },
  {
    name: "add_zones",
    description: `Add multiple zones in a single call. Returns array of zone IDs. Use this instead of calling add_zone multiple times.\n\n${ZONE_TYPE_REFERENCE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        zones: {
          type: "array",
          description: "Array of zone specifications",
          items: ZONE_SPEC_SCHEMA,
        },
      },
      required: ["zones"],
    },
  },
  {
    name: "update_zone",
    description: "Update an existing zone. Reshape it with `polygon` or `path` (absolute, metres) or with x/y/width/height/points; lock or unlock it with `locked`. Returns checks for the updated zone (area, narrowest width, overlaps, parcel overflow).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Zone ID to update" },
        ...ZONE_SHAPE_PROPS,
        elevation: { type: "number", description: "New vertical height in metres" },
        rotation: { type: "number", description: "New rotation in degrees" },
        label: { type: "string", description: "New label" },
        notes: { type: "string", description: "Updated design notes" },
        zoneType: { type: "string", enum: ZONE_TYPES, description: "New zone type" },
        locked: { type: "boolean", description: "Lock (true) or unlock (false) the zone" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_zone",
    description: "Delete a zone by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Zone ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_zones",
    description: "Get all zones in the garden (editor geometry: centre + relative points; `locked` marks zones the design must not change). For absolute polygons and areas use get_site_analysis.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_zone_types",
    description: "Get all available zone types with their properties (colors, default heights, labels)",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_objects_in_zone",
    description: "Returns all garden objects whose center falls within the specified zone. Includes plants, buildings, and ground shapes. Useful for checking plant density, verifying placement, or listing zone contents.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zoneId: { type: "string", description: "ID of the zone to query" },
      },
      required: ["zoneId"],
    },
  },
  {
    name: "get_zone_analysis",
    description: "Analyzes a zone's contents: object count, coverage %, planting density rating, and boundary violation warnings. Use after placing objects to validate density and spatial relationships.",
    inputSchema: {
      type: "object" as const,
      properties: {
        zoneId: { type: "string", description: "ID of the zone to analyze" },
      },
      required: ["zoneId"],
    },
  },
  {
    name: "clear_all",
    description:
      "Clear scene contents. Default scope='all' clears objects, zones, AND pins (matches the tool name's intent). Use scope='zones_pins' to preserve objects, or scope='objects' to preserve zones+pins. NOTE: behaviour change in this MCP version — previously this tool only cleared zones+pins regardless. Returns { success, scope, objectsCleared, zonesCleared, pinsCleared }.",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: {
          type: "string",
          enum: ["all", "zones_pins", "objects"],
          description:
            "What to clear. 'all' (default) = objects + zones + pins. 'zones_pins' = legacy behaviour (zones + pins only). 'objects' = clear plants/buildings/ground shapes only.",
        },
      },
    },
  },
  {
    name: "export_state",
    description: "Export the current state of all zones and pins as JSON",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "import_state",
    description: "Import zones and pins from a JSON state object",
    inputSchema: {
      type: "object" as const,
      properties: {
        state: {
          type: "object",
          description: "State object with zones and pins arrays",
          properties: {
            zones: { type: "array", description: "Array of zone objects" },
            pins: { type: "array", description: "Array of pin objects" },
          },
        },
      },
      required: ["state"],
    },
  },
];
