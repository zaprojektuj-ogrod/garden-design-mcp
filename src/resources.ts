// MCP Resources — read-only context the agent can reference

import { sendToBrowser } from "./bridge.js";

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const RESOURCES: ResourceDefinition[] = [
  {
    uri: "garden://info",
    name: "Garden Info",
    description: "Garden metadata: ID, name, rotation, boundary, object counts",
    mimeType: "application/json",
  },
  {
    uri: "garden://zones",
    name: "Zones",
    description: "All zones in the garden as JSON",
    mimeType: "application/json",
  },
  {
    uri: "garden://pins",
    name: "Pins",
    description: "All context pins in the garden",
    mimeType: "application/json",
  },
  {
    uri: "garden://objects",
    name: "Garden Objects",
    description: "All garden objects (plants, buildings, ground shapes)",
    mimeType: "application/json",
  },
  {
    uri: "garden://coordinate-system",
    name: "Coordinate System",
    description: "Coordinate system documentation (units, axes, scale)",
    mimeType: "application/json",
  },
];

/**
 * Read a resource by URI. Most forward to the browser; coordinate-system is static.
 */
export async function readResource(uri: string): Promise<string> {
  switch (uri) {
    case "garden://info": {
      const result = await sendToBrowser("get_garden_info", {});
      return JSON.stringify(result, null, 2);
    }
    case "garden://zones": {
      const result = await sendToBrowser("get_zones", {});
      return JSON.stringify(result, null, 2);
    }
    case "garden://pins": {
      const result = await sendToBrowser("get_pins", {});
      return JSON.stringify(result, null, 2);
    }
    case "garden://objects": {
      const result = await sendToBrowser("get_objects", {});
      return JSON.stringify(result, null, 2);
    }
    case "garden://coordinate-system": {
      return JSON.stringify(
        {
          dotsPerMeter: 50,
          origin: "top-left",
          axes: { x: "rightward", y: "downward" },
          rotationUnit: "degrees",
          rotationDirection: "clockwise",
          elevationUnit: "meters",
        },
        null,
        2
      );
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}
