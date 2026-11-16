// Phase 4: Detailing tools — product catalog, garden object CRUD, generic plant shapes

import type { Tool } from "./types.js";

/** The generic plant shapes' forms (public/shapes/shapes.json), in the order the editor offers them */
export const SHAPE_FORMS = [
  "tree_round", "tree_oval", "tree_conical", "tree_columnar", "tree_weeping", "tree_spreading",
  "shrub_round", "shrub_conical", "shrub_columnar", "shrub_upright", "shrub_spreading",
  "clump", "groundcover", "hedge", "climber",
];

/** The forms in a few lines: what each stands for and its range, so sizes are given within it */
export const SHAPE_NOTE =
  "Generic plant shapes stand for no species, only a form (SC-191): trees tree_round/oval/conical/columnar/weeping/spreading " +
  "(2–25 m tall); shrubs shrub_round/conical/columnar/upright/spreading (0.2–6 m); clump = a drift of perennials or grasses " +
  "(0.15–2.5 m tall, width = the drift's diameter); groundcover = a low mat (≤ 0.5 m, width = its diameter: 1, 2 or 4 m); " +
  "hedge = a line (0.3–4 m tall, 0.3–2 m thick); climber = a panel on a wall or fence. Sizes are mature, in metres; " +
  "a size outside the form's range is set to its edge and the reply says so; with no size, the form's middle size.";

