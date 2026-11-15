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

**Effort.** Medium effort is enough. In our tests Claude Opus 5.5 designed as well at medium effort as at high, for about a quarter less. Effort is your client's setting, so the server can't set it. In Claude Code, start with `claude --effort medium`.

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

## Available tools (56)

Tools follow the design funnel: **Site → Context → Zones → Detailing → Review**. Tools that create or change things take a list (`add_objects`, `update_objects`, `delete_objects`, `add_pins`, `add_zones`), one item or many. Call `get_design_guide` once at the start: it holds the whole workflow, the photo method and the planting rules.

Replies are compact JSON, with numbers rounded and fields the assistant never uses left out, because every reply is re-read on each later turn. A batch answers with `ids` in input order (null where one failed) and `issues` for failures and warnings.

Another 17 tools still answer when called but aren't listed, since every listed tool's definition rides along with each request:
- the one-item twins of the batch tools: `add_object`, `add_zone`, `add_pin`, `update_object`, `delete_object`;
- `undo`, `redo`, `clear_all`, `export_state`, `import_state`;
- `set_units`, `get_view_mode`, `get_layer_visibility`, `get_coordinate_system`, `get_zone_types`;
- `connection_status`, `get_version`.

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
| `add_pins` | Add context pins (door, window, gate, view), one or many |
| `delete_pin` | Delete a pin by ID |
| `get_pins` | Get all pins |
| `get_garden_info` | Get garden metadata (name, rotation, boundary, stats) |
| `set_garden_rotation` | Set north orientation in degrees |
| `get_journal` | Read the assistant's design journal: its working memory of the garden between sessions, kept with the garden and never shown to the owner |
| `write_journal` | Write the journal whole, or with `section` one heading's section without resending the rest |
| `set_garden_description` | Write the garden's description when the owner asks for it or agrees: the design as it stands now, in Markdown, shown with the garden on the website |
| `capture_preview` | Capture a top-down view as an image the assistant sees inline: 800 px by default; `hideZones: true` hides zones and pins for that picture |

### Phase 3: Zones
| Tool | Description |
|------|-------------|
| `add_zones` | Add zones (polygon or path in metres), one or many; each answers with area, narrowest width and overlaps |
| `update_zone` | Update zone properties |
| `delete_zone` | Delete a zone by ID |
| `get_zones` | Get all zones |
| `get_objects_in_zone` | List objects whose centers fall inside a zone |
| `get_zone_analysis` | Density and coverage of a zone (planted area %, objects by category) |

### Phase 4: Detailing
| Tool | Description |
|------|-------------|
| `search_products` | Search the product catalog by layer and name and/or `categoryId` |
| `search_plants` | Filter plants by kind (tree, shrub, perennial, grass…), sun, soil, hardiness, flower color, height, spread, bloom time, plus an optional name query; each match gives its mature height and spread |
| `get_plant_attributes` | The valid filter values for `search_plants` |
| `get_plant_info` | A plant's characteristics, requirements, maintenance level and spacing; `full: true` adds seasonal care, pests and installation |
| `get_categories` | Top-level categories for a layer |
| `get_subcategories` | Leaf categories under a parent category |
| `get_product_details` | Full product details by ID |
| `get_objects` | Get all garden objects (filter by layer; `count_only: true` for counts only) |
| `add_objects` | Add plants, architecture or ground surfaces, one or many (`productId` or `productQuery`) |
| `plant_zones` | Plant zones with the plants the assistant chose: the editor places them in groups of 3–7 in beds or in one row in a hedge, clear of paths, terraces, lawn and the plants already there, and reports each zone's canopy cover |
| `update_objects` | Update objects (position, size, rotation, product), one or many |
| `delete_objects` | Delete objects by ID, one or many |

### Phase 5: Review
| Tool | Description |
|------|-------------|
| `get_full_state` | Snapshot of the scene; `summary_only: true` for large scenes |
| `set_view_mode` | Switch between 2D and 3D view |
| `set_layer_visible` | Show/hide a layer |
| `focus_on` | Focus the camera on an area |
| `save` | Save all changes to the account |

### The designer's own house
Built from the designer's photos, step by step, out of simple blocks, on the house's land-registry outline (after `import_buildings`). Kept with the garden as its description and rebuilt wherever the garden opens; no model file is stored.

| Tool | Description |
|------|-------------|
| `house_build` | The main block on the house's outline, at true size and turn, its front on the compass side given; `open: true` for a structure on posts of its own (a carport, a pergola) |
| `house_set_roof` | A block's roof: gable, hip, mono-pitch, flat, or none (a post); ridge direction, heights, covering, colour; chimneys, solar panels |
| `house_set_walls` | Walls' finish and colour, a lower band, the plinth |
| `house_set_openings` | One facade's windows, doors and facade panels |
| `house_set_block` | Add, change or remove a further block: a wing, a garage; posts and open roofs for a porch, a carport, a pergola |
| `house_preview` | Pictures of the house from the sides asked for, to compare with the photos |
| `house_get` | The house as built: position, facades by compass side, blocks, openings |

### Utility
| Tool | Description |
|------|-------------|
| `get_design_guide` | The full design guide: workflow, photo method, zone sizes, journal and description, plant selection |

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
