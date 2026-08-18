import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { FlowDetail, FlowNode, ViewMode } from '../types'
import { backwardReachable, filesById, nodesById, orderedNodes, pathNodes } from '../lib/flow'
import { FlowHeader } from './FlowHeader'
import { PathStrip } from './PathStrip'
import { Navigator } from './Navigator'
import { SourceView } from './SourceView'
import { GraphView } from './GraphView'
import { StatusLine } from './StatusLine'

interface HistEntry {
  nodeId: string | null
  fileId: string | null
  scrollLine: number | null
}

export function Workspace({ flowId }: { flowId: string }) {
  const [detail, setDetail] = useState<FlowDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<ViewMode>('editor')
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [tabs, setTabs] = useState<string[]>([])
  const [history, setHistory] = useState<HistEntry[]>([])
  const [future, setFuture] = useState<HistEntry[]>([])
  const [exitFilter, setExitFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [revealToken, setRevealToken] = useState(0)
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelWidth, setPanelWidth] = useState(300)
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('flow-theme') as 'dark' | 'light') ?? 'dark',
  )

  const scrollLineRef = useRef<number | null>(null)
  const panelResizeRef = useRef<{ startX: number; startW: number } | null>(null)

  // Theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('flow-theme', theme)
    document.dispatchEvent(new CustomEvent('flow-theme-change'))
  }, [theme])

  // Load flow
  useEffect(() => {
    let cancelled = false
    api
      .getFlow(flowId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        // Open the entry node by default.
        const entry = d.nodes.filter((n) => n.kind === 'entry').sort((a, b) => a.sortOrder - b.sortOrder)[0]
        const target = entry ?? d.nodes.slice().sort((a, b) => a.sortOrder - b.sortOrder)[0]
        if (target) {
          setActiveNodeId(target.id)
          if (target.fileId) {
            setActiveFileId(target.fileId)
            setTabs([target.fileId])
          }
          setRevealToken(1)
        }
      })
      .catch((e) => setError(String(e.message ?? e)))
    return () => {
      cancelled = true
    }
  }, [flowId])

  const byId = useMemo(() => (detail ? nodesById(detail) : new Map<string, FlowNode>()), [detail])
  const files = useMemo(() => (detail ? filesById(detail) : new Map()), [detail])
  const ordered = useMemo(() => (detail ? orderedNodes(detail) : []), [detail])
  const path = useMemo(() => (detail ? pathNodes(detail) : []), [detail])

  // Exit-filter reachability
  const dimmedIds = useMemo(() => {
    if (!detail || !exitFilter) return null
    const exitNode = detail.nodes.find((n) => n.kind === 'exit' && n.exitStatus === exitFilter)
    if (!exitNode) return null
    const { nodes } = backwardReachable(detail.edges, exitNode.id)
    return nodes
  }, [detail, exitFilter])

  const pushHistory = useCallback(() => {
    const entry: HistEntry = {
      nodeId: activeNodeId,
      fileId: activeFileId,
      scrollLine: scrollLineRef.current,
    }
    setHistory((h) => [...h, entry])
    setFuture([])
  }, [activeNodeId, activeFileId])

  const navigate = useCallback(
    (nodeId: string, opts?: { history?: boolean; view?: ViewMode }) => {
      const node = byId.get(nodeId)
      if (!node) return
      if (opts?.history !== false) pushHistory()
      setActiveNodeId(nodeId)
      if (node.fileId) {
        setActiveFileId(node.fileId)
        setTabs((t) => (t.includes(node.fileId!) ? t : [...t, node.fileId!].slice(-10)))
      }
      if (opts?.view) setView(opts.view)
      setRevealToken((t) => t + 1)
    },
    [byId, pushHistory],
  )

  const restore = useCallback(
    (entry: HistEntry) => {
      setActiveNodeId(entry.nodeId)
      setActiveFileId(entry.fileId)
      if (entry.fileId && entry.nodeId) {
        setTabs((t) => (t.includes(entry.fileId!) ? t : [...t, entry.fileId!]))
      }
      // Reveal the node region (restores approximate position).
      const node = entry.nodeId ? byId.get(entry.nodeId) : null
      if (node && node.fileId && node.startLine) {
        scrollLineRef.current = node.startLine
      }
      setRevealToken((t) => t + 1)
    },
    [byId],
  )

  const goBack = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    const cur: HistEntry = { nodeId: activeNodeId, fileId: activeFileId, scrollLine: scrollLineRef.current }
    setHistory(history.slice(0, -1))
    setFuture([...future, cur])
    restore(prev)
  }, [history, future, activeNodeId, activeFileId, restore])

  const goForward = useCallback(() => {
    if (future.length === 0) return
    const next = future[future.length - 1]
    const cur: HistEntry = { nodeId: activeNodeId, fileId: activeFileId, scrollLine: scrollLineRef.current }
    setFuture(future.slice(0, -1))
    setHistory([...history, cur])
    restore(next)
  }, [history, future, activeNodeId, activeFileId, restore])

  const stepIndex = activeNodeId ? ordered.findIndex((n) => n.id === activeNodeId) : -1
  const goNext = useCallback(() => {
    if (ordered.length === 0) return
    const i = stepIndex < 0 ? 0 : (stepIndex + 1) % ordered.length
    navigate(ordered[i].id)
  }, [ordered, stepIndex, navigate])
  const goPrev = useCallback(() => {
    if (ordered.length === 0) return
    const i = stepIndex < 0 ? 0 : (stepIndex - 1 + ordered.length) % ordered.length
    navigate(ordered[i].id)
  }, [ordered, stepIndex, navigate])

  const toggleExit = useCallback((_exitId: string, status: string) => {
    setExitFilter((cur) => (cur === status ? null : status || null))
  }, [])

  const fileSelect = useCallback(
    (fileId: string) => {
      // Selecting a tab opens its first flow step.
      const node = detail
        ? detail.nodes.filter((n) => n.fileId === fileId).sort((a, b) => a.sortOrder - b.sortOrder)[0]
        : null
      if (node) {
        navigate(node.id, { history: false })
      } else {
        pushHistory()
        setActiveFileId(fileId)
        setTabs((t) => (t.includes(fileId) ? t : [...t, fileId]))
      }
    },
    [detail, navigate, pushHistory],
  )

  const fileClose = useCallback(
    (fileId: string) => {
      setTabs((t) => {
        const next = t.filter((id) => id !== fileId)
        if (fileId === activeFileId && next.length > 0) {
          const fallback = next[next.length - 1]
          const node = detail
            ? detail.nodes.filter((n) => n.fileId === fallback).sort((a, b) => a.sortOrder - b.sortOrder)[0]
            : null
          if (node) setActiveNodeId(node.id)
          setActiveFileId(fallback)
        }
        return next
      })
    },
    [activeFileId, detail],
  )

  // Global keyboard shortcuts (when the Monaco editor is not focused).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (target && target.closest('.monaco-editor')) return // editor handles its own keys
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'g' && !mod) {
        e.preventDefault()
        setView((v) => (v === 'editor' ? 'graph' : 'editor'))
      } else if (e.key === 'Escape') {
        setExitFilter(null)
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        goNext()
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        goPrev()
      } else if (mod && e.shiftKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        goBack()
      } else if (mod && e.shiftKey && e.key === 'ArrowRight') {
        e.preventDefault()
        goForward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev, goBack, goForward])

  // Panel resize drag
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = panelResizeRef.current
      if (!r) return
      const w = Math.min(520, Math.max(180, r.startW + (e.clientX - r.startX)))
      setPanelWidth(w)
    }
    const onUp = () => {
      panelResizeRef.current = null
      document.body.style.cursor = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (error) {
    return (
      <div className="ws-error">
        <p>Could not load flow: {error}</p>
        <Link to="/">← Back to flows</Link>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="ws-loading">
        <span className="spinner" /> Loading flow…
      </div>
    )
  }

  const activeNode = activeNodeId ? byId.get(activeNodeId) ?? null : null

  return (
    <div className="workspace">
      <FlowHeader
        detail={detail}
        view={view}
        query={query}
        onQuery={setQuery}
        onView={setView}
        onToggleFavorite={() =>
          api.patchFlow(flowId, { isFavorite: !detail.flow.isFavorite }).then((updated) => setDetail({ ...detail, flow: updated }))
        }
      />
      <PathStrip
        detail={detail}
        activeNodeId={activeNodeId}
        dimmedIds={dimmedIds}
        exitFilter={exitFilter}
        onNavigateNode={(id) => navigate(id)}
        onToggleExit={toggleExit}
      />
      <div className="ws-body">
        {panelOpen ? (
          <>
            <aside className="ws-navigator" style={{ width: panelWidth }}>
              <div className="nav-toolbar">
                <span className="nav-toolbar-title">Navigator</span>
                <span className="nav-toolbar-count">{path.length} steps · {detail.files.length} files</span>
                <button className="nav-collapse" title="Collapse panel" onClick={() => setPanelOpen(false)}>
                  ⇤
                </button>
              </div>
              <div className="nav-scroll">
                <Navigator
                  detail={detail}
                  activeNodeId={activeNodeId}
                  dimmedIds={dimmedIds}
                  query={query}
                  onNavigateNode={(id) => navigate(id)}
                />
              </div>
            </aside>
            <div
              className="ws-resizer"
              onMouseDown={(e) => {
                panelResizeRef.current = { startX: e.clientX, startW: panelWidth }
                document.body.style.cursor = 'col-resize'
              }}
            />
          </>
        ) : (
          <button className="ws-panel-expand" title="Show navigator" onClick={() => setPanelOpen(true)}>
            ⇥
          </button>
        )}
        <main className="ws-main">
          {view === 'editor' ? (
            <SourceView
              detail={detail}
              activeNode={activeNode}
              activeFileId={activeFileId}
              tabs={tabs}
              dimmedIds={dimmedIds}
              revealToken={revealToken}
              onNavigateNode={(id) => navigate(id)}
              onBack={goBack}
              onForward={goForward}
              onNext={goNext}
              onPrev={goPrev}
              onFileSelect={fileSelect}
              onFileClose={fileClose}
              onScrollLine={(l) => {
                scrollLineRef.current = l
              }}
            />
          ) : (
            <GraphView
              detail={detail}
              activeNodeId={activeNodeId}
              dimmedIds={dimmedIds}
              onNodeClick={(id) => navigate(id, { view: 'editor' })}
            />
          )}
        </main>
      </div>
      <StatusLine
        detail={detail}
        activeNodeId={activeNodeId}
        activeFileId={activeFileId}
        view={view}
        exitFilter={exitFilter}
        onClearExitFilter={() => setExitFilter(null)}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />
    </div>
  )
}
