import { Router, type Response } from 'express'
import { db, uid, now } from './db.js'
import { publishFlow, PublishError } from './publish.js'
import {
  listFlows,
  getFlowDetail,
  getFlowMeta,
  listFlowVersions,
  listCollections,
  listTags,
  listRepositories,
} from './queries.js'
import type { PublishPayload } from './types.js'

export const api = Router()

function httpError(res: Response, status: number, message: string) {
  res.status(status).json({ error: message })
}

// ---------- flows ----------

api.get('/flows', (req, res) => {
  const q = (req.query.q as string | undefined)?.trim()
  const flows = listFlows({
    q: q && q.length > 0 ? q : undefined,
    type: req.query.type as string | undefined,
    repo: req.query.repo as string | undefined,
    branch: req.query.branch as string | undefined,
    tag: req.query.tag as string | undefined,
    favorite: req.query.favorite === '1' || req.query.favorite === 'true',
    archived: req.query.archived === '1' || req.query.archived === 'true',
  })
  res.json(flows)
})

api.post('/flows', (req, res) => {
  try {
    const payload = req.body as PublishPayload
    const { flowId, version } = publishFlow(payload)
    res.status(201).json({ id: flowId, version })
  } catch (e) {
    if (e instanceof PublishError) return httpError(res, 400, e.message)
    throw e
  }
})

api.get('/flows/:id', (req, res) => {
  const version = req.query.version ? Number(req.query.version) : undefined
  const detail = getFlowDetail(req.params.id, version)
  if (!detail) return httpError(res, 404, 'flow not found')
  res.json(detail)
})

api.get('/flows/:id/versions', (req, res) => {
  const meta = getFlowMeta(req.params.id)
  if (!meta) return httpError(res, 404, 'flow not found')
  res.json(listFlowVersions(req.params.id))
})

api.get('/flows/:id/versions/:version', (req, res) => {
  const detail = getFlowDetail(req.params.id, Number(req.params.version))
  if (!detail) return httpError(res, 404, 'flow version not found')
  res.json(detail)
})

api.post('/flows/:id/versions', (req, res) => {
  try {
    const payload = req.body as PublishPayload
    if (!getFlowMeta(req.params.id)) return httpError(res, 404, 'flow not found')
    const { version } = publishFlow(payload, req.params.id)
    res.status(201).json({ id: req.params.id, version })
  } catch (e) {
    if (e instanceof PublishError) return httpError(res, 400, e.message)
    throw e
  }
})

api.patch('/flows/:id', (req, res) => {
  const meta = getFlowMeta(req.params.id)
  if (!meta) return httpError(res, 404, 'flow not found')
  const b = (req.body ?? {}) as Record<string, unknown>
  const sets: string[] = ['updated_at = ?']
  const params: Array<string | number | null> = [now()]
  if (typeof b.name === 'string' && b.name.length > 0) {
    sets.push('name = ?')
    params.push(b.name)
  }
  if (typeof b.description === 'string') {
    sets.push('description = ?')
    params.push(b.description)
  }
  if (typeof b.type === 'string' && b.type.length > 0) {
    sets.push('type = ?')
    params.push(b.type)
  }
  if (typeof b.branch === 'string') {
    sets.push('branch = ?')
    params.push(b.branch)
  }
  if (typeof b.isFavorite === 'boolean') {
    sets.push('is_favorite = ?')
    params.push(b.isFavorite ? 1 : 0)
  }
  if (typeof b.isArchived === 'boolean') {
    sets.push('is_archived = ?')
    params.push(b.isArchived ? 1 : 0)
  }
  params.push(req.params.id)
  db.prepare(`UPDATE flows SET ${sets.join(', ')} WHERE id = ?`).run(...params)

  if (Array.isArray(b.tags)) {
    db.prepare('DELETE FROM flow_tags WHERE flow_id = ?').run(req.params.id)
    const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
    const insFlowTag = db.prepare('INSERT OR IGNORE INTO flow_tags (flow_id, tag_id) VALUES (?, ?)')
    for (const raw of b.tags) {
      const name = String(raw).trim().toLowerCase()
      if (!name) continue
      insTag.run(name)
      const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
      insFlowTag.run(req.params.id, tag.id)
    }
  }
  res.json(getFlowMeta(req.params.id))
})

api.delete('/flows/:id', (req, res) => {
  const meta = getFlowMeta(req.params.id)
  if (!meta) return httpError(res, 404, 'flow not found')
  db.prepare('DELETE FROM flows WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ---------- files ----------

api.get('/files/:id', (req, res) => {
  const f = db
    .prepare('SELECT id, path, language, line_count, content FROM files WHERE id = ?')
    .get(req.params.id) as
    | { id: string; path: string; language: string; line_count: number; content: string }
    | undefined
  if (!f) return httpError(res, 404, 'file not found')
  res.json({ id: f.id, path: f.path, language: f.language, lineCount: f.line_count, content: f.content })
})

api.get('/files', (req, res) => {
  const repository = req.query.repository as string | undefined
  const p = req.query.path as string | undefined
  if (!repository || !p) return httpError(res, 400, 'repository and path query params are required')
  const r = db.prepare('SELECT id FROM repositories WHERE name = ?').get(repository) as { id: string } | undefined
  if (!r) return httpError(res, 404, 'repository not found')
  const f = db
    .prepare('SELECT id, path, language, line_count, content FROM files WHERE repository_id = ? AND path = ?')
    .get(r.id, p) as
    | { id: string; path: string; language: string; line_count: number; content: string }
    | undefined
  if (!f) return httpError(res, 404, 'file not found')
  res.json({ id: f.id, path: f.path, language: f.language, lineCount: f.line_count, content: f.content })
})

// ---------- repositories / tags / collections ----------

api.get('/repositories', (_req, res) => {
  res.json(listRepositories())
})

api.get('/tags', (_req, res) => {
  res.json(listTags())
})

api.get('/collections', (_req, res) => {
  res.json(listCollections())
})

api.post('/collections', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>
  if (typeof b.name !== 'string' || b.name.length === 0) return httpError(res, 400, 'name is required')
  const id = uid()
  db.prepare('INSERT INTO collections (id, name, description, sort_order) VALUES (?, ?, ?, ?)').run(
    id,
    b.name,
    typeof b.description === 'string' ? b.description : null,
    typeof b.sortOrder === 'number' ? b.sortOrder : 0,
  )
  res.status(201).json({ id, name: b.name })
})

api.delete('/collections/:id', (req, res) => {
  db.prepare('DELETE FROM collections WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

api.put('/collections/:id/items', (req, res) => {
  const flowIds = Array.isArray((req.body ?? {}) as unknown) ? (req.body as unknown as string[]) : null
  if (!flowIds) return httpError(res, 400, 'body must be an array of flow ids')
  const col = db.prepare('SELECT id FROM collections WHERE id = ?').get(req.params.id) as { id: string } | undefined
  if (!col) return httpError(res, 404, 'collection not found')
  db.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(req.params.id)
  const ins = db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, flow_id, sort_order) VALUES (?, ?, ?)')
  flowIds.forEach((fid, i) => ins.run(req.params.id, fid, i))
  res.json(listCollections().find((c) => c.id === req.params.id))
})
