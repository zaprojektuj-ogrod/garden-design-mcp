// Re-export all tool definitions from phase modules

import { tools as siteTools } from "./site.js";
import { tools as contextTools } from "./context.js";
import { tools as zonesTools } from "./zones.js";
import { tools as detailingTools } from "./detailing.js";
import { tools as reviewTools } from "./review.js";
import { tools as houseTools } from "./house.js";

/** Every tool the dispatch serves */
export const EVERY_TOOL = [
  ...siteTools,
  ...contextTools,
  ...zonesTools,
  ...detailingTools,
  ...reviewTools,
  ...houseTools,
];

/**
 * Served but not listed: every definition rides along with each request, so the list leaves out
 * the one-item twins of the batch tools and tools the agent has no use for. Callers that name
 * them (test harnesses, older prompts) still get an answer.
 */
export const UNLISTED = new Set([
  // the batch tool does the same for one item
  "add_object", "add_zone", "add_pin", "update_object", "delete_object",
  // the designer has these in the editor; the agent never needed them
  "undo", "redo", "clear_all", "export_state", "import_state",
  "set_units", "get_view_mode", "get_layer_visibility", "get_coordinate_system", "get_zone_types",
]);

/** The tools a model is offered */
export const ALL_TOOLS = EVERY_TOOL.filter((t) => !UNLISTED.has(t.name));

export type { Tool } from "./types.js";
