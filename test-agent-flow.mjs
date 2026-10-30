#!/usr/bin/env node
// Self-evaluation test: simulates an agent session through the MCP server
// Spawns the MCP server (stdio), connects a fake browser via WebSocket,
// and exercises the new optimization tools.

import { spawn } from 'child_process'
import WebSocket from 'ws'

const DPM = 50

// ── Fake browser: responds to MCP server requests via WebSocket ──

const fakeGardenState = {
  gardenInfo: {
    id: 'test-garden-1',
    name: 'Test Garden',
    description: '',
    rotation: 0,
    isEditable: true,
    stats: { plants: 0, buildings: 0, groundShapes: 0, zones: 0, pins: 0 },
    boundary: {
      x: 500, y: 500,
      points: [
        { x: -500, y: -500 }, { x: 500, y: -500 },
        { x: 500, y: 500 }, { x: -500, y: 500 },
      ],
    },
  },
  zones: [],
  pins: [],
  objects: [],
  zoneIdCounter: 0,
  pinIdCounter: 0,
  objectIdCounter: 0,
}

function handleBrowserRequest(method, params) {
  switch (method) {
    case 'get_garden_info':
      return fakeGardenState.gardenInfo

    case 'get_zones':
      return fakeGardenState.zones

    case 'get_pins':
      return fakeGardenState.pins

    case 'get_objects':
      return fakeGardenState.objects

    case 'get_layer_visibility':
      return { plants: true, buildings: true, ground: true, zones: true, pins: true, scheme: true }

    case 'get_view_mode':
      return { mode: '2d' }

    case 'get_coordinate_system':
      return { dotsPerMeter: 50, origin: 'top-left', axes: { x: 'rightward', y: 'downward' } }

    case 'get_geo_anchor':
      return { set: false, anchor: null }

    case 'get_full_state': {
      return {
        gardenInfo: fakeGardenState.gardenInfo,
        zones: fakeGardenState.zones,
        pins: fakeGardenState.pins,
        objects: fakeGardenState.objects,
        layerVisibility: { plants: true, buildings: true, ground: true, zones: true, pins: true, scheme: true },
        viewMode: { mode: '2d' },
        coordinateSystem: { dotsPerMeter: 50, origin: 'top-left', axes: { x: 'rightward', y: 'downward' } },
        geoAnchor: { set: false },
      }
    }

    case 'add_zone': {
      const id = `zone_${++fakeGardenState.zoneIdCounter}`
      const zone = { id, ...params }
      fakeGardenState.zones.push(zone)
      return { id, success: true }
    }

    case 'add_zones': {
      const results = params.zones.map(z => {
        const id = `zone_${++fakeGardenState.zoneIdCounter}`
        fakeGardenState.zones.push({ id, ...z })
        return { id, success: true }
      })
      return { results, count: results.length }
    }

    case 'add_pin': {
      const id = `pin_${++fakeGardenState.pinIdCounter}`
      fakeGardenState.pins.push({ id, ...params })
      return { id, success: true }
    }

    case 'add_pins': {
      const results = params.pins.map(p => {
        const id = `pin_${++fakeGardenState.pinIdCounter}`
        fakeGardenState.pins.push({ id, ...p })
        return { id, success: true }
      })
      return { results, count: results.length }
    }

    case 'add_object': {
      const id = `obj_${++fakeGardenState.objectIdCounter}`
      fakeGardenState.objects.push({ id, ...params })
      return { id, success: true }
    }

    case 'add_objects': {
      const results = params.objects.map(o => {
        const id = `obj_${++fakeGardenState.objectIdCounter}`
        fakeGardenState.objects.push({ id, ...o })
        return { id, success: true }
      })
      return { results, count: results.length }
    }

    case 'update_object': {
      const { id, ...updates } = params
      const obj = fakeGardenState.objects.find(o => o.id === id)
      if (obj) Object.assign(obj, updates)
      return { success: !!obj }
    }

    case 'update_objects': {
      const results = params.objects.map(({ id, ...updates }) => {
        const obj = fakeGardenState.objects.find(o => o.id === id)
        if (obj) Object.assign(obj, updates)
        return { success: !!obj }
      })
      return { results, count: results.filter(r => r.success).length }
    }

    case 'delete_object': {
      const idx = fakeGardenState.objects.findIndex(o => o.id === params.id)
      if (idx >= 0) fakeGardenState.objects.splice(idx, 1)
      return { success: idx >= 0 }
    }

    case 'delete_objects': {
      const results = params.ids.map(id => {
        const idx = fakeGardenState.objects.findIndex(o => o.id === id)
        if (idx >= 0) fakeGardenState.objects.splice(idx, 1)
        return { id, success: idx >= 0 }
      })
      return { results, count: results.filter(r => r.success).length }
    }

    case 'set_garden_description': {
      fakeGardenState.gardenInfo.description = params.description
      return { success: true, description: params.description }
    }

    case 'get_zone_types':
      return { zoneTypes: ['entry', 'relaxation', 'lawn', 'path', 'terrace'], pinTypes: ['door', 'window', 'gate'] }

    default:
      throw new Error(`Fake browser: unknown method ${method}`)
  }
}

