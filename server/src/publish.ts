import { db, uid, now } from './db.js'
import type { PublishPayload } from './types.js'

export class PublishError extends Error {}

const NODE_KINDS = new Set(['entry', 'call', 'branch', 'async', 'exit'])
const EDGE_KINDS = new Set(['sync', 'async', 'branch', 'error'])

interface UpsertedFile {
  id: string
  path: string
  lineCount: number
}

function upsertRepository(repo: { name: string; url?: string; defaultBranch?: string }): string {
  if (!repo || typeof repo.name !== 'string' || repo.name.length === 0) {
    throw new PublishError('repository.name is required')
  }
  const key = repo.url ?? repo.name
  const row = db
    .prepare('SELECT id FROM repositories WHERE name = ? AND (url IS ? OR url = ?)')
    .get(repo.name, key, key) as { id: string } | undefined
  if (row) return row.id
  const id = uid()
  db.prepare('INSERT INTO repositories (id, name, url, default_branch, created_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    repo.name,
    repo.url ?? null,
    repo.defaultBranch ?? null,
    now(),
  )
  return id
}

function upsertFiles(repositoryId: string, files: PublishPayload['files']): Map<string, UpsertedFile> {
  const byPath = new Map<string, UpsertedFile>()
  if (!files) return byPath
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || f.path.length === 0) throw new PublishError('files[].path is required')
    if (typeof f.content !== 'string') throw new PublishError(`files[].content is required for ${f.path}`)
    const lineCount = f.content.length === 0 ? 0 : f.content.split('\n').length
    const existing = db
      .prepare('SELECT id FROM files WHERE repository_id = ? AND path = ?')
      .get(repositoryId, f.path) as { id: string } | undefined
    if (existing) {
      db.prepare('UPDATE files SET content = ?, language = ?, line_count = ?, updated_at = ? WHERE id = ?').run(
        f.content,
        f.language ?? 'java',
        lineCount,
        now(),
        existing.id,
      )
      byPath.set(f.path, { id: existing.id, path: f.path, lineCount })
    } else {
      const id = uid()
      db.prepare(
        'INSERT INTO files (id, repository_id, path, language, content, line_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, repositoryId, f.path, f.language ?? 'java', f.content, lineCount, now())
      byPath.set(f.path, { id, path: f.path, lineCount })
    }
  }
  return byPath
}

function resolveFileId(
  repositoryId: string,
  byPath: Map<string, UpsertedFile>,
  fileRef: string | undefined,
): string | null {
  if (!fileRef) return null
  const known = byPath.get(fileRef)
  if (known) return known.id
  const existing = db
    .prepare('SELECT id FROM files WHERE repository_id = ? AND path = ?')
    .get(repositoryId, fileRef) as { id: string } | undefined
  if (existing) return existing.id
  throw new PublishError(`node references unknown file '${fileRef}'`)
}

function upsertTags(flowId: string, tags: string[] | undefined): void {
  if (!tags) return
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)')
  const insFlowTag = db.prepare('INSERT OR IGNORE INTO flow_tags (flow_id, tag_id) VALUES (?, ?)')
  for (const raw of tags) {
    const name = String(raw).trim().toLowerCase()
    if (!name) continue
    insTag.run(name)
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
    insFlowTag.run(flowId, tag.id)
  }
}

/**
 * Validate a publish payload and write it as a new flow (version 1) or as a
 * new version of an existing flow. Mirrors the agent publish contract exactly.
 */
