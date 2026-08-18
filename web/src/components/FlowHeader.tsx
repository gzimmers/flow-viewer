import { Link } from 'react-router-dom'
import type { FlowDetail, ViewMode } from '../types'

interface FlowHeaderProps {
  detail: FlowDetail
  view: ViewMode
  query: string
  onQuery: (q: string) => void
  onView: (v: ViewMode) => void
  onToggleFavorite: () => void
}

const TYPE_BADGE: Record<string, string> = {
  http: 'HTTP',
  startup: 'Startup',
  async: 'Async',
  job: 'Job',
  ui: 'UI',
  other: 'Flow',
}

export function FlowHeader({ detail, view, query, onQuery, onView, onToggleFavorite }: FlowHeaderProps) {
  const f = detail.flow
  const repo = f.repository?.name ?? 'repository'
  const branch = f.branch ?? f.repository?.branch ?? 'main'
  return (
    <header className="flow-header">
      <Link className="header-back" to="/" title="Back to flow library">
        ← <span>Flows</span>
      </Link>
      <div className="header-title">
        <span className="header-name">{f.name}</span>
        <span className={`type-badge type-${f.type}`}>{TYPE_BADGE[f.type] ?? f.type}</span>
        <span className="header-version">v{detail.version}</span>
        <button
          className={`fav ${f.isFavorite ? 'on' : ''}`}
          title={f.isFavorite ? 'Unfavorite' : 'Favorite'}
          onClick={onToggleFavorite}
        >
          {f.isFavorite ? '★' : '☆'}
        </button>
      </div>
      <div className="header-repo" title={f.repository?.url ?? ''}>
        {repo}:{branch}
      </div>
      <input
        className="header-search"
        placeholder="Find step, symbol, file… (Enter to jump)"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
      />
      <div className="view-toggle" role="tablist">
        <button role="tab" aria-selected={view === 'editor'} className={view === 'editor' ? 'on' : ''} onClick={() => onView('editor')}>
          Editor
        </button>
        <button role="tab" aria-selected={view === 'graph'} className={view === 'graph' ? 'on' : ''} onClick={() => onView('graph')}>
          Graph
        </button>
      </div>
    </header>
  )
}
