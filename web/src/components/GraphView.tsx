import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowDetail, FlowNode } from '../types'
import { basename, exitTone } from '../lib/flow'
import { layoutGraph, graphBounds, NODE_W, NODE_H, type GraphPos } from '../lib/graph'

interface GraphViewProps {
  detail: FlowDetail
  activeNodeId: string | null
  dimmedIds: Set<string> | null
  onNodeClick: (nodeId: string) => void
}

const EDGE_COLORS: Record<string, string> = {
  sync: 'var(--edge-sync)',
  async: 'var(--edge-async)',
  branch: 'var(--edge-branch)',
  error: 'var(--edge-error)',
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'entry':
      return '▶'
    case 'exit':
      return '■'
    case 'async':
      return '⇢'
    case 'branch':
      return '◇'
    default:
      return '·'
  }
}

interface Transform {
  x: number
  y: number
  k: number
}

export function GraphView({ detail, activeNodeId, dimmedIds, onNodeClick }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [t, setT] = useState<Transform>({ x: 40, y: 40, k: 0.85 })
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  const pos = useMemo(() => layoutGraph(detail.nodes, detail.edges), [detail])
  const bounds = useMemo(() => graphBounds(pos), [pos])
  const byId = useMemo(() => new Map(detail.nodes.map((n) => [n.id, n])), [detail])

  // Fit on first render / flow change.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const { clientWidth: w, clientHeight: h } = el
    if (w === 0 || h === 0) return
    const k = Math.min(1.1, Math.max(0.35, Math.min((w - 60) / bounds.width, (h - 60) / bounds.height)))
    setT({ x: (w - bounds.width * k) / 2, y: (h - bounds.height * k) / 2, k })
  }, [bounds])

  const isDim = (id: string) => (dimmedIds ? !dimmedIds.has(id) : false)
  const isDimEdge = (id: string) => {
    if (!dimmedIds) return false
    // Edge is dim when either endpoint is dim
    return !dimmedIds.has(id)
  }

  const onWheel = (e: React.WheelEvent) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setT((cur) => {
      const k = Math.min(2.5, Math.max(0.2, cur.k * factor))
      const scale = k / cur.k
      return { k, x: mx - (mx - cur.x) * scale, y: my - (my - cur.y) * scale }
    })
  }

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: t.x, oy: t.y }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    setT((cur) => ({ ...cur, x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) }))
  }
  const endDrag = () => {
    dragRef.current = null
  }

  const zoomBy = (factor: number) => {
    const el = containerRef.current
    if (!el) return
    const cx = el.clientWidth / 2
    const cy = el.clientHeight / 2
    setT((cur) => {
      const k = Math.min(2.5, Math.max(0.2, cur.k * factor))
      const scale = k / cur.k
      return { k, x: cx - (cx - cur.x) * scale, y: cy - (cy - cur.y) * scale }
    })
  }

  const fit = () => {
    const el = containerRef.current
    if (!el) return
    const { clientWidth: w, clientHeight: h } = el
    const k = Math.min(1.1, Math.max(0.35, Math.min((w - 60) / bounds.width, (h - 60) / bounds.height)))
    setT({ x: (w - bounds.width * k) / 2, y: (h - bounds.height * k) / 2, k })
  }

  return (
    <div
      className="graph-view"
      ref={containerRef}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      <svg width="100%" height="100%" className="graph-svg">
        <defs>
          {Object.entries(EDGE_COLORS).map(([kind, color]) => (
            <marker
              key={kind}
              id={`arrow-${kind}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {detail.edges.map((e) => {
            const from = pos.get(e.from)
            const to = pos.get(e.to)
            if (!from || !to) return null
            const x1 = from.x + NODE_W
            const y1 = from.y + NODE_H / 2
            const x2 = to.x
            const y2 = to.y + NODE_H / 2
            const dx = Math.max(40, Math.abs(x2 - x1) / 2)
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
            const dim = isDimEdge(e.from) && isDimEdge(e.to) ? 'dim' : ''
            const dash = e.kind === 'async' ? '7 4' : e.kind === 'error' ? '3 3' : undefined
            const labelX = (x1 + x2) / 2
            const labelY = (y1 + y2) / 2 - 6
            return (
              <g key={e.id} className={`graph-edge ${dim}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={EDGE_COLORS[e.kind] ?? EDGE_COLORS.sync}
                  strokeWidth={1.5}
                  strokeDasharray={dash}
                  markerEnd={`url(#arrow-${e.kind ?? 'sync'})`}
                />
                {e.label && (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    className={`graph-edge-label ${e.kind === 'async' ? 'async' : ''} ${dim ? 'dim' : ''}`}
                  >
                    {e.kind === 'async' ? `ASYNC · ${e.label}` : e.label}
                  </text>
                )}
              </g>
            )
          })}
          {detail.nodes.map((n) => {
            const p: GraphPos = pos.get(n.id) ?? { x: 0, y: 0, rank: 0 }
            const dim = isDim(n.id)
            const active = activeNodeId === n.id
            const tone = n.kind === 'exit' ? exitTone(n.exitStatus) : null
            return (
              <g
                key={n.id}
                transform={`translate(${p.x},${p.y})`}
                className={`graph-node kind-${n.kind} ${dim ? 'dim' : ''} ${active ? 'active' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onNodeClick(n.id)}
              >
                <rect width={NODE_W} height={NODE_H} rx={6} className={`node-box ${tone ? `tone-${tone}` : ''}`} />
                <text x={10} y={20} className="node-icon">
                  {kindIcon(n.kind)}
                </text>
                <text x={26} y={20} className="node-label">
                  {n.label.length > 30 ? n.label.slice(0, 29) + '…' : n.label}
                </text>
                <text x={26} y={38} className="node-file">
                  {n.file ? basename(n.file.path) : n.kind === 'entry' ? 'entry point' : '—'}
                </text>
                <text x={26} y={50} className="node-lines">
                  {n.startLine != null ? `L${n.startLine}–${n.endLine}` : n.kind === 'entry' ? entryHint(n) : ''}
                </text>
                {n.kind === 'exit' && n.exitStatus && (
                  <text x={NODE_W - 10} y={20} textAnchor="end" className={`node-status tone-${tone}`}>
                    {n.exitStatus}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
      <div className="graph-controls">
        <button title="Zoom in" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button title="Fit graph" onClick={fit}>
          ⤢
        </button>
      </div>
      <div className="graph-legend">
        <span>
          <i className="legend-line sync" /> call
        </span>
        <span>
          <i className="legend-line async" /> async boundary
        </span>
        <span>
          <i className="legend-line branch" /> branch
        </span>
        <span>
          <i className="legend-line error" /> error
        </span>
      </div>
    </div>
  )
}

function entryHint(n: FlowNode): string {
  const m = n.meta as Record<string, unknown> | null
  if (!m) return ''
  if (m.protocol === 'http') return `${m.method} ${m.path}`
  if (m.protocol === 'kafka') return `kafka: ${m.topic}`
  if (m.protocol === 'process') return 'process start'
  return ''
}