export function publishFlow(payload: PublishPayload, existingFlowId?: string): { flowId: string; version: number } {
  if (payload.nodes && !Array.isArray(payload.nodes)) throw new PublishError('nodes must be an array')
  if (!payload.nodes || payload.nodes.length === 0) throw new PublishError('at least one node is required')
  if (!payload.name && !existingFlowId) throw new PublishError('name is required')
  if (!payload.repository) throw new PublishError('repository is required')

  const keys = new Set<string>()
  for (const n of payload.nodes) {
    if (!n || typeof n.key !== 'string' || n.key.length === 0) throw new PublishError('nodes[].key is required')
    if (keys.has(n.key)) throw new PublishError(`duplicate node key '${n.key}'`)
    keys.add(n.key)
    if (!n.label) throw new PublishError(`node '${n.key}' is missing label`)
    const kind = n.kind ?? 'call'
    if (!NODE_KINDS.has(kind)) throw new PublishError(`node '${n.key}' has invalid kind '${kind}'`)
    if (n.startLine != null && n.endLine != null && n.endLine < n.startLine) {
      throw new PublishError(`node '${n.key}' endLine < startLine`)
    }
  }
  if (payload.edges) {
    for (const e of payload.edges) {
      if (!e || !keys.has(e.from)) throw new PublishError(`edge from unknown node '${e?.from}'`)
      if (!keys.has(e.to)) throw new PublishError(`edge to unknown node '${e?.to}'`)
      const kind = e.kind ?? 'sync'
      if (!EDGE_KINDS.has(kind)) throw new PublishError(`edge ${e.from}->${e.to} has invalid kind '${kind}'`)
    }
  }

  const repositoryId = upsertRepository(payload.repository)
  const files = upsertFiles(repositoryId, payload.files)

  const t = now()
  let flowId = existingFlowId
  let version = 1

  if (flowId) {
    const flow = db.prepare('SELECT * FROM flows WHERE id = ?').get(flowId) as Record<string, unknown> | undefined
    if (!flow) throw new PublishError(`flow '${flowId}' not found`)
    version = (flow.latest_version as number) + 1
    const name = typeof payload.name === 'string' && payload.name.length > 0 ? payload.name : null
    const description = typeof payload.description === 'string' ? payload.description : null
    const type = typeof payload.type === 'string' && payload.type.length > 0 ? payload.type : null
    const branch = typeof payload.branch === 'string' ? payload.branch : null
    db.prepare('UPDATE flows SET updated_at = ?, latest_version = ?, name = COALESCE(?, name), description = COALESCE(?, description), type = COALESCE(?, type), branch = COALESCE(?, branch) WHERE id = ?').run(
      t,
      version,
      name,
      description,
      type,
      branch,
      flowId,
    )
  } else {
    flowId = uid()
    db.prepare(
      `INSERT INTO flows (id, name, description, type, repository_id, branch, latest_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      flowId,
      payload.name as string,
      payload.description ?? null,
      payload.type ?? 'http',
      repositoryId,
      payload.branch ?? null,
      t,
      t,
    )
  }

  const versionId = uid()
  db.prepare('INSERT INTO flow_versions (id, flow_id, version, note, created_at) VALUES (?, ?, ?, ?, ?)').run(
    versionId,
    flowId,
    version,
    payload.note ?? null,
    t,
  )

  const nodeIds = new Map<string, string>()
  const insNode = db.prepare(
    `INSERT INTO nodes (id, flow_id, version_id, key, sort_order, kind, label, symbol, file_id, start_line, end_line, exit_status, exit_label, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  payload.nodes.forEach((n, i) => {
    const id = uid()
    nodeIds.set(n.key, id)
    const fileId = resolveFileId(repositoryId, files, n.file)
    if (fileId == null && (n.startLine != null || n.endLine != null)) {
      throw new PublishError(`node '${n.key}' has line range but no file`)
    }
    insNode.run(
      id,
      flowId,
      versionId,
      n.key,
      n.sortOrder ?? i + 1,
      n.kind ?? 'call',
      n.label,
      n.symbol ?? null,
      fileId,
      n.startLine ?? null,
      n.endLine ?? null,
      n.exitStatus ?? null,
      n.exitLabel ?? null,
      n.meta != null ? JSON.stringify(n.meta) : null,
    )
  })

  const insEdge = db.prepare(
    'INSERT INTO edges (id, flow_id, version_id, from_node, to_node, kind, label) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  for (const e of payload.edges ?? []) {
    insEdge.run(uid(), flowId, versionId, nodeIds.get(e.from)!, nodeIds.get(e.to)!, e.kind ?? 'sync', e.label ?? null)
  }

  upsertTags(flowId, payload.tags)
  return { flowId, version }
}
