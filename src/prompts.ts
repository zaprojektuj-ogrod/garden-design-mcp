// MCP Prompts — workflow templates for the agent

export interface PromptDefinition {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export const PROMPTS: PromptDefinition[] = [
  {
    name: "start_design",
    description:
      "Begin a new garden design from scratch, as the editor's guided set-up does: the site and what already exists first, then the zones and the detailing, each step signed off.",
  },
  {
    name: "continue_design",
    description:
      "Resume working on an existing garden. Reads zone notes and garden description to assess checklist gaps, then suggests next steps.",
  },
  {
    name: "optimize_zones",
    description:
      "Review and optimize zone layout. Uses density/coverage analysis, boundary checks, and spacing validation to identify issues.",
  },
];

/**
 * Get the prompt template messages for a given prompt name.
 */
export function getPromptMessages(
  name: string,
  _args?: Record<string, string>
): Array<{ role: "user"; content: { type: "text"; text: string } }> {
  switch (name) {
    case "start_design":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Help me design my garden, step by step.

Call get_design_guide and get_full_state first. For an empty garden, follow the guide's site stage: ask for the address only, locate the plot, draw what already exists as a locked baseline, place the doors, then stop for my sign-off before asking what I want. After that, the zones in three passes and the detailing in three passes, each signed off.

Talk to me as the guide says: a few short lines, one question at a time, no ids or tables; make your best guess, show it, and ask me to confirm.`,
          },
        },
      ];

    case "continue_design":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Resume working on an existing garden design:

1. Call get_full_state to read the current garden state.
2. Check the garden description for prior context and design decisions.
3. Run through the garden-level checklist: boundary? geo-anchor? north? pins? zones? description?
4. For each zone, read its notes to determine per-zone status (empty / in-progress / complete).
5. Check the per-zone checklist: purpose documented? ground surface? objects? spacing? density? plant suitability? labels?
6. Identify the biggest gaps and suggest concrete next actions.

Summarize what you find and propose what to work on next.`,
          },
        },
      ];

    case "optimize_zones":
      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `Review the current boundary and zone layout. Check for:

- Zones that overlap each other
- Zones that extend beyond the boundary
- Unused space within the boundary
- Zones that conflict with context pins (e.g., relaxation zone facing a bad view)
- Spacing violations (less than 1m between zones for paths)

For each planting zone, call get_zone_analysis to check:
- Planting density (aim for 70-90% coverage)
- Boundary violations (objects outside zone bounds)
- Spacing between objects

Use get_zones, get_pins, and get_garden_info for current state.
Present findings clearly and suggest rearrangements with trade-offs.`,
          },
        },
      ];

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
