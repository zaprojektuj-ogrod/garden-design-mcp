# Garden Design MCP Server

**Let your AI assistant design a garden on your real plot.** This MCP (Model Context Protocol) server connects Claude Code, Claude Desktop, Cursor or any other MCP client to the [Zaprojektuj-Ogrod.pl](https://www.zaprojektuj-ogrod.pl/) Garden Editor, a browser app for garden and landscape design in 2D and 3D. You watch every change appear in the editor as the assistant makes it, then walk through the finished garden in 3D.

Step-by-step setup guide: [in English](https://www.zaprojektuj-ogrod.pl/en/help/mcp-setup/) · [po polsku](https://www.zaprojektuj-ogrod.pl/mcp-setup/)

## What the assistant can do

- **Find the plot** anywhere in the world, on OpenStreetMap or a satellite photo. In Poland it imports the exact parcel boundary and the buildings from the land registry (Geoportal, ULDK).
- **Read your photos and floor plan** to put the doors, windows and views on the right walls of the house.
- **Draw what is already there**: fences, paving, the driveway, a heat pump on the wall. Nothing that exists is moved without asking.
- **Lay out zones for your wishes** at practical sizes (a terrace for six, a path, raised beds, a bench corner), and say so when a wish does not fit instead of shrinking it quietly.
- **Choose plants** from a catalog of 2,000+ by sun, soil, hardiness and size, and place them at their mature spread. Surfaces, furniture, raised beds and planters come from the same catalog.
- **Check its own work**: planting density per bed, previews of the plan, 2D and 3D views. It saves the design to your account.

It works one step at a time and stops for your sign-off: the site first, then the zones, then the planting.

## Quick start

**1. Add the server to your AI client.** No install is needed: `npx` downloads and runs it.

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "garden-editor": {
      "command": "npx",
      "args": ["@zaprojektujogrod/mcp-server"]
    }
  }
}
```

**Claude Desktop** (Settings → Developer → MCP Servers):
```json
{
  "garden-editor": {
    "command": "npx",
    "args": ["@zaprojektujogrod/mcp-server"]
  }
}
```

**2. Open a garden in the Garden Editor** at [zaprojektuj-ogrod.pl](https://www.zaprojektuj-ogrod.pl/) and switch the MCP connection on in Settings › AI assistant. The editor connects to the server on your computer.

**3. Ask your assistant**, for example: *"Help me design my garden, step by step."* Or start from the server's `start_design` prompt.

## How it works

```
┌─────────────────┐     stdio      ┌──────────────────┐    WebSocket     ┌──────────────────┐
│  AI client      │ ◄────────────► │   MCP server     │ ◄──────────────► │  Garden Editor   │
│  (Claude, etc.) │                │  (this package)  │  localhost:3333  │  (your browser)  │
└─────────────────┘                └──────────────────┘                  └──────────────────┘
```

The server runs on your computer and talks to the editor open in your browser over a local WebSocket (`ws://localhost:3333`). Your garden stays in your account; the assistant runs in your own AI client, on your own subscription or API key.

## Setup from source

If you prefer to run from source instead of npx:

```bash
git clone https://github.com/zaprojektuj-ogrod/garden-design-mcp.git
cd garden-design-mcp
npm install
npm run build
```

Then configure your AI client with a direct path:
```json
{
  "mcpServers": {
    "garden-editor": {
      "command": "node",
      "args": ["/path/to/garden-design-mcp/dist/index.js"]
    }
  }
}
```

## Available tools (63)

Tools follow the design funnel: **Site → Context → Zones → Detailing → Review**. Most tools that create or change things have a batch sibling (`add_objects`, `update_objects`, `delete_objects`, `add_pins`, `add_zones`); prefer the batch form when placing many items. Call `get_design_guide` once at the start: it holds the whole workflow, the photo method and the planting rules.

### Phase 1: Site
| Tool | Description |
|------|-------------|
| `geocode_address` | Find a place anywhere in the world from an address |
| `set_geo_anchor` | Place the garden on the map at real-world coordinates |
| `get_geo_anchor` | Get the garden's place |
| `set_map_background` | Show or hide a map under the garden: OpenStreetMap, the satellite photo (Poland) or a laid survey map |
| `set_boundary` | Give the plot boundary as a polygon in metres (from measurements or traced from the map) |
| `get_parcel_by_coordinates` | Land registry parcel by WGS84 lat/lon (Poland) |
| `get_parcel_by_id` | Land registry parcel by parcel ID (Poland) |
| `get_parcel_by_address` | Address → land registry parcel (Poland) |
| `import_parcel` | Import a parcel as the garden boundary, with the cadastral map behind it (Poland) |
| `import_buildings` | Import the buildings on and around the parcel from the land registry (Poland) |
| `get_site_analysis` | House facades by compass side, party walls and the garden depth on each side |
| `upload_reference_photo` | Upload a reference photo (kept for the session) |
| `get_reference_photos` | Get the uploaded reference photos |
| `zoom_image` | A close-up of an image attached in the editor's chat, for reading details |
| `set_survey_map` | Lay a survey map or site plan to scale under the garden, from two matched points or two points and a distance |
| `map_to_garden` | Turn points on the laid survey map into garden coordinates in metres |

