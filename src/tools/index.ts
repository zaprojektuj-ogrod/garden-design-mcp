// Re-export all tool definitions from phase modules

import { tools as siteTools } from "./site.js";
import { tools as contextTools } from "./context.js";
import { tools as zonesTools } from "./zones.js";
import { tools as detailingTools } from "./detailing.js";
import { tools as reviewTools } from "./review.js";

export const ALL_TOOLS = [
  ...siteTools,
  ...contextTools,
  ...zonesTools,
  ...detailingTools,
  ...reviewTools,
];

export type { Tool } from "./types.js";
