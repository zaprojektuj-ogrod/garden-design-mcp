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
    x: { type: "number", description: "X position, m" },
    y: { type: "number", description: "Y position, m" },
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
    description: `Add context pins (one or more) in one call. Returns \`ids\` in input order (null where one failed), \`issues\` for failures and warnings, and \`checks\`.\n\n${PIN_TYPE_REFERENCE}`,
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
    name: "get_journal",
    description: "Read your design journal: your working memory of this garden across sessions (site, baseline, pins, brief, the decisions of each pass, open questions, status), in Markdown sections. For you only — the owner never sees it. Read it at the start of a session. Answers {text, updatedAt}; empty text while nothing has been written.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "write_journal",
    description: "Write your design journal (kept with the garden, for you only). Write the whole journal once; after that update only the section that changed by naming it in `section` — never resend the rest. Answers the journal's length, not its text.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The whole journal, or with `section` that section's new text",
        },
        section: {
          type: "string",
          description: "A heading's text, e.g. \"Pass 2.1\": its section (down to the next heading of the same or a higher level) is replaced; added at the end if missing",
        },
      },
      required: ["text"] as string[],
    },
  },
  {
    name: "set_garden_description",
    description: "Write the garden's description. It is the owner's: write it only when they ask for it or agree to your offer (offer at most once, when the design is finished). The design as it stands now, in a few lines of Markdown in the owner's language — what the garden has and why. The owner reads it, and it is shown with the garden on the website. Never a log of the work, never ids or pass numbers — those go in the journal.",
    inputSchema: {
      type: "object" as const,
      properties: {
        description: {
          type: "string",
          description: "The whole description, Markdown",
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
          description: "Optional: image size in pixels (default 800; larger only to read fine detail)",
        },
        hideZones: {
          type: "boolean",
          description: "true: zones and pins hidden for this picture only — to check surfaces, objects and plants",
        },
      },
    },
  },
];
