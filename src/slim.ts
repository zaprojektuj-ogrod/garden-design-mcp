// Token diet for tool replies — the MCP route and the built-in agent read the same ones.
// Every reply is compact JSON with numbers rounded, nulls and empty warning lists dropped;
// the bulkiest replies also lose the fields the model never uses. Browser-safe (no Node imports).

type Obj = Record<string, unknown>

/** Geographic or scale values keep full precision: rounding them would move the plot */
const FULL_PRECISION = /lat|lon|lng|coord|bbox|wgs|epsg|scale|perpixel|dotspermeter/i

function round(value: number): number {
  if (Number.isInteger(value) || !Number.isFinite(value)) return value
  // Millimetres for sizes and positions; three significant digits below 1 (direction vectors)
  return Math.abs(value) >= 1 ? Math.round(value * 1000) / 1000 : Number(value.toPrecision(3))
}

/** Rounds numbers and drops nulls and empty `warnings`, recursively */
export function compact(value: unknown, key = ''): unknown {
  if (typeof value === 'number') return FULL_PRECISION.test(key) ? value : round(value)
  if (Array.isArray(value)) return value.map(v => compact(v, key))
  if (value && typeof value === 'object') {
    const out: Obj = {}
    for (const [k, v] of Object.entries(value as Obj)) {
      if (v === null || v === undefined) continue
      if (k === 'warnings' && Array.isArray(v) && v.length === 0) continue
      out[k] = FULL_PRECISION.test(k) ? v : compact(v, k)
    }
    return out
  }
  return value
}

/** A catalog product as the model needs it: what to place and how big it is */
export function slimProduct(p: unknown): Obj {
  const o = (p ?? {}) as Obj
  const out: Obj = { id: o.id, name: o.name, width: o.width, height: o.height }
  if (typeof o.elevation === 'number' && o.elevation !== 0) out.elevation = o.elevation
  return out
}

/** A batch's `results` → ids in input order (null where one failed) plus only the entries worth reading */
function slimBatch(r: Obj): Obj {
  const results = r.results
  if (!Array.isArray(results)) return r
  const { results: _results, count: _count, ...rest } = r
  const ids = (results as Obj[]).map(x => (x.success === false ? null : x.id ?? null))
  const issues = (results as Obj[])
    .map((x, index): Obj => ({ index, ...x }))
    .filter(x => x.success === false || (Array.isArray(x.warnings) && x.warnings.length > 0))
    .map(({ success: _success, ...x }) => x)
  return { ...rest, ids, ...(issues.length ? { issues } : {}) }
}

/** Plants of one kind in a zone, grouped: one line per product instead of one per plant */
function groupObjects(objects: Obj[]): Obj[] {
  const groups = new Map<string, Obj & { ids: unknown[] }>()
  for (const o of objects) {
    const k = `${o.type}|${o.productName ?? o.label ?? ''}|${o.spread ?? ''}`
    let g = groups.get(k)
    if (!g) {
      const { id: _id, ...about } = o
      g = { ...about, ids: [] }
      groups.set(k, g)
    }
    g.ids.push(o.id)
  }
  return [...groups.values()]
}

/** An object or zone without the fields that are zero by default */
function dropDefaults(o: Obj, keys: string[]): Obj {
  const out = { ...o }
  for (const k of keys) if (out[k] === 0) delete out[k]
  if (out.type === 'zone') delete out.type
  return out
}

/** The plant definition fields that decide a placement; `full` keeps care and installation */
function slimPlantInfo(r: Obj): Obj {
  const d = (r.definition ?? {}) as Obj
  const maintenance = (d.maintenance ?? {}) as Obj
  const installation = (d.installation ?? {}) as Obj
  return {
    product: slimProduct(r.product),
    definition: {
      botanicalName: d.botanicalName,
      commonName: d.commonName,
      characteristics: d.characteristics,
      requirements: d.requirements,
      maintenanceLevel: maintenance.maintenanceLevel,
      spacing: installation.spacing,
    },
  }
}

/** Per-tool trims, before `compact` */
export function slimResult(name: string, result: unknown, args: Obj = {}): unknown {
  if (!result || typeof result !== 'object') return result
  const r = result as Obj
  switch (name) {
    case 'search_products': {
      const products = Array.isArray(r.products) ? r.products.map(slimProduct) : r.products
      const more = typeof r.total === 'number' && Array.isArray(products) && r.total > products.length
      return { products, ...(more ? { total: r.total, page: r.page } : {}) }
    }
    case 'get_product_details':
      return slimProduct(r)
    case 'get_plant_info':
      return args.full ? r : slimPlantInfo(r)
    case 'search_plants':
      return Array.isArray(r.matches)
        ? { ...r, matches: (r.matches as Obj[]).map(({ code: _code, ...m }) => m), ...(r.truncated ? {} : { truncated: undefined }) }
        : r
    case 'add_objects':
    case 'add_zones':
    case 'add_pins':
    case 'delete_objects':
    case 'update_objects':
      return slimBatch(r)
    case 'get_zone_analysis':
      return Array.isArray(r.objects) ? { ...r, objects: groupObjects(r.objects as Obj[]) } : r
    case 'get_objects':
    case 'get_objects_in_zone': {
      const list = Array.isArray(r) ? r : Array.isArray(r.objects) ? r.objects : null
      if (!list) return r
      const slim = (list as Obj[]).map(o => dropDefaults(o, ['z', 'zIndex', 'elevation', 'rotation']))
      return Array.isArray(r) ? slim : { ...r, objects: slim }
    }
    case 'get_zones':
      return Array.isArray(r) ? (r as Obj[]).map(z => dropDefaults(z, ['rotation'])) : r
    default:
      return r
  }
}

/** The text a tool reply carries: per-tool trims, then compact JSON */
export function replyText(name: string, result: unknown, args: Obj = {}): string {
  return JSON.stringify(compact(slimResult(name, result, args)))
}

// ── Journal sections ──

const HEADING = /^(#{1,6})\s+(.*)$/

function headingKey(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/:\s*$/, '').trim().toLowerCase()
}

/** Whether a heading's text names the section: exactly, or followed by a space, colon or bracket */
function names(heading: string, section: string): boolean {
  const h = headingKey(heading)
  return h === section || (h.startsWith(section) && /^[\s:(—–-]/.test(h.slice(section.length)))
}

/**
 * The journal with one section replaced: from its heading to the next heading of the same or a
 * higher level. A section not found is added at the end as a `##` heading. The new text may
 * start with the section's own heading; otherwise the old heading is kept.
 */
export function replaceSection(journal: string, section: string, text: string): string {
  const title = section.replace(/^#+\s*/, '').trim()
  const key = headingKey(title)
  const lines = journal.split('\n')
  const body = text.trim().split('\n')
  const own = HEADING.exec(body[0] ?? '')
  const ownHeading = own !== null && names(own[2], key)

  let start = -1
  let level = 2
  for (let i = 0; i < lines.length; i++) {
    const h = HEADING.exec(lines[i])
    if (h && names(h[2], key)) { start = i; level = h[1].length; break }
  }
  if (start < 0) {
    const block = ownHeading ? body : [`## ${title}`, ...body]
    const head = journal.trimEnd()
    return `${head ? `${head}\n\n` : ''}${block.join('\n')}\n`
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const h = HEADING.exec(lines[i])
    if (h && h[1].length <= level) { end = i; break }
  }
  const block = ownHeading ? body : [lines[start], ...body]
  const after = lines.slice(end)
  return [...lines.slice(0, start), ...block, ...(after.length ? ['', ...after] : [])].join('\n')
}
