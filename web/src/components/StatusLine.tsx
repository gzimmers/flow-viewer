import type { FlowDetail, ViewMode } from '../types'
import { basename, orderedNodes } from '../lib/flow'

interface StatusLineProps {
  detail: FlowDetail
  activeNodeId: string | null
  activeFileId: string | null
  view: ViewMode
  exitFilter: string | null
  onClearExitFilter: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function StatusLine({ detail, activeNodeId, activeFileId, view, exitFilter, onClearExitFilter, theme, onToggleTheme }: StatusLineProps) {
  const nodes = orderedNodes(detail)
  const idx = activeNodeId ? nodes.findIndex((n) => n.id === activeNodeId) : -1
  const activeFile = detail.files.find((f) => f.id === activeFileId) ?? null

  return (
    <footer className="status-line">
      <span className="status-item">
        {activeFile ? (
          <>
            <span className="status-file">{basename(activeFile.path)}</span>
            <span className="status-lines">
              {activeFile.lineCount} lines
            </span>
          </>
        ) : (
          <span className="status-file dim">no file</span>
        )}
      </span>
      {idx >= 0 && (
        <span className="status-item">
          step {idx + 1}/{nodes.length}
        </span>
      )}
      <span className="status-spacer" />
      {exitFilter && (
        <button className="status-exit" onClick={onClearExitFilter} title="Clear exit filter (Esc)">
          filtered to {exitFilter} ✕
        </button>
      )}
      <span className="status-item">
        {view === 'editor' ? 'editor' : 'graph'}
      </span>
      <button className="status-item theme-btn" onClick={onToggleTheme} title="Toggle theme">
        {theme === 'dark' ? '☾' : '☀'}
      </button>
    </footer>
  )
}
