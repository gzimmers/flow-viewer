import type { FlowEdge, FlowNode } from '../types'

export const NODE_W = 208
export const NODE_H = 58
export const RANK_GAP = 264
export const ROW_GAP = 88

export interface GraphPos {
  x: number
  y: number
  rank: number
}

/**
 * Layered left-to-right layout. Rank = longest path from any entry node
 * (capped relaxation so back-edges, e.g. loop flows, cannot diverge).
 * Within a rank, nodes are ordered by barycenter of predecessors.
 */
export function layoutGraph(nodes: FlowNode[], edges: FlowEdge[]): Map<string, GraphPos> {
  const ids = nodes.map((n) => n.id)
  const idSet = new Set(ids)
  const out = new Map<string, FlowEdge[]>()
  const inn = new Map<string, FlowEdge[]>()
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue
    ;(out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e)
    ;(inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e)
  }

  const rank = new Map<string, number>(ids.map((id) => [id, 0]))
  for (let iter = 0; iter <= ids.length + 2; iter++) {
    let changed = false
    for (const e of edges) {
      const r = rank.get(e.from) ?? 0
      const t = rank.get(e.to) ?? 0
      if (t < r + 1) {
        rank.set(e.to, r + 1)
        changed = true
      }
    }
    if (!changed) break
  }

  // Group by rank
  const byRank = new Map<number, string[]>()
  for (const id of ids) {
    const r = rank.get(id) ?? 0
    const arr = byRank.get(r) ?? []
    arr.push(id)
    byRank.set(r, arr)
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b)

  // Order within rank by barycenter of predecessor positions (one pass).
  const posInRank = new Map<string, number>()
  let prevOrder: Map<string, number> | null = null
  for (const r of ranks) {
    const group = byRank.get(r)!
    const score = new Map<string, number>()
    for (const id of group) {
      const preds = (inn.get(id) ?? []).map((e) => prevOrder?.get(e.from)).filter((v): v is number => v != null)
      score.set(id, preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.MAX_SAFE_INTEGER)
    }
    group.sort((a, b) => {
      const sa = score.get(a) ?? 0
      const sb = score.get(b) ?? 0
      if (sa !== sb) return sa - sb
      const na = nodes.find((n) => n.id === a)!.sortOrder
      const nb = nodes.find((n) => n.id === b)!.sortOrder
      return na - nb
    })
    group.forEach((id, i) => posInRank.set(id, i))
    prevOrder = posInRank
  }

  const result = new Map<string, GraphPos>()
  let maxRows = 0
  for (const r of ranks) {
    maxRows = Math.max(maxRows, byRank.get(r)!.length)
  }
  for (const r of ranks) {
    const group = byRank.get(r)!
    const offset = ((maxRows - group.length) * ROW_GAP) / 2
    group.forEach((id, i) => {
      result.set(id, {
        x: r * RANK_GAP,
        y: offset + i * ROW_GAP,
        rank: r,
      })
    })
  }
  return result
}

export function graphBounds(pos: Map<string, GraphPos>): { width: number; height: number } {
  let maxX = 0
  let maxY = 0
  for (const p of pos.values()) {
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { width: maxX + NODE_W + 40, height: maxY + NODE_H + 40 }
}