### Phase 2: Context
| Tool | Description |
|------|-------------|
| `add_pin` / `add_pins` | Add one or many context pins (door, window, gate, view) |
| `delete_pin` | Delete a pin by ID |
| `get_pins` | Get all pins |
| `get_garden_info` | Get garden metadata (name, rotation, boundary, stats) |
| `set_garden_rotation` | Set north orientation in degrees |
| `set_garden_description` | Set the garden's free-text description (the assistant's memory between sessions) |
| `capture_preview` | Capture a top-down view as an image the assistant sees inline |

### Phase 3: Zones
| Tool | Description |
|------|-------------|
| `add_zone` / `add_zones` | Add one or many zones (polygon or path in metres); each answers with area, narrowest width and overlaps |
| `update_zone` | Update zone properties |
| `delete_zone` | Delete a zone by ID |
| `get_zones` | Get all zones |
| `get_zone_types` | Get available zone/pin types with colors and labels |
| `get_objects_in_zone` | List objects whose centers fall inside a zone |
| `get_zone_analysis` | Density and coverage of a zone (planted area %, objects by category) |
| `clear_all` | Clear scene contents: `scope` of `'all'` (default), `'zones_pins'` or `'objects'` |
| `export_state` | Export zones and pins as JSON |
| `import_state` | Import zones and pins from JSON |

### Phase 4: Detailing
| Tool | Description |
|------|-------------|
| `search_products` | Search the product catalog by layer and name and/or `categoryId` |
| `search_plants` | Filter plants by sun, soil, hardiness, flower color, height, spread, bloom time, plus an optional name query |
| `get_plant_attributes` | The valid filter values for `search_plants` |
| `get_plant_info` | A plant's full description: characteristics, requirements, maintenance |
| `get_categories` | Top-level categories for a layer |
| `get_subcategories` | Leaf categories under a parent category |
| `get_product_details` | Full product details by ID |
| `get_objects` | Get all garden objects (filter by layer; `count_only: true` for counts only) |
| `add_object` / `add_objects` | Add one or many plants, architecture or ground surfaces (`productId` or `productQuery`) |
| `update_object` / `update_objects` | Update one or many objects (position, size, rotation, product) |
| `delete_object` / `delete_objects` | Delete one or many objects by ID |

### Phase 5: Review
| Tool | Description |
|------|-------------|
| `get_full_state` | Snapshot of the scene; `summary_only: true` for large scenes |
| `set_view_mode` | Switch between 2D and 3D view |
| `get_view_mode` | Get current view mode |
| `set_layer_visible` | Show/hide a layer |
| `get_layer_visibility` | Get visibility state of all layers |
| `focus_on` | Focus the camera on an area |
| `save` | Save all changes to the account |
| `undo` | Undo last action |
| `redo` | Redo last undone action |
| `get_coordinate_system` | Coordinate system docs (units, axes, scale) |

### Utility
| Tool | Description |
|------|-------------|
| `get_design_guide` | The full design guide: workflow, photo method, zone sizes, journal, plant selection |
| `connection_status` | Check if the browser is connected |
| `set_units` | Set coordinate units to `'m'` (default) or `'editor'` (raw 50 units = 1 m) |
| `get_version` | `{mcpServer, editor: {version, buildTime, gitHash} \| null}` for capability checks at session start |

### `capture_preview`: what the assistant sees

`capture_preview` returns an MCP `ImageContent` block (`{type: "image", data, mimeType: "image/jpeg"}`). The connected assistant sees it directly and can describe and check the plan without any file on disk.

**It does not write a file to disk.** MCP clients (Claude Desktop, Claude Code, Cursor, …) show the image inline, and the server does not keep screenshots. To keep the JPEG, right-click → "Save image as…" on the image in your client, or read the base64 in `content[0].data` from your own client harness.

## MCP resources

| URI | Description |
|-----|-------------|
| `garden://info` | Garden metadata |
| `garden://zones` | All zones as JSON |
| `garden://pins` | All context pins |
| `garden://objects` | All garden objects |
| `garden://coordinate-system` | Coordinate system documentation |

## MCP prompts

| Prompt | Description |
|--------|-------------|
| `start_design` | Begin a new garden design, as the editor's guided set-up does: the site first, then zones and planting, each signed off |
| `continue_design` | Resume an existing garden (assess state, suggest next steps) |
| `optimize_zones` | Review and optimize the zone layout within the boundary |

## Development

Run in development mode (with hot reload):

```bash
npm run dev
```

The server logs to stderr so it does not interfere with MCP stdio communication.

## Po polsku

Serwer MCP do projektowania ogrodów z asystentem AI. Łączy Claude, Cursor lub inny klient MCP z edytorem [Zaprojektuj-Ogrod.pl](https://www.zaprojektuj-ogrod.pl/). Asystent znajduje działkę (w Polsce z granicami i budynkami z Geoportalu), rysuje to, co już na niej jest, układa strefy według Twoich życzeń i dobiera rośliny z katalogu, a Ty widzisz projekt ogrodu w 2D i 3D. Instrukcja: [Konfiguracja serwera MCP](https://www.zaprojektuj-ogrod.pl/mcp-setup/).

## License

MIT, see [LICENSE](LICENSE). Questions and bug reports: [zaprojektuj-ogrod.pl/kontakt](https://www.zaprojektuj-ogrod.pl/kontakt/).
