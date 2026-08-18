// Builds a Flow describing THIS application's own "open a flow" execution
// path (Library click → Router → Workspace → fetch → Express → SQLite →
// Monaco render). The payload is written to examples/publish-self-flow.json
// and is meant to be published through the normal agent API:
//
//   curl -X POST -H "Content-Type: application/json" \
//     -d @server/examples/publish-self-flow.json http://localhost:4000/api/flows

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { regionOf, lineOf } from './seed/regions.js'
import type { PublishPayload } from '../types.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function region(content: string, startAnchor: string, endAnchor?: string) {
  const r = regionOf(content, startAnchor, endAnchor)
  return { startLine: r.start, endLine: r.end }
}

function singleLine(content: string, needle: string) {
  const l = lineOf(content, needle)
  return { startLine: l, endLine: l }
}

const LIBRARY = 'web/src/components/Library.tsx'
const APP = 'web/src/App.tsx'
const WORKSPACE = 'web/src/components/Workspace.tsx'
const API = 'web/src/api.ts'
const ROUTES = 'server/src/routes.ts'
const QUERIES = 'server/src/queries.ts'
const INDEX = 'server/src/index.ts'
const SOURCE_VIEW = 'web/src/components/SourceView.tsx'
const DECORATIONS = 'web/src/lib/decorations.ts'

const library = read(LIBRARY)
const app = read(APP)
const workspace = read(WORKSPACE)
const api = read(API)
const routes = read(ROUTES)
const queries = read(QUERIES)
const index = read(INDEX)
const sourceView = read(SOURCE_VIEW)
const decorations = read(DECORATIONS)

