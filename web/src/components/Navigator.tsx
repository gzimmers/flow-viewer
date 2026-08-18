import { useMemo } from 'react'
import type { FlowDetail, FlowNode } from '../types'
import { basename, dirName, exitNodes, exitTone, pathNodes } from '../lib/flow'

interface NavigatorProps {
  detail: FlowDetail
  activeNodeId: string | null
  dimmedIds: Set<string> | null
  query: string
  onNavigateNode: (nodeId: string) => void
}

export function Navigator({ detail, activeNodeId, dimmedIds, query, onNavigateNode }: NavigatorProps) {
  const path = useMemo(() => pathNodes(detail), [detail])
  const exits = useMemo(() => exitNodes(detail), [detail])

  const q = query.trim().toLowerCase()
  const matches = (n: FlowNode) => {
    if (!q) return true
    return (
      n.label.toLowerCase().includes(q) ||
      (n.symbol ?? '').toLowerCase().includes(q) ||
      (n.file?.path ?? '').toLowerCase().includes(q)
    )
  }

  const visiblePath = path.filter(matches)
  const visibleExits = exits.filter(matches)

  // Group path nodes by file, preserving first-appearance order.
  const groups = useMemo(() => {
    const order: string[] = []
    const byFile = new Map<string, FlowNode[]>()
    for (const n of visiblePath) {
      const key = n.fileId ?? ''
      if (!byFile.has(key)) {
        byFile.set(key, [])
        order.push(key)
      }
      byFile.get(key)!.push(n)
    }
    return order.map((key) => ({ key, file: detail.files.find((f) => f.id === key) ?? null, nodes: byFile.get(key)! }))
  }, [visiblePath, detail])

  const entry = visiblePath.find((n) => n.kind === 'entry')
  const isDim = (id: string) => (dimmedIds ? !dimmedIds.has(id) : false)

  return (
    <div className="navigator">
      {entry && (
        <div className="nav-section">
          <div className="nav-section-title">Entry</div>
          <NodeRow n={entry} active={activeNodeId === entry.id} dim={isDim(entry.id)} onClick={() => onNavigateNode(entry.id)} />
        </div>
      )}

      <div className="nav-section">
        <div className="nav-section-title">Path</div>
        {groups.map((g) => (
          <div key={g.key || 'none'} className="nav-file">
            {g.file && (
              <div className="nav-file-header" title={g.file.path}>
                <span className="nav-file-name">{basename(g.file.path)}</span>
                <span className="nav-file-dir">{dirName(g.file.path).replace(/^src\/main\/java\//, '')}</span>
                <span className="nav-file-count">{g.nodes.length}</span>
              </div>
            )}
            {g.nodes.map((n) => (
              <NodeRow key={n.id} n={n} active={activeNodeId === n.id} dim={isDim(n.id)} onClick={() => onNavigateNode(n.id)} />
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="nav-empty">No steps match “{query}”.</div>}
      </div>

      <div className="nav-section">
        <div className="nav-section-title">Exits</div>
        {visibleExits.map((n) => (
          <NodeRow key={n.id} n={n} active={activeNodeId === n.id} dim={isDim(n.id)} onClick={() => onNavigateNode(n.id)} tone={exitTone(n.exitStatus)} />
        ))}
        {visibleExits.length === 0 && <div className="nav-empty">No exits match “{query}”.</div>}
      </div>
    </div>
  )
}

function NodeRow({
  n,
  active,
  dim,
  onClick,
  tone,
}: {
  n: FlowNode
  active: boolean
  dim: boolean
  onClick: () => void
  tone?: string
}) {
  const icon =
    n.kind === 'entry' ? '▶' : n.kind === 'exit' ? '■' : n.kind === 'async' ? '⇢' : n.kind === 'branch' ? '◇' : '·'
  return (
    <button className={`nav-row kind-${n.kind} ${active ? 'active' : ''} ${dim ? 'dim' : ''}`} onClick={onClick} title={n.file?.path ?? ''}>
      <span className={`nav-icon kind-${n.kind}`}>{icon}</span>
      <span className="nav-label">
        {n.label}
        {n.symbol && <span className="nav-symbol"> {n.symbol}</span>}
      </span>
      <span className={`nav-meta ${tone ? `tone-${tone}` : ''}`}>
        {n.kind === 'exit' && n.exitStatus ? n.exitStatus : n.startLine != null ? `${n.startLine}–${n.endLine}` : ''}
      </span>
    </button>
  )
}
