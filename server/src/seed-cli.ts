import { db } from './db.js'
import { runSeed, wipeAll } from './seed/index.js'

const force = process.argv.includes('--force')
const count = (db.prepare('SELECT COUNT(*) AS n FROM flows').get() as { n: number }).n

if (count > 0 && !force) {
  console.log(`[seed] database already has ${count} flows — run 'npm run reseed' (with --force) to wipe and reseed`)
  process.exit(0)
}
if (force) {
  wipeAll()
  console.log('[seed] wiped existing data')
}
const summary = runSeed()
console.log(`[seed] done: ${summary.flows} flows, ${summary.files} files, ${summary.collections} collections`)
