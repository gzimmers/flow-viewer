import { useCallback, useEffect, useMemo, useRef } from 'react'
import { monaco } from '../monaco-setup'
import type { FlowDetail, FlowFile, FlowNode } from '../types'
import { basename, dirName, filesById } from '../lib/flow'
import { buildDecorations, inLink, monacoLanguageFor, type FlowLink } from '../lib/decorations'

interface SourceViewProps {
  detail: FlowDetail
  activeNode: FlowNode | null
  activeFileId: string | null
  tabs: string[]
  dimmedIds: Set<string> | null
  revealToken: number
  onNavigateNode: (nodeId: string) => void
  onBack: () => void
  onForward: () => void
  onNext: () => void
  onPrev: () => void
  onFileSelect: (fileId: string) => void
  onFileClose: (fileId: string) => void
  onScrollLine: (line: number | null) => void
}

function themeName(): string {
  return document.documentElement.dataset.theme === 'light' ? 'flow-light' : 'flow-dark'
}

/** Compact entry-point card: protocol, handler, request model, possible exits. */
function EntryInfo({ node, detail }: { node: FlowNode; detail: FlowDetail }) {
  const m = (node.meta ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (m.protocol === 'http' && m.method && m.path) parts.push(`${m.method} ${m.path}`)
  else if (m.protocol === 'kafka' && m.topic) parts.push(`kafka: ${m.topic}`)
  else if (m.protocol === 'process') parts.push('process start')
  else if (m.protocol === 'ui' && m.target) parts.push(`${m.event ?? 'click'} → ${m.target}`)
  if (m.handler) parts.push(m.handler as string)
  if (m.requestModel) parts.push(`body: ${m.requestModel as string}`)
  if (m.contentType) parts.push(m.contentType as string)
  const exits = detail.nodes
    .filter((n) => n.kind === 'exit' && n.exitLabel)
    .map((n) => n.exitLabel as string)
  const title = [
    ...parts,
    exits.length ? `Possible exits: ${exits.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <span className="entry-chip" title={title}>
      {parts.slice(0, 2).join(' · ')}
    </span>
  )
}

export function SourceView(props: SourceViewProps) {
  const { detail, activeNode, activeFileId, tabs, dimmedIds, revealToken } = props
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map())
  const decosRef = useRef<string[]>([])
  const linksRef = useRef<FlowLink[]>([])

  // Keep latest callbacks in refs so the editor (created once) always calls fresh handlers.
  const cbRef = useRef(props)
  cbRef.current = props

  const files = useMemo(() => filesById(detail), [detail])

  const fileOrder = useMemo(() => {
    const firstStep = new Map<string, number>()
    for (const n of detail.nodes) {
      if (!n.fileId) continue
      const cur = firstStep.get(n.fileId)
      if (cur == null || n.sortOrder < cur) firstStep.set(n.fileId, n.sortOrder)
    }
    return [...firstStep.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
  }, [detail])

  // Create editor once.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const editor = monaco.editor.create(el, {
      model: null,
      theme: themeName(),
      readOnly: true,
      fontSize: 12.5,
      lineHeight: 19,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true, renderCharacters: false, maxColumn: 120 },
      glyphMargin: true,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderLineHighlight: 'all',
      overviewRulerLanes: 16,
      padding: { top: 8 },
      automaticLayout: true,
      cursorBlinking: 'smooth',
    })
    editorRef.current = editor

    editor.onDidScrollChange(() => {
      const ranges = editor.getVisibleRanges()
      cbRef.current.onScrollLine(ranges.length ? ranges[0].startLineNumber : null)
    })

    editor.onMouseDown((e) => {
      const link = inLink(e.target.position, linksRef.current)
      if (link) {
        e.event.preventDefault()
        cbRef.current.onNavigateNode(link.nodeId)
      }
    })

    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => cbRef.current.onNext())
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => cbRef.current.onPrev())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.LeftArrow, () => cbRef.current.onBack())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.RightArrow, () => cbRef.current.onForward())

    const onTheme = () => monaco.editor.setTheme(themeName())
    document.addEventListener('flow-theme-change', onTheme)
    return () => {
      document.removeEventListener('flow-theme-change', onTheme)
      decosRef.current = []
      for (const m of modelsRef.current.values()) m.dispose()
      modelsRef.current.clear()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  const getOrCreateModel = useCallback((file: FlowFile): monaco.editor.ITextModel => {
    let model = modelsRef.current.get(file.id)
    if (!model) {
      model = monaco.editor.createModel(
        file.content,
        monacoLanguageFor(file.language),
        monaco.Uri.parse(`inmemory://flow/${encodeURIComponent(file.path)}`),
      )
      modelsRef.current.set(file.id, model)
    }
    return model
  }, [])

  // Switch model when active file changes.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const file = activeFileId ? files.get(activeFileId) : null
    if (!file) {
      editor.setModel(null)
      return
    }
    const model = getOrCreateModel(file)
    if (editor.getModel() !== model) editor.setModel(model)
  }, [activeFileId, files, getOrCreateModel])

  // Re-sync decorations.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeFileId) {
      linksRef.current = []
      return
    }
    const file = files.get(activeFileId)
    if (!file) return
    const nodeLabel = (n: FlowNode) =>
      `${n.kind === 'exit' ? 'Exit' : n.kind === 'entry' ? 'Entry' : 'Step'} ${n.sortOrder} · ${n.label}`
    const { decorations, links } = buildDecorations(file, detail.nodes, activeNode, dimmedIds, detail.edges, nodeLabel)
    linksRef.current = links
    decosRef.current = editor.deltaDecorations(decosRef.current, decorations)
  }, [activeFileId, activeNode, dimmedIds, detail, files])

  // Reveal the active region on navigation.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !activeNode || revealToken === 0) return
    if (activeNode.fileId !== activeFileId || activeNode.startLine == null) return
    const line = activeNode.startLine
    editor.revealLineInCenter(line)
    editor.setPosition({ lineNumber: line, column: 1 })
  }, [revealToken, activeNode, activeFileId])

  const activeFile = activeFileId ? files.get(activeFileId) ?? null : null
  const fileIdx = activeFileId ? fileOrder.indexOf(activeFileId) : -1
  const prevFileId = fileIdx > 0 ? fileOrder[fileIdx - 1] : null
  const nextFileId = fileIdx >= 0 && fileIdx < fileOrder.length - 1 ? fileOrder[fileIdx + 1] : null

  const firstNodeOf = (fileId: string | null) => {
    if (!fileId) return null
    const n = detail.nodes.filter((x) => x.fileId === fileId).sort((a, b) => a.sortOrder - b.sortOrder)[0]
    return n ?? null
  }

  const repo = detail.flow.repository?.name ?? 'repository'
  const branch = detail.flow.branch ?? detail.flow.repository?.branch ?? 'main'

  return (
    <div className="source-view">
      <div className="file-tabs" role="tablist">
        {tabs.map((id) => {
          const f = files.get(id)
          if (!f) return null
          return (
            <div
              key={id}
              role="tab"
              aria-selected={id === activeFileId}
              className={`file-tab ${id === activeFileId ? 'active' : ''}`}
              title={f.path}
              onClick={() => props.onFileSelect(id)}
            >
              <span className="file-tab-dot" data-lang={f.language} />
              <span className="file-tab-name">{basename(f.path)}</span>
              <button
                className="file-tab-close"
                title="Close file"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onFileClose(id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      <div className="breadcrumb-bar">
        <button
          className="crumb-btn"
          disabled={!prevFileId}
          title={prevFileId ? `Previous flow file: ${files.get(prevFileId)?.path}` : 'No previous flow file'}
          onClick={() => {
            const n = firstNodeOf(prevFileId)
            if (n) props.onNavigateNode(n.id)
          }}
        >
          ← <span className="crumb-file">{prevFileId ? basename(files.get(prevFileId)!.path) : '···'}</span>
        </button>
        <span className="crumb-path" title={`${repo}:${branch}/${activeFile?.path ?? ''}`}>
          <span className="crumb-repo">
            {repo}:{branch}
          </span>
          {activeFile && <span className="crumb-sep">/</span>}
          {activeFile && <span className="crumb-dir">{dirName(activeFile.path).replace(/^src\/main\/java\//, '')}</span>}
          {activeFile && <span className="crumb-file">{basename(activeFile.path)}</span>}
        </span>
        <button
          className="crumb-btn"
          disabled={!nextFileId}
          title={nextFileId ? `Next flow file: ${files.get(nextFileId)?.path}` : 'No next flow file'}
          onClick={() => {
            const n = firstNodeOf(nextFileId)
            if (n) props.onNavigateNode(n.id)
          }}
        >
          <span className="crumb-file">{nextFileId ? basename(files.get(nextFileId)!.path) : '···'}</span> →
        </button>
        {activeNode && activeNode.startLine != null && (
          <span className="region-chip" title="Selected flow region">
            {activeNode.startLine}–{activeNode.endLine}
          </span>
        )}
        {activeNode?.kind === 'entry' && <EntryInfo node={activeNode} detail={detail} />}
        {activeNode?.kind === 'exit' && (
          <span className="region-chip exit" title="Flow exit">
            {activeNode.exitLabel ?? activeNode.exitStatus ?? 'exit'}
          </span>
        )}
        <span className="crumb-spacer" />
        <span className="crumb-hint">
          <kbd>Alt</kbd>+<kbd>↓/↑</kbd> region · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>←/→</kbd> back/fwd
        </span>
      </div>

      <div className="monaco-container" ref={containerRef} />

      {!activeFile && (
        <div className="source-empty">
          <p>No file open.</p>
          <p className="dim">Select a step in the navigator or path strip to open its complete source file.</p>
        </div>
      )}
    </div>
  )
}
