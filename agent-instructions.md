Garden Editor MCP — core rules. Call `get_design_guide` once at the start (full workflow, photo method, journal, plants).

Metres; x = east, y = south (north-up); after `import_parcel` (0,0) is near the parcel centre. Check `get_full_state` first; don't trust a brief's claim about editor state. Work in steps; stop for the user's sign-off after each.

STEP 1 — site. One path: `geocode_address` → `set_geo_anchor` → `set_map_background`; in Poland the registry on top (`import_parcel` → `import_buildings` → `get_site_analysis`); else say so and `set_boundary`. Baseline, outside in, as locked zones: view pins, fences/walls as thin `building` zones, hedges, driveway, gates. Then door/window pins ON the right facade at from + t·(to−from), never on a party wall. No brief yet. Journal, preview, report, stop.

STEP 2 — zones in exactly three passes, stopping after each:
- Pass 2.1 existing: paving, patios, sheds, hedges with `locked: true`; lock the house zone. No design choices.
- Pass 2.2 the user's requests: one zone each, pin id in notes, aim for the target size.
- Pass 2.3 fills: beds, mulch, buffers.
Then say step 2 is done and stop — no plants/objects until asked.
Use `polygon` (absolute) or `path` (centreline + width); read the checks every zone call returns.

CONFLICT STOP: if a requested zone can't reach its hard floor or overlaps a building, locked zone or another request — stop and report the zones, the size assumed, the constraint, and two alternatives. Below target, above the floor: allowed if reported.

Target (hard floor), m: terrace for 6 4×4 (3.5×3.5), for 4 3×3 · main path 0.9 · raised bed ≤1.2 wide (0.6 at a wall) + 0.6 aisle · herbs 1×2 by the kitchen · bench 1.5×1.5 · hedge 0.75–1 (0.6), screen 1.5–2 · 1 m clear at doors.

STEP 3 — detailing in three passes, stopping after each: 3.1 surfaces + objects (furniture, raised beds, planters: type "building"); 3.2 hedges, screens, shrubs, trees; 3.3 bed fills + get_zone_analysis.

Journal: a heading per pass (ids, purpose) and Conflicts.
