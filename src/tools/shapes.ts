// Generic plant shapes become species (SC-192): once the designer has signed off the shape layout, the
// agent gets the species that fit each shape and swaps them in place. Shapes are placed with the tools
// the agent plants with (plant_zones, add_objects, update_objects).

import type { Tool } from "./types.js";

export const tools: Tool[] = [
  {
    name: "suggest_species",
    description:
      "For generic plant shapes, the species that fit them — after the designer has signed off the shape layout, instead of searching the catalog shape by shape. " +
      "Same habit as the shape, mature size within a tolerance of the shape's, suited to the place's light, soil and hardiness; species the shape's label or notes name come first (named). " +
      "Like shapes (same form, label without its number, size) share one entry with their ids; each candidate is one line. " +
      "Shapes no species fits come under `noFit`: tell the designer before the swap.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Shape ids (default: every shape in the design)" },
        light: { type: "string", enum: ["sun", "partShade", "shade"], description: "The place's light (default: read from each shape's notes)" },
        soil: { type: "string", description: "The place's soil, as get_plant_attributes words it" },
        hardinessZone: { type: "number", description: "The place's hardiness zone (Poland 5–7)" },
        limit: { type: "number", description: "Candidates per entry (default 6, max 15)" },
      },
    },
  },
  {
    name: "swap_shapes",
    description:
      "Swap generic plant shapes for species once the designer has signed off the layout: each species stands in its shapes' place at its own catalog size — " +
      "one plant for a tree, shrub or clump; a row half its spread apart along a hedge; plants at their density over a ground-cover mat or a drift, " +
      "which can also take a `mix` of species (neighbours differ). The whole call is one undo step. `differs` says where a species' size is outside its shape's. " +
      "Show the design before and after and ask the designer to approve; if they don't, `undo` brings the shapes back.",
    inputSchema: {
      type: "object" as const,
      properties: {
        swaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ids: { type: "array", items: { type: "string" }, description: "Shapes taking this species (an entry of suggest_species)" },
              productId: { type: "string", description: "The species (from suggest_species)" },
              productQuery: { type: "string", description: "Or its name" },
              mix: {
                type: "array",
                description: "Ground cover and drifts only: several species mixed over the area, instead of productId",
                items: { type: "object", properties: { productId: { type: "string" }, productQuery: { type: "string" } } },
              },
            },
            required: ["ids"],
          },
        },
      },
      required: ["swaps"],
    },
  },
];
