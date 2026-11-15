// The designer's own house (G36): the agent builds the 3D house standing on the plot from photos,
// step by step, out of simple blocks; kept with the garden as its description. Metres throughout.

import type { Tool } from "./types.js";

const FRAME =
  "House frame: stand in front of the house facing its front facade; x runs to your right, z towards you, metres from the main block's centre. " +
  "Facades: front, back, left, right as seen from the front. An opening's offset is measured on its own facade standing outside facing it: from that facade's LEFT end to the opening's centre.";

const HOUSE = { house: { type: "string", description: "House id (default: the last built)" } };
const BLOCK = { block: { type: "string", description: "Block id (default: main)" } };
const COLOR = { type: "string", description: "Hex colour as seen in daylight, e.g. #e9e7e1" };
const WALL_MATERIALS = ["render", "brick", "cladding-vertical", "cladding-horizontal", "stone", "concrete", "glass"];

export const tools: Tool[] = [
  {
    name: "house_build",
    description:
      "Build the 3D model of a house on its building outline (from import_buildings), at true size and in its place: the main block — walls up to the eaves and a plain gable roof, default colours. " +
      "Then shape it step by step: house_set_roof, house_set_walls, house_set_openings, and house_set_block for further blocks (a wing, a garage, a porch) assembled from the same simple boxes-with-roofs. " +
      "A porch, carport or pergola is posts plus an open block: posts are thin blocks (about 0.15 × 0.15 m, no roof), the roof an open block (open: true) at the eave height. " +
      "Tell it which compass side the front (entrance) facade faces — read it from the photos and get_site_analysis. Calling it again starts that house over. " +
      "Look at the result after each step with house_preview and compare it with the photos. " + FRAME,
    inputSchema: {
      type: "object",
      properties: {
        zoneId: { type: "string", description: "The building outline's zone id (default: the largest building)" },
        front: { type: "string", description: "Compass side the front facade faces: N, NE, E, SE, S, SW, W, NW (or degrees)" },
        wallHeight: { type: "number", description: "Ground to the eaves, m (about 2.8–3.2 for one storey, 5.5–6.5 for two)" },
        plinthHeight: { type: "number", description: "A raised base band under the walls, m (0 = none)" },
        name: { type: "string" },
      },
      required: ["front", "wallHeight"],
    },
  },
  {
    name: "house_set_block",
    description:
      "Add, change or remove a block of the house — a box with its own walls, roof and openings: a wing (L or T shape), a garage, a porch, a bay. " +
      "A new block needs center, width, depth and wallHeight; it takes the main block's walls and roof material, with a gable roof you can change with house_set_roof {block}. " +
      "Open roofs on posts — a porch on posts, a carport, a pergola: add the posts as thin blocks (width and depth 0.4 m or less: they get no roof and no plinth; give them a wood, render or concrete finish with house_set_walls), " +
      "then the roof as a block with open: true (no walls; its roof hangs at its wallHeight, a gable's ends stay clad; a plinthHeight gives it a deck underneath) and set its roof (gable, shed or flat — a flat one is a thin sheet). " +
      "Blocks may overlap the main block (a wing joined to it). The main block's size and place come from the outline: change only its wallHeight here. " + FRAME,
    inputSchema: {
      type: "object",
      properties: {
        ...HOUSE,
        block: { type: "string", description: "Block id: a new id adds a block (e.g. garage, wing, porch)" },
        kind: { type: "string", enum: ["house", "garage", "porch", "extension"] },
        center: { type: "object", properties: { x: { type: "number" }, z: { type: "number" } }, description: "Block centre in the house frame, m" },
        width: { type: "number", description: "Along x (left to right as seen from the front), m" },
        depth: { type: "number", description: "Along z (front to back), m" },
        wallHeight: { type: "number", description: "Ground to the eaves, m" },
        plinthHeight: { type: "number", description: "This block's base band (e.g. 0 for a garage)" },
        open: { type: "boolean", description: "Open sides: no walls, the roof hangs at wallHeight (a porch's or carport's roof on posts)" },
        remove: { type: "boolean" },
      },
    },
  },
  {
    name: "house_set_roof",
    description:
      "Set a block's roof: gable (two slopes, triangular gable walls), hip (slopes on all four sides), shed (one slope falling towards lowSide), flat. " +
      "ridge 'parallel' runs the ridge along the front facade (gables on left and right); 'perpendicular' puts a gable on the front. " +
      "Also the chimneys (whole house) and solar panels (this block's slopes). " + FRAME,
    inputSchema: {
      type: "object",
      properties: {
        ...HOUSE, ...BLOCK,
        type: { type: "string", enum: ["gable", "hip", "shed", "flat", "none"], description: "none: no roof (a post)" },
        ridge: { type: "string", enum: ["parallel", "perpendicular"], description: "Ridge direction relative to the front facade" },
        ridgeHeight: { type: "number", description: "Ground to the ridge (shed: to the high edge), m" },
        eaveHeight: { type: "number", description: "Ground to the eaves, m (the block's wall height)" },
        ridgeOffset: { type: "number", description: "gable: the ridge shifted off the middle, m (towards +z for a parallel ridge, +x for a perpendicular one)" },
        overhang: { type: "number", description: "How far the roof sticks out past the walls, m (default 0.4)" },
        material: { type: "string", enum: ["tiles", "shingles", "metal", "membrane", "glass"] },
        color: COLOR,
        lowSide: { type: "string", enum: ["front", "back", "left", "right"], description: "shed: the side the slope falls towards" },
        chimneys: {
          type: "array",
          description: "Replaces the house's chimneys. x, z: centre in the house frame; top: ground to the chimney top",
          items: { type: "object", properties: { x: { type: "number" }, z: { type: "number" }, width: { type: "number" }, depth: { type: "number" }, top: { type: "number" }, material: { type: "string", enum: ["brick", "render", "metal"] }, color: COLOR } },
        },
        solar: {
          type: "array",
          description: "Replaces this block's solar panels: per slope (roofSide = the facade that slope faces), cols × rows panels of about 1.1 × 1.7 m",
          items: { type: "object", properties: { roofSide: { type: "string", enum: ["front", "back", "left", "right"] }, cols: { type: "number" }, rows: { type: "number" }, orientation: { type: "string", enum: ["portrait", "landscape"] }, offset: { type: "number", description: "Shift along the ridge, m" } } },
        },
      },
    },
  },
  {
    name: "house_set_walls",
    description:
      "Set the walls' finish and colour: render, brick, cladding-vertical, cladding-horizontal, stone, concrete, glass. " +
      "lowerBand gives a different finish from the ground up to its height (e.g. grey render on the ground floor, white above; null removes it). block 'all' sets every block.",
    inputSchema: {
      type: "object",
      properties: {
        ...HOUSE,
        block: { type: "string", description: "Block id, or 'all' (default: main)" },
        material: { type: "string", enum: WALL_MATERIALS },
        color: COLOR,
        lowerBand: { type: "object", properties: { height: { type: "number" }, material: { type: "string", enum: WALL_MATERIALS }, color: COLOR }, description: "A different finish from the ground up to its height; null removes it" },
        plinthHeight: { type: "number", description: "The base band under the walls, m" },
        plinthColor: COLOR,
      },
    },
  },
  {
    name: "house_set_openings",
    description:
      "Set the windows, doors and facade panels of ONE facade of a block (replaces that facade's list; [] clears it). " +
      "Kinds: window, door, patio-door (glazed door), garage-door, panel (a flat panel of another finish, e.g. wooden cladding between windows — give material and color). " +
      "Measure from the photos in proportion to known sizes (a door is about 2.05 × 0.95 m). Windows in a gable above the eaves go on that gable's facade. " + FRAME,
    inputSchema: {
      type: "object",
      properties: {
        ...HOUSE, ...BLOCK,
        facade: { type: "string", enum: ["front", "back", "left", "right"] },
        openings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["window", "door", "patio-door", "garage-door", "panel"] },
              offset: { type: "number", description: "From the facade's left end (seen from outside) to the centre, m" },
              width: { type: "number" },
              height: { type: "number" },
              sill: { type: "number", description: "Ground to the bottom, m" },
              panes: { type: "object", properties: { cols: { type: "number" }, rows: { type: "number" } } },
              frameColor: COLOR,
              color: { type: "string", description: "Door / garage door / panel colour" },
              material: { type: "string", enum: WALL_MATERIALS, description: "panel: its finish" },
              surround: { type: "object", properties: { width: { type: "number" }, color: COLOR }, description: "A flat band around a window or door" },
            },
            required: ["kind", "offset", "width", "height"],
          },
        },
      },
      required: ["facade", "openings"],
    },
  },
  {
    name: "house_preview",
    description:
      "Pictures of the house as built so far, on its own (no garden around it), from the sides you ask: front-left, front-right, back-left, back-right, front, back, left, right, top. " +
      "Use it after each step to compare with the photos, and fix what differs. Default: front-left and back-right.",
    inputSchema: {
      type: "object",
      properties: {
        ...HOUSE,
        views: { type: "array", items: { type: "string", enum: ["front-left", "front-right", "back-left", "back-right", "front", "back", "left", "right", "top"] } },
        size: { type: "number", description: "Picture width in pixels (320–1024, default 640)" },
      },
    },
  },
  {
    name: "house_get",
    description: "The house as built so far: its position (for focus_on), which compass side each facade faces, every block with its roof, walls and openings, chimneys, solar panels.",
    inputSchema: { type: "object", properties: { ...HOUSE } },
  },
];
