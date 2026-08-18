import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildSeedFlows } from './seed/data.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'examples')
mkdirSync(outDir, { recursive: true })

const flows = buildSeedFlows()
const target = flows.find((f) => f.name === 'Create Exporter')
if (!target) throw new Error('Create Exporter seed flow not found')

const out = path.join(outDir, 'publish-create-exporter.json')
writeFileSync(out, JSON.stringify(target, null, 2) + '\n')
console.log(`[example] wrote ${out} (${(JSON.stringify(target).length / 1024).toFixed(0)} KB)`)
console.log('[example] publish it with:  curl -X POST -H "Content-Type: application/json" -d @examples/publish-create-exporter.json http://localhost:4000/api/flows')