const payload: PublishPayload = {
  name: 'Open Flow (Self)',
  description:
    'This flow describes flow-viewer itself: what happens when you click a flow card in the library — the React click handler, the router, the workspace API load, the Express + SQLite backend, and back on the client where the Monaco editor mounts, text models are created, region decorations are applied, and the entry region is revealed.',
  type: 'ui',
  branch: 'main',
  tags: ['ui', 'internal', 'http'],
  repository: {
    name: 'flow-viewer',
    url: 'local://flow-viewer',
    defaultBranch: 'main',
  },
  files: [
    { path: LIBRARY, language: 'typescript', content: library },
    { path: APP, language: 'typescript', content: app },
    { path: WORKSPACE, language: 'typescript', content: workspace },
    { path: API, language: 'typescript', content: api },
    { path: ROUTES, language: 'typescript', content: routes },
    { path: QUERIES, language: 'typescript', content: queries },
    { path: INDEX, language: 'typescript', content: index },
    { path: SOURCE_VIEW, language: 'typescript', content: sourceView },
    { path: DECORATIONS, language: 'typescript', content: decorations },
  ],
  nodes: [
    {
      key: 'entry',
      sortOrder: 1,
      kind: 'entry',
      label: 'Flow card click',
      symbol: 'FlowCard',
      file: LIBRARY,
      ...region(library, 'function FlowCard'),
      meta: {
        protocol: 'ui',
        event: 'click',
        target: 'FlowCard',
        route: '/flow/:flowId',
        handler: 'Library.tsx → FlowCard (<Link>)',
      },
    },
    {
      key: 'route',
      sortOrder: 2,
      label: 'Route → <Workspace>',
      symbol: 'FlowRoute',
      file: APP,
      ...region(app, 'function FlowRoute'),
    },
    {
      key: 'load',
      sortOrder: 3,
      label: 'Trigger API load',
      file: WORKSPACE,
      ...region(workspace, 'let cancelled = false', '  }, [flowId])'),
      meta: { note: 'Workspace useEffect([flowId])' },
    },
    {
      key: 'fetch',
      sortOrder: 4,
      label: "fetch('/api/flows/:id')",
      symbol: 'getFlow',
      file: API,
      ...region(api, 'getFlow(id: string'),
    },
    {
      key: 'httpIn',
      sortOrder: 5,
      label: 'Express GET /flows/:id',
      symbol: 'getFlowDetail',
      file: ROUTES,
      ...region(routes, "api.get('/flows/:id',"),
    },
    {
      key: 'getMeta',
      sortOrder: 6,
      label: 'SQL: flow meta + repository',
      symbol: 'getFlowMeta',
      file: QUERIES,
      ...region(queries, 'export function getFlowMeta'),
    },
    {
      key: 'loadGraph',
      sortOrder: 7,
      label: 'SQL: nodes + edges + complete files',
      symbol: 'loadVersionGraph',
      file: QUERIES,
      ...region(queries, 'function loadVersionGraph'),
    },
    {
      key: 'initialNav',
      sortOrder: 8,
      label: 'Open entry node + reveal region',
      file: WORKSPACE,
      ...region(workspace, 'const entry = d.nodes.filter', 'setRevealToken(1)'),
    },
    {
      key: 'editorMount',
      sortOrder: 9,
      label: 'Create Monaco editor',
      symbol: 'editor.create',
      file: SOURCE_VIEW,
      ...region(sourceView, 'const el = containerRef.current', '  }, [])'),
    },
    {
      key: 'model',
      sortOrder: 10,
      label: 'Create per-file text model',
      symbol: 'getOrCreateModel',
      file: SOURCE_VIEW,
      ...region(sourceView, 'const getOrCreateModel = useCallback', '  }, [])'),
    },
    {
      key: 'decorate',
      sortOrder: 11,
      label: 'deltaDecorations: regions + links',
      symbol: 'buildDecorations',
      file: DECORATIONS,
      ...region(decorations, 'export function buildDecorations'),
    },
    {
      key: 'reveal',
      sortOrder: 12,
      label: 'revealLineInCenter(startLine)',
      symbol: 'revealLineInCenter',
      file: SOURCE_VIEW,
      ...region(sourceView, 'revealToken === 0', '  }, [revealToken, activeNode, activeFileId])'),
    },
    {
      key: 'exitOk',
      sortOrder: 13,
      kind: 'exit',
      label: 'Workspace rendered',
      file: WORKSPACE,
      ...singleLine(workspace, '<div className="workspace">'),
      exitStatus: 'OK',
      exitLabel: 'workspace rendered',
    },
    {
      key: 'exit404',
      sortOrder: 14,
      kind: 'exit',
      label: 'Flow not found',
      file: WORKSPACE,
      ...region(workspace, 'if (error) {'),
      exitStatus: '404',
      exitLabel: 'could not load flow',
    },
    {
      key: 'exit500',
      sortOrder: 15,
      kind: 'exit',
      label: 'API error',
      file: INDEX,
      ...region(index, 'app.use((err: Error'),
      exitStatus: '500',
      exitLabel: 'internal error',
    },
  ],
  edges: [
    { from: 'entry', to: 'route', kind: 'sync', label: 'navigate /flow/:id' },
    { from: 'route', to: 'load', kind: 'sync', label: 'mount <Workspace>' },
    { from: 'load', to: 'fetch', kind: 'sync', label: 'api.getFlow()' },
    { from: 'fetch', to: 'httpIn', kind: 'async', label: 'HTTP GET /api/flows/:id' },
    { from: 'httpIn', to: 'getMeta', kind: 'sync' },
    { from: 'getMeta', to: 'loadGraph', kind: 'sync' },
    { from: 'loadGraph', to: 'initialNav', kind: 'async', label: 'HTTP 200 → JSON' },
    { from: 'initialNav', to: 'editorMount', kind: 'sync', label: 'render <SourceView>' },
    { from: 'editorMount', to: 'model', kind: 'sync' },
    { from: 'model', to: 'decorate', kind: 'sync', label: 're-sync on navigation' },
    { from: 'decorate', to: 'reveal', kind: 'sync' },
    { from: 'reveal', to: 'exitOk', kind: 'sync' },
    { from: 'load', to: 'exit404', kind: 'error', label: 'fetch failed / 404' },
    { from: 'httpIn', to: 'exit500', kind: 'error', label: 'unhandled error' },
  ],
}

const outDir = path.join(ROOT, 'server', 'examples')
mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'publish-self-flow.json')
writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')

const nodeCount = (payload.nodes ?? []).length
const edgeCount = (payload.edges ?? []).length
console.log(`[self-flow] wrote ${out} (${(JSON.stringify(payload).length / 1024).toFixed(0)} KB, ${nodeCount} nodes, ${edgeCount} edges)`)
console.log('[self-flow] publish it with:')
console.log('  curl -X POST -H "Content-Type: application/json" -d @server/examples/publish-self-flow.json http://localhost:4000/api/flows')
