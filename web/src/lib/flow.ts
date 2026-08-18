import type { FlowDetail, FlowEdge, FlowNode } from '../types'

/** Path nodes (non-exits) in execution order. */
export function pathNodes(detail: FlowDetail): FlowNode[] {
  return detail.nodes.filter((n) => n.kind !== 'exit').sort((a, b) => a.sortOrder - b.sortOrder)
}

/** Exit nodes in sortOrder order. */
export function exitNodes(detail: FlowDetail): FlowNode[] {
  return detail.nodes.filter((n) => n.kind === 'exit').sort((a, b) => a.sortOrder - b.sortOrder)
}

/** All navigable nodes in path order (exits last). */
export function orderedNodes(detail: FlowDetail): FlowNode[] {
  return [...pathNodes(detail), ...exitNodes(detail)]
}

export function nodesById(detail: FlowDetail): Map<string, FlowNode> {
  return new Map(detail.nodes.map((n) => [n.id, n]))
}

export function filesById(detail: FlowDetail): Map<string, FlowDetail['files'][number]> {
  return new Map(detail.files.map((f) => [f.id, f]))
}

export type ExitTone = 'ok' | 'warn' | 'bad' | 'neutral'

export function exitTone(status: string | null): ExitTone {
  if (!status) return 'neutral'
  const s = status.toUpperCase()
  if (s === 'OK' || s === 'COMMITTED' || /^2/.test(s)) return 'ok'
  if (s === 'FAIL' || /^5/.test(s)) return 'bad'
  if (s === 'DLQ' || /^4/.test(s)) return 'warn'
  return 'neutral'
}

/**
 * Backward reachability from an exit node: the set of nodes and edges that
 * can reach it. Used for exit-path filtering.
 */
export function backwardReachable(edges: FlowEdge[], exitId: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>([exitId])
  const edgesSet = new Set<string>()
  const byTarget = new Map<string, FlowEdge[]>()
  for (const e of edges) {
    const arr = byTarget.get(e.to) ?? []
    arr.push(e)
    byTarget.set(e.to, arr)
  }
  const queue = [exitId]
  while (queue.length) {
    const id = queue.pop()!
    for (const e of byTarget.get(id) ?? []) {
      edgesSet.add(e.id)
      if (!nodes.has(e.from)) {
        nodes.add(e.from)
        queue.push(e.from)
      }
    }
  }
  return { nodes, edges: edgesSet }
}

export function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

export function dirName(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(0, i) : ''
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}
