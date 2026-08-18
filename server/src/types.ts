// Shared wire types between the publish API and the REST read API.

export type FlowType = 'http' | 'startup' | 'async' | 'job' | 'other'
export type NodeKind = 'entry' | 'call' | 'branch' | 'async' | 'exit'
export type EdgeKind = 'sync' | 'async' | 'branch' | 'error'

/** Agent-facing publish payload (POST /api/flows, POST /api/flows/:id/versions). */
export interface PublishPayload {
  name?: string
  description?: string
  type?: string
  branch?: string
  tags?: string[]
  note?: string
  repository?: {
    name: string
    url?: string
    defaultBranch?: string
  }
  files?: Array<{
    path: string
    language?: string
    content: string
  }>
  nodes?: Array<{
    key: string
    sortOrder?: number
    kind?: string
    label: string
    symbol?: string
    file?: string
    startLine?: number
    endLine?: number
    exitStatus?: string
    exitLabel?: string
    meta?: unknown
  }>
  edges?: Array<{
    from: string
    to: string
    kind?: string
    label?: string
  }>
}

export interface FlowSummary {
  id: string
  name: string
  description: string | null
  type: string
  repository: { id: string; name: string; url: string | null; branch: string | null } | null
  branch: string | null
  tags: string[]
  fileCount: number
  regionCount: number
  isFavorite: boolean
  isArchived: boolean
  latestVersion: number
  createdAt: string
  updatedAt: string
}

export interface FlowFile {
  id: string
  path: string
  language: string
  lineCount: number
  content: string
}

export interface FlowNode {
  id: string
  key: string
  sortOrder: number
  kind: string
  label: string
  symbol: string | null
  fileId: string | null
  file: { path: string; language: string } | null
  startLine: number | null
  endLine: number | null
  exitStatus: string | null
  exitLabel: string | null
  meta: unknown
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  kind: string
  label: string | null
}

export interface FlowDetail {
  flow: {
    id: string
    name: string
    description: string | null
    type: string
    repository: { id: string; name: string; url: string | null; branch: string | null } | null
    branch: string | null
    tags: string[]
    isFavorite: boolean
    isArchived: boolean
    createdAt: string
    updatedAt: string
  }
  version: number
  nodes: FlowNode[]
  edges: FlowEdge[]
  files: FlowFile[]
}

export interface CollectionItem {
  flowId: string
  flowName: string
  sortOrder: number
}

export interface Collection {
  id: string
  name: string
  description: string | null
  sortOrder: number
  items: CollectionItem[]
}
