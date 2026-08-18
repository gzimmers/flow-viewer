// Wire types (mirror server/src/types.ts)

export interface RepoRef {
  id: string
  name: string
  url: string | null
  branch: string | null
}

export interface FlowSummary {
  id: string
  name: string
  description: string | null
  type: string
  repository: RepoRef | null
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
  kind: string // entry | call | branch | async | exit
  label: string
  symbol: string | null
  fileId: string | null
  file: { path: string; language: string } | null
  startLine: number | null
  endLine: number | null
  exitStatus: string | null
  exitLabel: string | null
  meta: any
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  kind: string // sync | async | branch | error
  label: string | null
}

export interface FlowDetail {
  flow: {
    id: string
    name: string
    description: string | null
    type: string
    repository: RepoRef | null
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

export interface Collection {
  id: string
  name: string
  description: string | null
  sortOrder: number
  items: Array<{ flowId: string; flowName: string; sortOrder: number }>
}

export interface TagCount {
  name: string
  count: number
}

export interface Repository {
  id: string
  name: string
  url: string | null
  branch: string | null
  fileCount: number
  flowCount: number
}

export type ViewMode = 'editor' | 'graph'