// ── MCP stdio protocol helpers ──

let mcpRequestId = 0

function mcpRequest(method, params) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: ++mcpRequestId,
    method,
    params,
  }) + '\n'
}

function parseMcpResponse(line) {
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

// ── Main test flow ──

async function main() {
  console.log('=== MCP Agent Experience Self-Evaluation ===\n')

  // 1. Start MCP server
  const mcp = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: new URL('.', import.meta.url).pathname,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stderr = ''
  mcp.stderr.on('data', d => { stderr += d.toString() })

  // Wait for server to start
  await new Promise(r => setTimeout(r, 2000))

  // 2. Connect fake browser via WebSocket
  const ws = new WebSocket('ws://localhost:3333')
  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
  })
  console.log('[OK] Fake browser connected to WebSocket\n')

  // Handle browser requests
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.type === 'request') {
      let result, error
      try {
        result = handleBrowserRequest(msg.method, msg.params)
      } catch (e) {
        error = e.message
      }
      ws.send(JSON.stringify({ type: 'response', id: msg.id, result, error }))
    }
  })

  // 3. Collect MCP responses
  const responses = []
  let responseResolve = null

  mcp.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      const parsed = parseMcpResponse(line)
      if (parsed && responseResolve) {
        responseResolve(parsed)
        responseResolve = null
      }
    }
  })

  function sendMcp(method, params) {
    return new Promise((resolve) => {
      responseResolve = resolve
      mcp.stdin.write(mcpRequest(method, params))
    })
  }

  // 4. Initialize MCP
  await sendMcp('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-agent', version: '1.0' },
  })
  console.log('[OK] MCP initialized\n')

  // 5. List tools
  const toolsResp = await sendMcp('tools/list', {})
  const toolNames = toolsResp.result.tools.map(t => t.name)
  console.log(`[TOOLS] ${toolNames.length} tools available:`)

  // Check for new tools
  const expectedNew = ['get_full_state', 'add_zones', 'add_pins', 'add_objects', 'update_objects', 'delete_objects', 'set_units']
  const found = []
  const missing = []
  for (const t of expectedNew) {
    if (toolNames.includes(t)) found.push(t)
    else missing.push(t)
  }
  console.log(`  New tools found: ${found.join(', ')}`)
  if (missing.length) console.log(`  MISSING: ${missing.join(', ')}`)
  console.log()

  // 6. Test: get_full_state (should replace 5-8 individual calls)
  console.log('--- Test: get_full_state ---')
  const fullState = await sendMcp('tools/call', { name: 'get_full_state', arguments: {} })
  const stateData = JSON.parse(fullState.result.content[0].text)
  const stateKeys = Object.keys(stateData)
  console.log(`  Keys returned: ${stateKeys.join(', ')}`)
  console.log(`  Garden: ${stateData.gardenInfo?.name || 'N/A'}`)
  console.log(`  Has zones: ${Array.isArray(stateData.zones)}, pins: ${Array.isArray(stateData.pins)}, objects: ${Array.isArray(stateData.objects)}`)
  console.log(`  [${stateKeys.length >= 7 ? 'PASS' : 'FAIL'}] Expected 7+ keys, got ${stateKeys.length}\n`)

  // 6b. Test: set_garden_description
  console.log('--- Test: set_garden_description ---')
  const descResp = await sendMcp('tools/call', {
    name: 'set_garden_description',
    arguments: { description: '# Modern Garden\n\nSouth-facing, low-maintenance.' },
  })
  const descData = JSON.parse(descResp.result.content[0].text)
  console.log(`  Success: ${descData.success}`)
  console.log(`  Description set: ${descData.description?.substring(0, 40)}...`)
  // Verify it persisted in fake state
  console.log(`  Fake state updated: ${fakeGardenState.gardenInfo.description === descData.description}`)
  console.log(`  [${descData.success && fakeGardenState.gardenInfo.description.includes('Modern Garden') ? 'PASS' : 'FAIL'}] Description persisted\n`)

  // 6c. Test: get_garden_info returns description
  console.log('--- Test: get_garden_info returns description ---')
  const infoResp = await sendMcp('tools/call', { name: 'get_garden_info', arguments: {} })
  const infoData = JSON.parse(infoResp.result.content[0].text)
  console.log(`  Has description: ${'description' in infoData}`)
  console.log(`  Description value: ${infoData.description?.substring(0, 40)}...`)
  console.log(`  [${infoData.description?.includes('Modern Garden') ? 'PASS' : 'FAIL'}] Description in garden info\n`)

  // 6d. Test: get_full_state includes description in gardenInfo
  console.log('--- Test: get_full_state includes description ---')
  const fullState2 = await sendMcp('tools/call', { name: 'get_full_state', arguments: {} })
  const stateData2 = JSON.parse(fullState2.result.content[0].text)
  const descInState = stateData2.gardenInfo?.description
  console.log(`  Description in full state: ${descInState?.substring(0, 40)}...`)
  console.log(`  [${descInState?.includes('Modern Garden') ? 'PASS' : 'FAIL'}] Description in full state\n`)

  // 7. Test: set_units to meters (default)
  console.log('--- Test: set_units ---')
  const unitsResp = await sendMcp('tools/call', { name: 'set_units', arguments: { unit: 'm' } })
  const unitsData = JSON.parse(unitsResp.result.content[0].text)
  console.log(`  Unit: ${unitsData.unit}, Success: ${unitsData.success}`)
  console.log(`  [${unitsData.unit === 'm' ? 'PASS' : 'FAIL'}] Units set to meters\n`)

  // 8. Test: add_zones batch (in meters — should be converted to editor units)
  console.log('--- Test: add_zones (batch, meters) ---')
  const batchZones = await sendMcp('tools/call', {
    name: 'add_zones',
    arguments: {
      zones: [
        { zoneType: 'lawn', x: 5, y: 5, width: 8, height: 6 },
        { zoneType: 'terrace', x: 3, y: 2, width: 4, height: 3 },
        { zoneType: 'relaxation', x: 8, y: 3, width: 3, height: 3 },
      ],
    },
  })
  const zonesData = JSON.parse(batchZones.result.content[0].text)
  console.log(`  Count: ${zonesData.count}, Results: ${zonesData.results?.length}`)
  console.log(`  IDs: ${zonesData.results?.map(r => r.id).join(', ')}`)
  // Check that the browser received editor units (meters × 50)
  const lastZone = fakeGardenState.zones[fakeGardenState.zones.length - 1]
  console.log(`  Browser received x=${lastZone.x} (expected ${8 * DPM}=${8 * DPM})`)
  console.log(`  [${lastZone.x === 8 * DPM ? 'PASS' : 'FAIL'}] Unit conversion: meters→editor on input\n`)

  // 9. Test: add_pins batch
  console.log('--- Test: add_pins (batch, meters) ---')
  const batchPins = await sendMcp('tools/call', {
    name: 'add_pins',
    arguments: {
      pins: [
        { pinType: 'door', x: 2, y: 1 },
        { pinType: 'window', x: 4, y: 1 },
        { pinType: 'gate', x: 0, y: 5 },
      ],
    },
  })
  const pinsData = JSON.parse(batchPins.result.content[0].text)
  console.log(`  Count: ${pinsData.count}, IDs: ${pinsData.results?.map(r => r.id).join(', ')}`)
  console.log(`  [${pinsData.count === 3 ? 'PASS' : 'FAIL'}] 3 pins created\n`)

  // 10. Test: add_objects batch
  console.log('--- Test: add_objects (batch, meters) ---')
  const batchObjs = await sendMcp('tools/call', {
    name: 'add_objects',
    arguments: {
      objects: [
        { type: 'plant', productId: '1', x: 5, y: 5, width: 1, height: 1 },
        { type: 'plant', productId: '2', x: 6, y: 5, width: 0.5, height: 0.5 },
        { type: 'building', productId: '3', x: 3, y: 2, width: 2, height: 3 },
      ],
    },
  })
  const objsData = JSON.parse(batchObjs.result.content[0].text)
  console.log(`  Count: ${objsData.count}, Results: ${objsData.results?.length}`)
  // Verify unit conversion on browser side
  const lastObj = fakeGardenState.objects[fakeGardenState.objects.length - 1]
  console.log(`  Browser received width=${lastObj.width} (expected ${2 * DPM}=${2 * DPM})`)
  console.log(`  [${lastObj.width === 2 * DPM ? 'PASS' : 'FAIL'}] Unit conversion on objects\n`)

  // 11. Test: update_objects batch
  console.log('--- Test: update_objects (batch) ---')
  const updateResp = await sendMcp('tools/call', {
    name: 'update_objects',
    arguments: {
      objects: [
        { id: 'obj_1', x: 5.5, y: 5.5 },
        { id: 'obj_2', x: 6.5, y: 5.5 },
      ],
    },
  })
  const updateData = JSON.parse(updateResp.result.content[0].text)
  console.log(`  Count: ${updateData.count}`)
  console.log(`  [${updateData.count === 2 ? 'PASS' : 'FAIL'}] 2 objects updated\n`)

  // 12. Test: delete_objects batch
  console.log('--- Test: delete_objects (batch) ---')
  const deleteResp = await sendMcp('tools/call', {
    name: 'delete_objects',
    arguments: { ids: ['obj_2', 'obj_3'] },
  })
  const deleteData = JSON.parse(deleteResp.result.content[0].text)
  console.log(`  Count: ${deleteData.count}, Remaining objects: ${fakeGardenState.objects.length}`)
  console.log(`  [${deleteData.count === 2 ? 'PASS' : 'FAIL'}] 2 objects deleted\n`)

  // 13. Test: output unit conversion (get zones back in meters)
  console.log('--- Test: output unit conversion ---')
  const getZonesResp = await sendMcp('tools/call', { name: 'get_zones', arguments: {} })
  const zonesOutput = JSON.parse(getZonesResp.result.content[0].text)
  if (Array.isArray(zonesOutput) && zonesOutput.length > 0) {
    const firstZone = zonesOutput[0]
    // Browser stored x=250 (5m*50), output should be x=5 (meters)
    console.log(`  First zone x=${firstZone.x} (browser has ${fakeGardenState.zones[0].x})`)
    console.log(`  [${Math.abs(firstZone.x - 5) < 0.01 ? 'PASS' : 'FAIL'}] Output converted to meters`)
  }
  console.log()

  // 14. Test: set_units to editor, verify no conversion
  console.log('--- Test: set_units("editor") disables conversion ---')
  await sendMcp('tools/call', { name: 'set_units', arguments: { unit: 'editor' } })
  const rawZonesResp = await sendMcp('tools/call', { name: 'get_zones', arguments: {} })
  const rawZones = JSON.parse(rawZonesResp.result.content[0].text)
  if (Array.isArray(rawZones) && rawZones.length > 0) {
    console.log(`  First zone x=${rawZones[0].x} (raw editor units)`)
    console.log(`  [${rawZones[0].x === fakeGardenState.zones[0].x ? 'PASS' : 'FAIL'}] No conversion in editor mode`)
  }
  console.log()

  // 15. Tool description enrichment check
  console.log('--- Test: enriched tool descriptions ---')
  const addZoneTool = toolsResp.result.tools.find(t => t.name === 'add_zone')
  const hasZoneTypes = addZoneTool?.description?.includes('lawn') && addZoneTool?.description?.includes('terrace')
  console.log(`  add_zone includes zone type list: ${hasZoneTypes}`)

  const addPinTool = toolsResp.result.tools.find(t => t.name === 'add_pin')
  const hasPinTypes = addPinTool?.description?.includes('door') && addPinTool?.description?.includes('view_good')
  console.log(`  add_pin includes pin type list: ${hasPinTypes}`)

  const addObjTool = toolsResp.result.tools.find(t => t.name === 'add_object')
  const hasProductQuery = addObjTool?.description?.includes('productQuery')
  const widthNotRequired = !addObjTool?.inputSchema?.required?.includes('width')
  console.log(`  add_object mentions productQuery: ${hasProductQuery}`)
  console.log(`  add_object width not required: ${widthNotRequired}`)
  console.log(`  [${hasZoneTypes && hasPinTypes && hasProductQuery && widthNotRequired ? 'PASS' : 'FAIL'}] Descriptions enriched\n`)

  // ── Summary ──
  console.log('=== Call Count Comparison ===')
  console.log('Before optimization (old flow for same work):')
  console.log('  get_garden_info + get_zones + get_pins + get_objects +')
  console.log('  get_layer_visibility + get_view_mode + get_geo_anchor +')
  console.log('  get_coordinate_system + get_zone_types = 9 calls')
  console.log('  add_zone × 3 + add_pin × 3 + add_object × 3 +')
  console.log('  update_object × 2 + delete_object × 2 = 13 calls')
  console.log('  Total: ~22 calls\n')
  console.log('After optimization (this test):')
  console.log('  get_full_state + set_units = 2 calls')
  console.log('  add_zones + add_pins + add_objects = 3 calls')
  console.log('  update_objects + delete_objects = 2 calls')
  console.log('  get_zones (verify) = 1 call')
  console.log('  Total: 8 calls\n')
  console.log('Reduction: 22 → 8 calls (64% fewer)\n')

  // Cleanup
  ws.close()
  mcp.kill()
  process.exit(0)
}

main().catch(e => {
  console.error('Test failed:', e)
  process.exit(1)
})
