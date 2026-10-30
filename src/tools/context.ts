// Phase 2: Context tools — pins, garden info, rotation, preview

import type { Tool } from "./types.js";

const PIN_TYPE_REFERENCE = `Available pin types:
• door — main entrance door (red)
• patio_door — patio/garden door (teal)
• window — window opening (blue)
• gate — garden gate/entrance (green)
• view_good — desirable view direction (yellow)
• view_bad — undesirable view to screen (grey)`;

const PIN_SPEC_SCHEMA = {
  type: "object" as const,
  properties: {
    pinType: {
      type: "string",
      enum: ["door", "patio_door", "window", "gate", "view_good", "view_bad"],
      description: "Type of pin to create",
    },
    x: { type: "number", description: "X position — units determined by set_units (default 'm', meters)" },
    y: { type: "number", description: "Y position — units determined by set_units (default 'm', meters)" },
    label: { type: "string", description: "Optional: Custom label for the pin" },
    notes: { type: "string", description: "Optional: Design notes — context about this pin, what it means for the layout" },
  },
  required: ["pinType", "x", "y"] as string[],
};

export const tools: Tool[] = [
  {
    name: "add_pin",
    description: `Add a context pin to the garden. Returns the pin ID.\n\n${PIN_TYPE_REFERENCE}`,
    inputSchema: PIN_SPEC_SCHEMA,
  },
  {
    name: "add_pins",
    description: `Add multiple context pins in a single call. Returns array of pin IDs. Use this instead of calling add_pin multiple times.\n\n${PIN_TYPE_REFERENCE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        pins: {
          type: "array",
          description: "Array of pin specifications",
          items: PIN_SPEC_SCHEMA,
        },
      },
      required: ["pins"],
    },
  },
  {
    name: "delete_pin",
    description: "Delete a pin by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Pin ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "get_pins",
    description: "Get all pins in the garden",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_garden_info",
    description:
      "Get garden metadata: ID, name, description, rotation, boundary, object counts",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "set_garden_rotation",
    description: "Set the garden's north orientation in degrees",
    inputSchema: {
      type: "object" as const,
      properties: {
        degrees: {
          type: "number",
          description: "Rotation in degrees (0 = north up, 90 = east up)",
        },
      },
      required: ["degrees"],
    },
  },
  {
    name: "set_garden_description",
    description: "Set the garden description (Markdown supported). Use as a design journal — write the brief, key decisions, rationale, current phase, and what's next. Persists across sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "Garden description in Markdown format (design brief, decisions, rationale). Supports headings, lists, bold, etc.",
        },
      },
      required: ["description"] as string[],
    },
  },
  {
    name: "capture_preview",
    description:
      "Capture a screenshot of the garden framed on the parcel (2 m margin), in the current view mode — switch to 2d with set_view_mode for a plan view. Returns an image you can view directly.",
    inputSchema: {
      type: "object" as const,
      properties: {
        maxSize: {
          type: "number",
          description: "Optional: image size in pixels (default 1200)",
        },
      },
    },
  },
];
