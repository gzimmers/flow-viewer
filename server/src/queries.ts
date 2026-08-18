import { db } from './db.js'
import type { FlowDetail, FlowSummary, FlowNode, FlowEdge, FlowFile, Collection } from './types.js'

interface FlowRow {
  id: string
  name: string
  description: string | null
  type: string
  repository_id: string | null
  branch: string | null
  latest_version: number
  is_favorite: number
  is_archived: number
  created_at: string
  updated_at: string
  repo_name: string | null
  repo_url: string | null
  repo_default_branch: string | null
  file_count: number
  region_count: number
}

const FLOW_LIST_SELECT = `
  SELECT f.*, r.name AS repo_name, r.url AS repo_url, r.default_branch AS repo_default_branch,
    (SELECT COUNT(DISTINCT n.file_id) FROM nodes n WHERE n.version_id = fv.id AND n.file_id IS NOT NULL) AS file_count,
    (SELECT COUNT(*) FROM nodes n WHERE n.version_id = fv.id AND n.file_id IS NOT NULL) AS region_count
  FROM flows f
  JOIN flow_versions fv ON fv.flow_id = f.id AND fv.version = f.latest_version
  LEFT JOIN repositories r ON r.id = f.repository_id
`

function tagsFor(flowId: string): string[] {
  const rows = db
    .prepare('SELECT t.name FROM tags t JOIN flow_tags ft ON ft.tag_id = t.id WHERE ft.flow_id = ? ORDER BY t.name')
    .all(flowId) as Array<{ name: string }>
  return rows.map((r) => r.name)
}

function repoFor(repositoryId: string | null) {
  if (!repositoryId) return null
  const r = db
    .prepare('SELECT id, name, url, default_branch FROM repositories WHERE id = ?')
    .get(repositoryId) as { id: string; name: string; url: string | null; default_branch: string | null } | undefined
  if (!r) return null
  return { id: r.id, name: r.name, url: r.url, branch: r.default_branch }
}

export interface FlowListFilter {
  q?: string
  type?: string
  repo?: string
  branch?: string
  tag?: string
  favorite?: boolean
  archived?: boolean
}

