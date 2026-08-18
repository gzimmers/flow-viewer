import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Collection, FlowSummary, Repository, TagCount } from '../types'
import { formatRelative } from '../lib/flow'

type LibraryView = { kind: 'all' } | { kind: 'favorites' } | { kind: 'archived' } | { kind: 'collection'; id: string } | { kind: 'tag'; name: string }

export function Library() {
  const [flows, setFlows] = useState<FlowSummary[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [tags, setTags] = useState<TagCount[]>([])
  const [repos, setRepos] = useState<Repository[]>([])

  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [type, setType] = useState('')
  const [repo, setRepo] = useState('')
  const [view, setView] = useState<LibraryView>({ kind: 'all' })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 200)
    return () => clearTimeout(t)
  }, [q])

  const load = useMemo(
    () =>
      async (
        v: LibraryView,
        params: { q?: string; type?: string; repo?: string },
      ) => {
        try {
          let list = await api.listFlows({
            q: params.q,
            type: params.type,
            repo: params.repo,
            view: v.kind === 'favorites' ? 'favorites' : v.kind === 'archived' ? 'archived' : 'all',
          })
          if (v.kind === 'collection') {
            const col = collections.find((c) => c.id === v.id)
            const ids = new Set((col?.items ?? []).map((i) => i.flowId))
            list = list.filter((f) => ids.has(f.id))
          }
          if (v.kind === 'tag') {
            list = list.filter((f) => f.tags.includes(v.name))
          }
          setFlows(list)
          setError(null)
        } catch (e) {
          setError(String((e as Error).message ?? e))
        }
      },
    [collections],
  )

  useEffect(() => {
    api.collections().then(setCollections).catch(() => undefined)
    api.tags().then(setTags).catch(() => undefined)
    api.repositories().then(setRepos).catch(() => undefined)
  }, [])

  useEffect(() => {
    load(view, { q: debouncedQ || undefined, type: type || undefined, repo: repo || undefined })
  }, [view, debouncedQ, type, repo, load])

  const title =
    view.kind === 'all'
      ? 'All Flows'
      : view.kind === 'favorites'
        ? 'Favorites'
        : view.kind === 'archived'
          ? 'Archived'
          : view.kind === 'collection'
            ? collections.find((c) => c.id === view.id)?.name ?? 'Collection'
            : `#${view.name}`

  return (
    <div className="library">
      <aside className="lib-sidebar">
        <div className="lib-logo">
          <span className="lib-logo-mark">⇢</span> Flow Viewer
        </div>
        <nav className="lib-nav">
          <div className="lib-nav-section">
            <div className="lib-nav-title">Library</div>
            <button className={view.kind === 'all' ? 'on' : ''} onClick={() => setView({ kind: 'all' })}>
              All Flows
            </button>
            <button className={view.kind === 'favorites' ? 'on' : ''} onClick={() => setView({ kind: 'favorites' })}>
              ★ Favorites
            </button>
            <button className={view.kind === 'archived' ? 'on' : ''} onClick={() => setView({ kind: 'archived' })}>
              Archived
            </button>
          </div>
          <div className="lib-nav-section">
            <div className="lib-nav-title">Collections</div>
            {collections.map((c) => (
              <button
                key={c.id}
                className={view.kind === 'collection' && view.id === c.id ? 'on' : ''}
                onClick={() => setView({ kind: 'collection', id: c.id })}
              >
                {c.name}
                <span className="lib-count">{c.items.length}</span>
              </button>
            ))}
          </div>
          <div className="lib-nav-section">
            <div className="lib-nav-title">Tags</div>
            {tags.map((t) => (
              <button key={t.name} className={view.kind === 'tag' && view.name === t.name ? 'on' : ''} onClick={() => setView({ kind: 'tag', name: t.name })}>
                #{t.name}
                <span className="lib-count">{t.count}</span>
              </button>
            ))}
          </div>
        </nav>
      </aside>

      <main className="lib-main">
        <div className="lib-toolbar">
          <input
            className="lib-search"
            placeholder="Search flows, symbols, files…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <select className="lib-select" value={type} onChange={(e) => setType(e.target.value)} title="Filter by flow type">
            <option value="">All types</option>
            <option value="http">HTTP</option>
            <option value="startup">Startup</option>
            <option value="async">Async</option>
            <option value="job">Job</option>
            <option value="ui">UI</option>
            <option value="other">Other</option>
          </select>
          <select className="lib-select" value={repo} onChange={(e) => setRepo(e.target.value)} title="Filter by repository">
            <option value="">All repositories</option>
            {repos.map((r) => (
              <option key={r.id} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        </div>

        <div className="lib-results">
          <div className="lib-results-head">
            <span className="lib-results-title">{title}</span>
            <span className="lib-results-count">
              {flows.length} flow{flows.length === 1 ? '' : 's'}
            </span>
          </div>

          {error && <div className="lib-error">{error}</div>}

          {flows.length === 0 && !error && (
            <div className="lib-empty">
              <p>No flows match.</p>
              <p className="dim">
                Publish one from a coding agent: <code>POST /api/flows</code> — see README and{' '}
                <code>server/examples/publish-create-exporter.json</code>.
              </p>
            </div>
          )}

          <div className="flow-cards">
            {flows.map((f) => (
              <FlowCard
                key={f.id}
                f={f}
                onToggleFavorite={() =>
                  api.patchFlow(f.id, { isFavorite: !f.isFavorite }).then((updated) => setFlows((cur) => cur.map((x) => (x.id === f.id ? { ...x, ...updated } : x))))
                }
                onArchive={() =>
                  api.patchFlow(f.id, { isArchived: !f.isArchived }).then(() => load(view, { q: debouncedQ || undefined, type: type || undefined, repo: repo || undefined }))
                }
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}

function FlowCard({ f, onToggleFavorite, onArchive }: { f: FlowSummary; onToggleFavorite: () => void; onArchive: () => void }) {
  return (
    <Link className={`flow-card ${f.isFavorite ? 'fav' : ''}`} to={`/flow/${f.id}`}>
      <div className="fc-top">
        <span className="fc-name">{f.name}</span>
        <span className={`type-badge type-${f.type}`}>{f.type.toUpperCase()}</span>
        <span className="fc-spacer" />
        <span className="fc-stats">
          {f.fileCount} files · {f.regionCount} regions · v{f.latestVersion}
        </span>
        <button
          className={`fc-fav ${f.isFavorite ? 'on' : ''}`}
          title={f.isFavorite ? 'Unfavorite' : 'Favorite'}
          onClick={(e) => {
            e.preventDefault()
            onToggleFavorite()
          }}
        >
          {f.isFavorite ? '★' : '☆'}
        </button>
        <button
          className="fc-archive"
          title={f.isArchived ? 'Unarchive' : 'Archive'}
          onClick={(e) => {
            e.preventDefault()
            onArchive()
          }}
        >
          {f.isArchived ? '↩' : '⌫'}
        </button>
      </div>
      {f.description && <div className="fc-desc">{f.description}</div>}
      <div className="fc-bottom">
        {f.repository && (
          <span className="fc-repo" title={f.repository.url ?? ''}>
            {f.repository.name}:{f.branch ?? f.repository.branch ?? 'main'}
          </span>
        )}
        <span className="fc-tags">
          {f.tags.map((t) => (
            <span key={t} className="fc-tag">
              #{t}
            </span>
          ))}
        </span>
        <span className="fc-spacer" />
        <span className="fc-updated">{formatRelative(f.updatedAt)}</span>
      </div>
    </Link>
  )
}
