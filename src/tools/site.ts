// Phase 1: Site tools — geocoding, parcel lookup, boundary import, photos, geo-anchor

import type { Tool } from "./types.js";

export const tools: Tool[] = [
  {
    name: "geocode_address",
    description:
      "Find an address anywhere in the world (OpenStreetMap Nominatim). Returns {address, lat, lon, countryCode}; " +
      "countryCode is ISO 3166-1 alpha-2 in lower case. The land-registry tools (get_parcel_by_*, import_parcel) " +
      "work only for countryCode 'pl'; elsewhere set the garden's place with set_geo_anchor and the plot's boundary " +
      "with set_boundary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description:
            "Address or place to find, e.g., 'Warszawa, Marszałkowska 1' or '10 Downing Street, London'",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "get_parcel_by_coordinates",
    description: "Get parcel information by WGS84 coordinates (lat/lon). Poland only: refused for a garden placed outside Poland.",
    inputSchema: {
      type: "object" as const,
      properties: {
        lat: { type: "number", description: "Latitude (WGS84)" },
        lon: { type: "number", description: "Longitude (WGS84)" },
      },
      required: ["lat", "lon"],
    },
  },
  {
    name: "get_parcel_by_id",
    description: "Get parcel information by parcel ID. Poland only: refused for a garden placed outside Poland.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parcelId: {
          type: "string",
          description: "Parcel ID, e.g., '146510_8.0310.60'",
        },
      },
      required: ["parcelId"],
    },
  },
  {
    name: "get_parcel_by_address",
    description:
      "Get parcel information by address (geocodes then looks up parcel). Poland only: refused for a garden placed outside Poland.",
    inputSchema: {
      type: "object" as const,
      properties: {
        address: {
          type: "string",
          description: "Polish address to find parcel for",
        },
      },
      required: ["address"],
    },
  },
  {
    name: "import_parcel",
    description:
      "Import a parcel as the garden's site context: sets the scheme outline, geo-anchor, and (by default) auto-loads the KIEG WMS cadastral/satellite map background so `capture_preview` shows real site context (neighbors, road, vegetation) under the boundary. Default alignment is `north_up` so cardinal reasoning (\"south wall\", \"west fence\") works naturally; pass `side_aligned` if you'd rather draw on an axis-aligned canvas. WMS failure is non-fatal — boundary + geo-anchor still land and the response carries `mapBackground: { loaded: false, reason }` so you can decide whether to retry or continue without the background. Pass `loadMapBackground: false` to skip the WMS fetch entirely (faster; useful for headless evals). Poland only: refused for a garden placed outside Poland — draw the boundary with set_boundary instead.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parcelId: {
          type: "string",
          description:
            "Parcel ID to import (use get_parcel_by_* first to find it)",
        },
        alignment: {
          type: "string",
          enum: ["north_up", "side_aligned"],
          description:
            "Boundary orientation. `north_up` (default) keeps north pointing up; `side_aligned` rotates so the longest edge runs horizontally. The alignment modal that the editor would normally show for skewed parcels is bypassed when called via MCP.",
        },
        loadMapBackground: {
          type: "boolean",
          description:
            "Auto-load the KIEG WMS cadastral/satellite map background after import. Default `true`. Set `false` to skip the WMS fetch (faster; `capture_preview` will then show the parcel on a blank background and `get_garden_info().hasScheme` stays `false`).",
        },
      },
      required: ["parcelId"],
    },
  },
  {
    name: "import_buildings",
    description:
      "Scan the imported parcel + 10 m margin via ULDK and add discovered building footprints as `building` zones. Requires `import_parcel` first — uses the current parcel and geo-anchor. Blocks until the scan completes; **typically 1–2 minutes for a residential parcel** because ULDK is slow, so do not retry on perceived stalls. Re-runs are safe: buildings already imported are deduped by `parcelBuildingId` and reported under `skipped`. Returns `{ success, count, added, skipped, buildings: [{ zoneId, parcelBuildingId, functionLabel, centerX, centerY, width, height }] }` (meters). The largest building whose center sits inside the parcel is usually the user's house; the rest are neighbors. Poland only: refused for a garden placed outside Poland.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_site_analysis",
    description:
      "Measured site facts for placing pins and zones, computed from the parcel boundary and building zones (call after import_parcel + import_buildings). Returns (metres, garden coordinates): the parcel area and its edges by compass side; the user's house (largest building centred in the parcel) with each facade's compass side, length, from/to endpoints, midpoint, outward normal, whether it is a shared (party) wall, and `gardenDepth` — the free distance from the facade straight out to the boundary; neighbouring buildings with direction and whether attached; total garden area. Use it to put door pins ON the right facade and to check whether a terrace or bed fits on a side before drawing zones.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "set_geo_anchor",
    description:
      "Set the garden's place: the real-world point (WGS84) at the editor origin. The plot becomes placed — " +
      "north, sunlight and the OpenStreetMap background follow it — and the change is unsaved until save. " +
      "Use it for a plot outside Poland (after geocode_address), then give the boundary with set_boundary; " +
      "import_parcel sets both for a Polish parcel.",
    inputSchema: {
      type: "object" as const,
      properties: {
        lat: { type: "number", description: "Anchor latitude (WGS84)" },
        lon: { type: "number", description: "Anchor longitude (WGS84)" },
        editorX: {
          type: "number",
          description: "Editor X coordinate (default 0)",
        },
        editorY: {
          type: "number",
          description: "Editor Y coordinate (default 0)",
        },
        dotsPerMeter: {
          type: "number",
          description: "Scale factor (default 50)",
        },
      },
      required: ["lat", "lon"],
    },
  },
  {
    name: "set_boundary",
    description:
      "Set the plot's boundary from a polygon — for a plot outside Poland, one the land registry gets wrong, or " +
      "the designer's measurements (\"18 by 25 m\"). Absolute vertices in metres, in the garden coordinates " +
      "zones use (the garden's place is at 0,0; x east, y south when north is up), e.g. traced from the " +
      "OpenStreetMap background in capture_preview. Replaces any boundary; the change is unsaved until save. " +
      "A placed plot becomes located and the map refits around it. Returns {area (m²), plot: 'located' | 'unlocated'}.",
    inputSchema: {
      type: "object" as const,
      properties: {
        polygon: {
          type: "array",
          description: "The boundary's corners in order, at least 3, absolute metres",
          items: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
      },
      required: ["polygon"],
    },
  },
  {
    name: "set_map_background",
    description:
      "Switch a map background under the garden on or off. 'osm' is the live OpenStreetMap map, about 100 m " +
      "around the plot, turning with the garden; 'satellite' is the aerial photo of the same area (Poland only: the " +
      "national orthophoto; elsewhere it answers that there is no photo) — fences, hedges, trees and paths show " +
      "there, not on the street map. Both need the garden's place (set_geo_anchor or import_parcel), are loaded " +
      "live and start off each time the garden opens. 'survey' is the survey map laid with set_survey_map (false " +
      "hides it, true shows it again). They show in capture_preview and hide with the 'map' layer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["osm", "satellite", "survey"], description: "Which background" },
        visible: { type: "boolean", description: "true to show it, false to remove it" },
      },
      required: ["kind", "visible"],
    },
  },
  {
    name: "zoom_image",
    description:
      "Look closer at an image the designer attached in the chat (e.g. a survey map) to place points precisely. " +
      "Attached images arrive labelled \"Image 1\", \"Image 2\"…; each is a view (\"1\") in the pixels you see. " +
      "Returns a close-up of the full-size original around a point of a view, as a new view (\"1.1\", \"1.2\"…) " +
      "with its own pixels. Points for set_survey_map and map_to_garden are given on any view. " +
      "Only in the editor's own chat, where images are attached.",
    inputSchema: {
      type: "object" as const,
      properties: {
        view: { type: "string", description: "The image (\"1\") or an earlier close-up (\"1.2\")" },
        x: { type: "number", description: "Centre of the close-up, pixels from the left of that view" },
        y: { type: "number", description: "Centre of the close-up, pixels from the top of that view" },
        size: { type: "number", description: "Side of the region in that view's pixels (default 200)" },
      },
      required: ["view", "x", "y"],
    },
  },
  {
    name: "set_survey_map",
    description:
      "Lay a map of the land drawn to scale (survey map, site plan, sketch with its lengths) that the designer " +
      "attached in the chat under the garden, as a map background. Either `matches`: two or more points on the map " +
      "matched to the same points in the garden (garden metres, e.g. boundary corners from get_garden_info) — " +
      "scale, turn and position are fitted; from three matches you get how far each lands from its garden point. " +
      "Or `measure` (a plot with no place or boundary): two points on the map and the real distance between them " +
      "— the map lies to scale, as drawn, `from` at `at`. Pick points far apart, zoom_image to place them exactly, " +
      "then check with capture_preview. Laying again replaces the map. The next save keeps it with the garden, " +
      "in the place of a kept cadastral map (which can still be downloaded and shown).",
    inputSchema: {
      type: "object" as const,
      properties: {
        matches: {
          type: "array",
          description: "Two or more points matched on the map and in the garden",
          items: {
            type: "object",
            properties: {
              map: {
              type: "object",
              properties: {
                view: { type: "string", description: "The image or close-up the point is on: \"1\" (image 1 as you see it), \"1.2\" (a close-up)" },
                x: { type: "number", description: "Pixels from the left of that view" },
                y: { type: "number", description: "Pixels from the top of that view" },
              },
              required: ["view", "x", "y"],
            },
              garden: {
                type: "object",
                properties: { x: { type: "number", description: "metres" }, y: { type: "number", description: "metres" } },
                required: ["x", "y"],
              },
            },
            required: ["map", "garden"],
          },
        },
        measure: {
          type: "object",
          description: "Two points on the map and the real distance between them",
          properties: {
            from: {
              type: "object",
              properties: {
                view: { type: "string", description: "The image or close-up the point is on: \"1\" (image 1 as you see it), \"1.2\" (a close-up)" },
                x: { type: "number", description: "Pixels from the left of that view" },
                y: { type: "number", description: "Pixels from the top of that view" },
              },
              required: ["view", "x", "y"],
            },
            to: {
              type: "object",
              properties: {
                view: { type: "string", description: "The image or close-up the point is on: \"1\" (image 1 as you see it), \"1.2\" (a close-up)" },
                x: { type: "number", description: "Pixels from the left of that view" },
                y: { type: "number", description: "Pixels from the top of that view" },
              },
              required: ["view", "x", "y"],
            },
            metres: { type: "number", description: "Real distance between the two points" },
            at: {
              type: "object",
              description: "Where `from` lies in the garden, metres (default 0, 0)",
              properties: { x: { type: "number" }, y: { type: "number" } },
            },
          },
          required: ["from", "to", "metres"],
        },
      },
    },
  },
  {
    name: "map_to_garden",
    description:
      "Where points on the laid survey map are in the garden, in metres — e.g. the plot's corners read off the map, " +
      "for set_boundary. Points are given on any view of the laid map's image (see zoom_image).",
    inputSchema: {
      type: "object" as const,
      properties: {
        points: { type: "array", items: {
              type: "object",
              properties: {
                view: { type: "string", description: "The image or close-up the point is on: \"1\" (image 1 as you see it), \"1.2\" (a close-up)" },
                x: { type: "number", description: "Pixels from the left of that view" },
                y: { type: "number", description: "Pixels from the top of that view" },
              },
              required: ["view", "x", "y"],
            } },
      },
      required: ["points"],
    },
  },
  {
    name: "get_geo_anchor",
    description: "Get the current geo-anchor (if set)",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "upload_reference_photo",
    description:
      "Upload a reference photo (house exterior, current garden). Stored in-session. The AI agent can analyze photos via its own vision capabilities.",
    inputSchema: {
      type: "object" as const,
      properties: {
        dataUri: {
          type: "string",
          description: "Base64 data URI of the image",
        },
        label: {
          type: "string",
          description:
            "Label for the photo, e.g., 'House front', 'Garden view from kitchen'",
        },
      },
      required: ["dataUri", "label"],
    },
  },
  {
    name: "get_reference_photos",
    description: "Get all uploaded reference photos for this session",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];