export function listFlows(filter: FlowListFilter): FlowSummary[] {
  const where: string[] = []
  const params: Array<string | number | null> = []
  if (filter.q) {
    where.push(
      `(f.name LIKE ? OR f.description LIKE ? OR EXISTS (
        SELECT 1 FROM nodes n WHERE n.version_id = fv.id AND (
          n.label LIKE ? OR n.symbol LIKE ? OR
          EXISTS (SELECT 1 FROM files fl WHERE fl.id = n.file_id AND fl.path LIKE ?)
        )))`,
    )
    const like = `%${filter.q}%`
    params.push(like, like, like, like, like)
  }
  if (filter.type) {
    where.push('f.type = ?')
    params.push(filter.type)
  }
  if (filter.repo) {
    where.push('r.name = ?')
    params.push(filter.repo)
  }
  if (filter.branch) {
    where.push('f.branch = ?')
    params.push(filter.branch)
  }
  if (filter.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM flow_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.flow_id = f.id AND t.name = ?)`,
    )
    params.push(filter.tag)
  }
  where.push(filter.favorite ? 'f.is_favorite = 1' : 'f.is_favorite = 0')
  where.push(filter.archived ? 'f.is_archived = 1' : 'f.is_archived = 0')

  const sql = `${FLOW_LIST_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.updated_at DESC`
  const rows = db.prepare(sql).all(...params) as unknown as FlowRow[]
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    repository: r.repository_id
      ? { id: r.repository_id, name: r.repo_name ?? '?', url: r.repo_url, branch: r.branch ?? r.repo_default_branch }
      : null,
    branch: r.branch,
    tags: tagsFor(r.id),
    fileCount: r.file_count,
    regionCount: r.region_count,
    isFavorite: !!r.is_favorite,
    isArchived: !!r.is_archived,
    latestVersion: r.latest_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export interface FlowMeta {
  id: string
  name: string
  description: string | null
  type: string
  repository: ReturnType<typeof repoFor>
  branch: string | null
  tags: string[]
  isFavorite: boolean
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export function getFlowMeta(flowId: string): FlowMeta | null {
  const r = db
    .prepare(
      `SELECT f.*, r.name AS repo_name, r.url AS repo_url, r.default_branch AS repo_default_branch
       FROM flows f LEFT JOIN repositories r ON r.id = f.repository_id WHERE f.id = ?`,
    )
    .get(flowId) as unknown as FlowRow | undefined
  if (!r) return null
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    type: r.type,
    repository: repoFor(r.repository_id),
    branch: r.branch,
    tags: tagsFor(r.id),
    isFavorite: !!r.is_favorite,
    isArchived: !!r.is_archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export function listFlowVersions(flowId: string): Array<{ version: number; note: string | null; createdAt: string }> {
  const rows = db
    .prepare('SELECT version, note, created_at FROM flow_versions WHERE flow_id = ? ORDER BY version DESC')
    .all(flowId) as Array<{ version: number; note: string | null; created_at: string }>
  return rows.map((r) => ({ version: r.version, note: r.note, createdAt: r.created_at }))
}

function loadVersionGraph(flowId: string, version: number): Pick<FlowDetail, 'nodes' | 'edges' | 'files'> {
  const ver = db
    .prepare('SELECT id FROM flow_versions WHERE flow_id = ? AND version = ?')
    .get(flowId, version) as { id: string } | undefined
  if (!ver) return { nodes: [], edges: [], files: [] }

  const nodeRows = db
    .prepare(
      `SELECT n.*, fl.path AS file_path, fl.language AS file_language
       FROM nodes n LEFT JOIN files fl ON fl.id = n.file_id
       WHERE n.version_id = ? ORDER BY n.sort_order, n.key`,
    )
    .all(ver.id) as Array<Record<string, unknown>>
  const nodes: FlowNode[] = nodeRows.map((r) => ({
    id: r.id as string,
    key: r.key as string,
    sortOrder: r.sort_order as number,
    kind: r.kind as string,
    label: r.label as string,
    symbol: (r.symbol as string | null) ?? null,
    fileId: (r.file_id as string | null) ?? null,
    file: r.file_path ? { path: r.file_path as string, language: r.file_language as string } : null,
    startLine: (r.start_line as number | null) ?? null,
    endLine: (r.end_line as number | null) ?? null,
    exitStatus: (r.exit_status as string | null) ?? null,
    exitLabel: (r.exit_label as string | null) ?? null,
    meta: r.meta ? JSON.parse(r.meta as string) : null,
  }))

  const edgeRows = db
    .prepare('SELECT id, from_node, to_node, kind, label FROM edges WHERE version_id = ? ORDER BY rowid')
    .all(ver.id) as Array<Record<string, unknown>>
  const edges: FlowEdge[] = edgeRows.map((r) => ({
    id: r.id as string,
    from: r.from_node as string,
    to: r.to_node as string,
    kind: r.kind as string,
    label: (r.label as string | null) ?? null,
  }))

  const fileRows = db
    .prepare(
      `SELECT DISTINCT fl.id, fl.path, fl.language, fl.line_count, fl.content
       FROM nodes n JOIN files fl ON fl.id = n.file_id
       WHERE n.version_id = ? ORDER BY fl.path`,
    )
    .all(ver.id) as Array<Record<string, unknown>>
  const files: FlowFile[] = fileRows.map((r) => ({
    id: r.id as string,
    path: r.path as string,
    language: r.language as string,
    lineCount: r.line_count as number,
    content: r.content as string,
  }))

  return { nodes, edges, files }
}

export function getFlowDetail(flowId: string, version?: number): FlowDetail | null {
  const meta = getFlowMeta(flowId)
  if (!meta) return null
  const v = version ?? (db.prepare('SELECT latest_version FROM flows WHERE id = ?').get(flowId) as { latest_version: number }).latest_version
  return { flow: meta, version: v, ...loadVersionGraph(flowId, v) }
}

export function listCollections(): Collection[] {
  const cols = db.prepare('SELECT id, name, description, sort_order FROM collections ORDER BY sort_order, name').all() as Array<
    Record<string, unknown>
  >
  return cols.map((c) => {
    const items = db
      .prepare(
        `SELECT ci.flow_id, ci.sort_order, f.name AS flow_name
         FROM collection_items ci JOIN flows f ON f.id = ci.flow_id
         WHERE ci.collection_id = ? ORDER BY ci.sort_order, f.name`,
      )
      .all(c.id as string) as Array<Record<string, unknown>>
    return {
      id: c.id as string,
      name: c.name as string,
      description: (c.description as string | null) ?? null,
      sortOrder: c.sort_order as number,
      items: items.map((i) => ({ flowId: i.flow_id as string, flowName: i.flow_name as string, sortOrder: i.sort_order as number })),
    }
  })
}

export function listTags(): Array<{ name: string; count: number }> {
  return db
    .prepare('SELECT t.name, COUNT(ft.flow_id) AS count FROM tags t LEFT JOIN flow_tags ft ON ft.tag_id = t.id GROUP BY t.id ORDER BY t.name')
    .all() as Array<{ name: string; count: number }>
}

export function listRepositories(): Array<{ id: string; name: string; url: string | null; branch: string | null; fileCount: number; flowCount: number }> {
  const rows = db
    .prepare(
      `SELECT r.id, r.name, r.url, r.default_branch,
        (SELECT COUNT(*) FROM files f WHERE f.repository_id = r.id) AS file_count,
        (SELECT COUNT(*) FROM flows fl WHERE fl.repository_id = r.id) AS flow_count
       FROM repositories r ORDER BY r.name`,
    )
    .all() as Array<Record<string, unknown>>
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    url: (r.url as string | null) ?? null,
    branch: (r.default_branch as string | null) ?? null,
    fileCount: r.file_count as number,
    flowCount: r.flow_count as number,
  }))
}
