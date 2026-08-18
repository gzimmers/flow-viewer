import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db } from './db.js'
import { api } from './routes.js'
import { runSeed } from './seed/index.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = Number(process.env.PORT ?? 4000)

app.use(cors())
app.use(express.json({ limit: '100mb' }))

app.get('/api/health', (_req, res) => {
  const flowCount = (db.prepare('SELECT COUNT(*) AS n FROM flows').get() as { n: number }).n
  res.json({ ok: true, flows: flowCount })
})

app.use('/api', api)

// Serve the built frontend when present (production mode).
const distDir = path.join(here, '..', '..', 'web', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

// Seed demo data on first run.
{
  const n = (db.prepare('SELECT COUNT(*) AS n FROM flows').get() as { n: number }).n
  if (n === 0) {
    const summary = runSeed()
    console.log(`[seed] first run: created ${summary.flows} flows, ${summary.files} files, ${summary.collections} collections`)
  }
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api] unhandled error:', err)
  res.status(500).json({ error: 'internal error' })
})

app.listen(port, () => {
  console.log(`[server] flow-viewer API listening on http://localhost:${port}`)
})
