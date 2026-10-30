// Phase 5: Review tools — view mode, layers, focus, save, undo/redo

import type { Tool } from "./types.js";

export const tools: Tool[] = [
  {
    name: "set_view_mode",
    description: "Switch between 2D (top-down) and 3D (perspective) view",
    inputSchema: {
      type: "object" as const,
      properties: {
        mode: {
          type: "string",
          enum: ["2d", "3d"],
          description: "View mode",
        },
      },
      required: ["mode"],
    },
  },
  {
    name: "get_view_mode",
    description: "Get the current view mode (2d or 3d)",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "set_layer_visible",
    description: "Show or hide a rendering layer",
    inputSchema: {
      type: "object" as const,
      properties: {
        layer: {
          type: "string",
          enum: ["plants", "buildings", "ground", "metadata", "map"],
          description: "Layer name. 'buildings' = architecture objects (furniture, raised beds, planters); 'ground' = surfaces; 'metadata' = zones and pins — hide it to see the surfaces and objects under the zones; 'map' = map background and parcel outline.",
        },
        visible: { type: "boolean", description: "Whether to show the layer" },
      },
      required: ["layer", "visible"],
    },
  },
  {
    name: "get_layer_visibility",
    description: "Get visibility state of all layers",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "focus_on",
    description:
      "Focus the camera on a specific area in the garden",
    inputSchema: {
      type: "object" as const,
      properties: {
        x: { type: "number", description: "Center X — units determined by set_units (default 'm', meters)" },
        y: { type: "number", description: "Center Y — units determined by set_units (default 'm', meters)" },
        width: {
          type: "number",
          description: "Optional: Bounds width to fit in view",
        },
        height: {
          type: "number",
          description: "Optional: Bounds height to fit in view",
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "save",
    description: "Save all changes to the server",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "undo",
    description: "Undo the last action",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "redo",
    description: "Redo the last undone action",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_coordinate_system",
    description:
      "Get the coordinate system documentation (units, axes, scale factor). Note: 50 editor units = 1 meter, origin top-left, X rightward, Y downward, rotation clockwise degrees.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_full_state",
    description:
      "Get the garden state. Default: full payload (summary + zones + pins + objects + layer visibility + view mode + geo-anchor + coordinate system) — use at session start. Pass summary_only=true on large scenes to skip the heavy arrays and return just the summary block + coordinateSystem (avoids exceeding the tool-result token budget).",
    inputSchema: {
      type: "object" as const,
      properties: {
        summary_only: {
          type: "boolean",
          description:
            "When true, return only { summary, coordinateSystem }. Skips zones/pins/objects/gardenInfo/layerVisibility/viewMode/geoAnchor arrays. Recommended for scenes with many objects.",
        },
      },
    },
  },
  {
    name: "set_units",
    description:
      'Set the unit system for coordinate inputs/outputs. Default is "m" (meters). When set to "m", all spatial values (x, y, width, height, points) are in meters. When "editor", values use raw editor units (50 units = 1 meter).',
    inputSchema: {
      type: "object" as const,
      properties: {
        unit: {
          type: "string",
          enum: ["m", "editor"],
          description:
            '"m" for meters (default, agent-friendly), "editor" for raw editor units (50 = 1m)',
        },
      },
      required: ["unit"],
    },
  },
];
