import crypto from 'node:crypto'
import { db } from '../db.js'
import { publishFlow, PublishError } from '../publish.js'
import { buildSeedFlows } from './data.js'

const TABLES = [
  'collection_items',
  'collections',
  'flow_tags',
  'tags',
  'edges',
  'nodes',
  'flow_versions',
  'flows',
  'files',
  'repositories',
]

export function wipeAll(): void {
  for (const t of TABLES) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
}

export function runSeed(): { flows: number; files: number; collections: number } {
  const flows = buildSeedFlows()
  let fileCount = 0
  const flowIds = new Map<string, string>()

  for (const payload of flows) {
    try {
      const { flowId } = publishFlow(payload)
      flowIds.set(payload.name as string, flowId)
      fileCount += (payload.files ?? []).length
    } catch (e) {
      throw new PublishError(`seed failed for flow '${payload.name}': ${e instanceof Error ? e.message : e}`)
    }
  }

  const collections: Array<{ name: string; description: string; flows: string[] }> = [
    {
      name: 'Exporters',
      description: 'Exporter lifecycle operations',
      flows: ['Create Exporter', 'Exporter Startup'],
    },
    {
      name: 'Schema Lifecycle',
      description: 'Schema event processing',
      flows: ['Schema Processing Loop'],
    },
    {
      name: 'Service Lifecycle',
      description: 'Service startup, shutdown, recovery',
      flows: ['Exporter Startup'],
    },
  ]

  const insCol = db.prepare('INSERT INTO collections (id, name, description, sort_order) VALUES (?, ?, ?, ?)')
  const insItem = db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, flow_id, sort_order) VALUES (?, ?, ?)')
  let colCount = 0
  collections.forEach((c, i) => {
    const id = cryptoRandomId()
    insCol.run(id, c.name, c.description, i)
    c.flows.forEach((name, j) => {
      const fid = flowIds.get(name)
      if (fid) insItem.run(id, fid, j)
    })
    colCount++
  })

  return { flows: flows.length, files: fileCount, collections: colCount }
}

function cryptoRandomId(): string {
  return crypto.randomUUID()
}
