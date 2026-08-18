import { useEffect, useMemo, useRef } from 'react'
import type { FlowDetail } from '../types'
import { exitNodes, exitTone, pathNodes } from '../lib/flow'

interface PathStripProps {
  detail: FlowDetail
  activeNodeId: string | null
  dimmedIds: Set<string> | null
  exitFilter: string | null
  onNavigateNode: (nodeId: string) => void
  onToggleExit: (exitId: string, status: string) => void
}

export function PathStrip({ detail, activeNodeId, dimmedIds, exitFilter, onNavigateNode, onToggleExit }: PathStripProps) {
  const path = useMemo(() => pathNodes(detail), [detail])
  const exits = useMemo(() => exitNodes(detail), [detail])
  const activeRef = useRef<HTMLButtonElement | null>(null)

  // Keep the active pill in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeNodeId])

  const isDim = (id: string) => (dimmedIds ? !dimmedIds.has(id) : false)

  return (
    <div className="path-strip" role="navigation" aria-label="Flow path">
      <div className="path-strip-scroll">
        {path.map((n, i) => {
          const active = n.id === activeNodeId
          const dim = isDim(n.id)
          return (
            <span key={n.id} className={`path-seg ${dim ? 'dim' : ''}`}>
              <button
                ref={active ? activeRef : undefined}
                className={`path-pill kind-${n.kind} ${active ? 'active' : ''} ${dim ? 'dim' : ''}`}
                title={`${n.label} · ${n.file?.path ?? ''} L${n.startLine}–${n.endLine}`}
                onClick={() => onNavigateNode(n.id)}
              >
                <span className="path-step">{i + 1}</span>
                <span className="path-label">{n.label}</span>
                {n.startLine != null && <span className="path-lines">
                  {n.startLine}–{n.endLine}
                </span>}
              </button>
              {i < path.length - 1 && <span className={`path-arrow ${dim ? 'dim' : ''}`}>→</span>}
            </span>
          )
        })}
        <span className="path-exits">
          <span className="path-exits-title">Exits</span>
          {exits.map((n) => {
            const tone = exitTone(n.exitStatus)
            const selected = exitFilter != null && n.exitStatus === exitFilter
            const dim = isDim(n.id) && !selected
            return (
              <button
                key={n.id}
                className={`exit-chip tone-${tone} ${selected ? 'selected' : ''} ${dim ? 'dim' : ''}`}
                title={`Filter path to ${n.exitLabel ?? n.label}`}
                onClick={() => onToggleExit(n.id, n.exitStatus ?? '')}
              >
                {n.exitLabel ?? n.label}
              </button>
            )
          })}
        </span>
      </div>
    </div>
  )
}