const OBJECT_SPEC_SCHEMA = {
  type: "object" as const,
  properties: {
    type: {
      type: "string",
      enum: ["plant", "building", "rectangle", "ellipse", "polygon", "path", "shape"],
      description: "Object type; `shape` = a generic plant shape (no product): give `shape`, not productId",
    },
    shape: {
      type: "string",
      enum: SHAPE_FORMS,
      description: "type=shape: the form",
    },
    tall: {
      type: "number",
      description: "type=shape: how tall it grows, m (a crown given only its width keeps its proportions)",
    },
    line: {
      type: "array",
      description: "type=shape, a hedge: [[x1, y1], [x2, y2]] in metres, end to end — sets x, y, width (its length) and rotation",
      items: { type: "array", items: { type: "number" } },
    },
    notes: {
      type: "string",
      description: "type=shape: what the species must bring, for the swap later (evergreen, flowers, sun or shade); a species the designer named goes in the label",
    },
    productId: {
      type: "string",
      description: "Product ID from the catalog (use this OR productQuery)",
    },
    productQuery: {
      type: "string",
      description:
        "Product name search query — resolved server-side. If ambiguous, returns error with top candidates. Use this OR productId.",
    },
    x: {
      type: "number",
      description: "Center X, m",
    },
    y: {
      type: "number",
      description: "Center Y, m",
    },
    width: {
      type: "number",
      description: "Footprint size east–west, m; optional, defaults to product catalog value. Ignored for plants: they are drawn at their mature catalog size and cannot be resized. A shape: its spread, or a hedge's or climber's length.",
    },
    height: {
      type: "number",
      description: "Footprint size north–south (plan depth, not how tall it is), m; optional, defaults to product catalog value. Ignored for plants (mature catalog size). A shape: its depth across (a hedge's thickness, an oval mat's other diameter).",
    },
    rotation: {
      type: "number",
      description: "Rotation in degrees (default 0)",
    },
    elevation: {
      type: "number",
      description: "Ground surfaces only: how high the surface is raised, in metres (a deck, a raised strip of soil). Architecture — raised beds, planters, furniture — always stands at its catalog height, as its model is drawn, and plants in it stand on that; a value given for it is ignored (choose a taller product instead). Not the footprint: that is width × height.",
    },
    label: { type: "string", description: "Custom label" },
    zoneId: {
      type: "string",
      description:
        "Optional zone ID — if provided, validates that the object center falls within the zone boundary. Returns warning if outside. Placement always succeeds.",
    },
    polygon: {
      type: "array",
      description:
        "Surface outline as ABSOLUTE vertices in metres (for type=polygon), exactly as add_zones takes it — e.g. a zone's outline from get_zones. Preferred over points; x/y/width/height are then computed.",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    },
    path: {
      type: "object",
      description:
        "Surface corridor as an ABSOLUTE centreline in metres plus width (for type=path), exactly as add_zones takes it. Preferred over pathWaypoints/pathWidth.",
      properties: {
        waypoints: {
          type: "array",
          items: {
            type: "object",
            properties: { x: { type: "number" }, y: { type: "number" } },
            required: ["x", "y"],
          },
        },
        width: { type: "number" },
      },
      required: ["waypoints", "width"],
    },
    points: {
      type: "array",
      description:
        "Polygon vertices (for type=polygon), RELATIVE to the object's centre x/y — use `polygon` (absolute) instead unless you have centre-relative points",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    },
    pathWaypoints: {
      type: "array",
      description:
        "Centerline waypoints (for type=path), RELATIVE to the object's centre x/y — use `path` (absolute) instead. At least 2 points required.",
      items: {
        type: "object",
        properties: {
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["x", "y"],
      },
    },
    pathWidth: {
      type: "number",
      description:
        "Path corridor width, m; for type=path, default 1m",
    },
  },
  required: ["type"] as string[],
};

export const tools: Tool[] = [
  {
    name: "search_products",
    description:
      "Search the product catalog. Filter by layer (ground/architecture/plants), text query, or category.",
    inputSchema: {
      type: "object" as const,
      properties: {
        layer: {
          type: "string",
          enum: ["ground", "architecture", "plants"],
          description: "Product layer to search within",
        },
        query: {
          type: "string",
          description: "Text search query — matches product name only (the `code` field is NOT searched; if you have a PL00xxx-style code, look it up separately)",
        },
        categoryId: {
          type: "string",
          description:
            "Category id to filter by. For architecture and ground (flat trees), use any id from get_categories. For plants (two-level tree), this must be a leaf id from get_subcategories(<top-level id>) — top-level plant ids return 0 because plant products are assigned only to leaves. For plant discovery prefer search_plants (attribute filtering); categoryId is most useful for architecture/ground browsing.",
        },
        page: { type: "number", description: "Page number (default 1)" },
        perPage: {
          type: "number",
          description: "Results per page (default 20)",
        },
      },
    },
  },
  {
    name: "get_categories",
    description:
      "Get product categories for a layer. Architecture and ground are flat (1-level): any returned id works directly with search_products.categoryId. Plants use a 2-level tree: this returns only the top-level groups (Drzewa, Krzewy, Pnącza, Byliny, Trawy Ozdobne); to filter search_products by plant category you must follow up with get_subcategories(<top-level id>) and pass a leaf id.",
    inputSchema: {
      type: "object" as const,
      properties: {
        layer: {
          type: "string",
          enum: ["ground", "architecture", "plants"],
          description: "Product layer",
        },
      },
      required: ["layer"],
    },
  },
  {
    name: "get_subcategories",
    description:
      "Get the leaf subcategories of a top-level plant category. Plants use a two-level tree (6 top-level → leaves); search_products's categoryId filter requires a leaf id. Architecture and ground are flat — calling this on their top-level ids returns []. Locale follows the editor session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        parentId: {
          type: "string",
          description: "Top-level category id from get_categories",
        },
      },
      required: ["parentId"],
    },
  },
  {
    name: "get_product_details",
    description: "Get full details for a specific product by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        productId: {
          type: "string",
          description: "Product ID",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "get_plant_info",
    description:
      "A plant's catalog footprint and botanical facts: characteristics (height, spread, form, foliage, flowers), requirements (soil, sunlight, hardiness), maintenance level and spacing. Check finalists only — search_plants already gives every match's mature height and spread.",
    inputSchema: {
      type: "object" as const,
      properties: {
        productId: {
          type: "string",
          description: "Product ID of the plant to look up",
        },
        full: {
          type: "boolean",
          description: "true: also the seasonal care, pests and installation notes — only when the designer asks about care",
        },
      },
      required: ["productId"],
    },
  },
  {
    name: "get_plant_attributes",
    description:
      "Returns the full vocabulary of selectable plant filter values for the current viewer locale: enum lists (flowerColor, bloomPeriod, sunlight, soil, foliageType, foliageColor, maintenanceLevel, form) and observed numeric ranges (height, spread, hardiness). Call this BEFORE search_plants so you pick only valid values; values not in this vocabulary will yield empty results from search_plants. Lazy-loaded once per session and cached.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "search_plants",
    description:
      "Filter the plant catalog by botanical attributes. Returns lean records ({productId, botanicalName, commonName, height, spread, kind} — mature height and spread in metres, the top of each range). Filter by `kind` (grass, perennial, shrub…) instead of guessing names: the catalog is small, and a name you know may not be in it. Call get_plant_attributes first to discover valid filter values for the current locale. Multi-value filters use OR semantics (any value matches); different filters are AND-combined. Range filters use overlap semantics (a plant's range must intersect the requested range). Capped at limit (default 25, max 100); response includes total + truncated flag. Use get_plant_info only to check a finalist's requirements. Falls back to a loud error if the index is unavailable on the CDN — agents should retry name-based queries via search_products in that case.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Optional substring match (case-insensitive) on botanicalName OR commonName. No diacritic stripping — pass terms as they appear in the locale (e.g. 'Jeżówka', not 'jezowka'). Exact matches are ranked first.",
        },
        kind: {
          type: "array",
          items: { type: "string", enum: ["tree", "shrub", "climber", "perennial", "grass", "herb", "bulb", "fruit", "other"] },
          description: "Catalog kinds; any of them matches (e.g. [\"grass\"], [\"perennial\", \"herb\"]). Fruit = fruiting perennials such as strawberries; fruit bushes are shrubs.",
        },
        flowerColor: {
          type: "array",
          items: { type: "string" },
          description: "OR-match against the plant's flowerColor array. Use values from get_plant_attributes.flowerColor.",
        },
        bloomPeriod: {
          type: "array",
          items: { type: "string" },
          description: "OR-match against the plant's bloomPeriod array. Roman months I–XII; use get_plant_attributes.bloomPeriod.",
        },
        sunlight: {
          type: "array",
          items: { type: "string" },
          description: "OR-match against the plant's sunlight array. Use values from get_plant_attributes.sunlight.",
        },
        soil: {
          type: "array",
          items: { type: "string" },
          description: "OR-match against the plant's soil array. Use values from get_plant_attributes.soil.",
        },
        foliageType: {
          type: "string",
          description: "Exact match against the plant's foliageType. Use a value from get_plant_attributes.foliageType.",
        },
        maintenanceLevel: {
          type: "array",
          items: { type: "string" },
          description: "OR-match against the plant's maintenanceLevel. Use values from get_plant_attributes.maintenanceLevel.",
        },
        height: {
          type: "object",
          properties: {
            min: { type: "number", description: "Lower bound in meters (omit for no lower bound)" },
            max: { type: "number", description: "Upper bound in meters (omit for no upper bound)" },
          },
          description: "Overlap match: the plant's height range must intersect [min, max] (inclusive), metres.",
        },
        spread: {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          description: "Overlap match in METERS, same semantics as height.",
        },
        hardiness: {
          type: "object",
          properties: {
            min: { type: "number" },
            max: { type: "number" },
          },
          description: "Overlap match against the plant's USDA hardiness zone range.",
        },
        hasOrnamentalFruit: { type: "boolean", description: "Exact match." },
        hasOrnamentalBark: { type: "boolean", description: "Exact match." },
        pruningTolerant: { type: "boolean", description: "Exact match." },
        divisionNeeded: { type: "boolean", description: "Exact match." },
        limit: {
          type: "number",
          description: "Max matches returned (default 25, clamped to [1, 100]). The total count of all matches is always returned, so you can detect truncation.",
        },
      },
    },
  },
  {
    name: "get_objects",
    description:
      "Get garden objects (plants, buildings, ground shapes). Default: full array. Optionally filter by layer. Pass count_only=true on large scenes to get aggregated counts ({total, byLayer, byType, byProductId}) instead of the array — avoids exceeding the tool-result token budget.",
    inputSchema: {
      type: "object" as const,
      properties: {
        layer: {
          type: "string",
          enum: ["ground", "architecture", "plants"],
          description: "Optional: Filter by layer",
        },
        count_only: {
          type: "boolean",
          description:
            "When true, return { total, byLayer, byType, byProductId } instead of the full object array. Honors the layer filter. Recommended for scenes with many objects.",
        },
      },
    },
  },
  {
    name: "add_object",
    description:
      "Add a garden object (plant, building, or ground shape). Type determines rendering: 'plant' for plants, 'building' for architecture, 'rectangle'/'ellipse'/'polygon'/'path' for ground shapes. For type='path', provide pathWaypoints (centerline) and pathWidth; the outline polygon is computed automatically. Supply productId OR productQuery (name search resolved server-side). Width/height are optional — if omitted, defaults from the product catalog are used.",
    inputSchema: OBJECT_SPEC_SCHEMA,
  },
  {
    name: "add_objects",
    description:
      "Add garden objects (one or more) in one call. Type determines rendering: 'plant' for plants, 'building' for architecture, 'rectangle'/'ellipse'/'polygon'/'path' for ground shapes, 'shape' for a generic plant shape; a path takes pathWaypoints (centreline) and pathWidth. Each object takes productId OR productQuery (a name search resolved server-side) — a shape takes `shape` instead, sized by width (spread or length), height (depth across) and `tall`; a hedge shape can take `line`. Width/height are optional (catalog defaults; a shape's middle size). Returns `ids` in input order (null where one failed) and `issues` for failures and warnings.\n\n" + SHAPE_NOTE,
    inputSchema: {
      type: "object" as const,
      properties: {
        objects: {
          type: "array",
          description: "Array of object specifications",
          items: OBJECT_SPEC_SCHEMA,
        },
      },
      required: ["objects"],
    },
  },
  {
    name: "plant_zones",
    description:
      "Plant zones with the plants you chose — species (productId) or generic plant shapes (shape + size) — the editor places them: in beds, groups of 3–7 of a kind with canopies touching; in hedge and screen zones, one closed row; a hedge shape becomes one line along the zone, as wide as the zone. Species take their catalog size, shapes the size you give. They line up with the zone's longest edge and stay clear of paths, terraces, buildings, entries, parking, lawn and the plants already there of their own height layer — ground cover goes under shrubs and trees. Use it for all planting (trees and specimen shrubs too, with `count`) instead of placing plants with add_objects — and plant every zone of a pass in one call. Replies per zone: how many of each it planted, the `cover` counted once (aim 0.85–1.0) and `coverByLayer` (ground < 0.5 m, shrub < 3 m, tree).",
    inputSchema: {
      type: "object" as const,
      properties: {
        zones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              zoneId: { type: "string" },
              plants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    productId: { type: "string", description: "A species, or give `shape`" },
                    shape: { type: "string", enum: SHAPE_FORMS, description: "A generic plant shape's form instead of a species" },
                    width: { type: "number", description: "shape: its spread (a clump's or mat's diameter), m; default the form's middle size" },
                    tall: { type: "number", description: "shape: how tall it grows, m" },
                    share: { type: "number", description: "Relative share of the zone's planted area (default 1): more for the main filler and groundcover, less for accents" },
                    count: { type: "number", description: "An exact number instead of a share, e.g. 1 tree or 3 shrubs" },
                    label: { type: "string", description: "Its role in the design (and a species the designer named)" },
                    notes: { type: "string", description: "shape: what the species must bring, for the swap" },
                  },
                },
              },
              layout: { type: "string", enum: ["groups", "row"], description: "groups for beds, row for a hedge or screen; default row when the zone is narrower than 1.6 plants" },
              coverage: { type: "number", description: "Target canopy cover of the zone (default 0.9)" },
              replace: { type: "boolean", description: "Remove the plants already in the zone first (to redo it)" },
            },
            required: ["zoneId", "plants"],
          },
        },
      },
      required: ["zones"],
    },
  },
  {
    name: "update_object",
    description:
      "Update a garden object's position, size, rotation, or swap its product. " +
      "To swap product: pass productId or productQuery. Plants/buildings get new dimensions from catalog; ground shapes keep their shape and only swap texture.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Object ID to update" },
        x: { type: "number", description: "New center X, m" },
        y: { type: "number", description: "New center Y, m" },
        width: { type: "number", description: "New width, m" },
        height: { type: "number", description: "New height, m" },
        rotation: { type: "number", description: "New rotation in degrees" },
        elevation: { type: "number", description: "New elevation in meters — ground surfaces only; architecture keeps its catalog height" },
        label: { type: "string", description: "New label" },
        productId: {
          type: "string",
          description:
            "New product ID — swaps the product. Plants/buildings adopt new catalog dimensions; ground shapes keep shape and swap texture only.",
        },
        productQuery: {
          type: "string",
          description:
            "Product name search — resolved to productId. Use this OR productId.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_object",
    description: "Delete a garden object by ID",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Object ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "update_objects",
    description:
      "Update garden objects (one or more) in one call: position, size, rotation, label, or swap the product with productId or productQuery " +
      "(plants and buildings adopt the new catalog size; ground shapes keep their shape and swap texture only). A generic plant shape resizes " +
      "(width, height, tall) within its form's range and keeps its form; it becomes a species with swap_shapes. Returns `ids` and `issues`.",
    inputSchema: {
      type: "object" as const,
      properties: {
        objects: {
          type: "array",
          description: "Array of update specs, each must include 'id'",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Object ID to update" },
              x: { type: "number", description: "New center X, m" },
              y: { type: "number", description: "New center Y, m" },
              width: { type: "number", description: "New width, m" },
              height: { type: "number", description: "New height, m" },
              rotation: { type: "number", description: "New rotation in degrees" },
              elevation: { type: "number", description: "New elevation in meters — ground surfaces only; architecture keeps its catalog height" },
              label: { type: "string", description: "New label" },
              tall: { type: "number", description: "A shape: how tall it grows, m (a new width alone keeps a crown's proportions; sizes stay within the form's range)" },
              notes: { type: "string", description: "A shape: the notes for its species" },
              productId: {
                type: "string",
                description:
                  "New product ID — swaps the product. Plants/buildings adopt new catalog dimensions; ground shapes keep shape and swap texture only.",
              },
              productQuery: {
                type: "string",
                description:
                  "Product name search — resolved to productId. Use this OR productId.",
              },
            },
            required: ["id"],
          },
        },
      },
      required: ["objects"],
    },
  },
  {
    name: "delete_objects",
    description:
      "Delete multiple garden objects by ID in a single call. Returns array of results.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ids: {
          type: "array",
          description: "Array of object IDs to delete",
          items: { type: "string" },
        },
      },
      required: ["ids"],
    },
  },
];
