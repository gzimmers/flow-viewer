// Region/decoration helpers for the Monaco source view.

import { monaco } from '../monaco-setup'
import type { FlowEdge, FlowFile, FlowNode } from '../types'
import { basename } from './flow'

export interface FlowLink {
  nodeId: string
  label: string
  range: monaco.IRange
}

export function rulerColor(kind: string, active: boolean, dimmed: boolean): string {
  if (dimmed) return 'rgba(120, 124, 132, 0.25)'
  if (active) return 'rgba(94, 158, 255, 0.95)'
  switch (kind) {
    case 'entry':
      return 'rgba(74, 222, 128, 0.8)'
    case 'exit':
      return 'rgba(251, 191, 36, 0.75)'
    case 'async':
      return 'rgba(192, 132, 252, 0.8)'
    case 'branch':
      return 'rgba(251, 146, 60, 0.8)'
    default:
      return 'rgba(120, 124, 132, 0.55)'
  }
}

/**
 * Build decorations for all flow regions in the given file plus flow-aware
 * source links for the active node.
 */
export function buildDecorations(
  file: FlowFile,
  nodes: FlowNode[],
  activeNode: FlowNode | null,
  dimmedIds: Set<string> | null,
  edges: FlowEdge[],
  nodeLabel: (n: FlowNode) => string,
): { decorations: monaco.editor.IModelDeltaDecoration[]; links: FlowLink[] } {
  const decorations: monaco.editor.IModelDeltaDecoration[] = []
  const links: FlowLink[] = []
  const lines = file.content.split('\n')

  for (const n of nodes) {
    if (n.fileId !== file.id || n.startLine == null || n.endLine == null) continue
    const isActive = activeNode?.id === n.id
    const dimmed = dimmedIds ? !dimmedIds.has(n.id) : false
    decorations.push({
      range: new monaco.Range(n.startLine, 1, n.endLine, 1),
      options: {
        isWholeLine: true,
        className: isActive
          ? dimmed
            ? 'flow-region-active flow-region-dim'
            : 'flow-region-active'
          : dimmed
            ? 'flow-region flow-region-dim'
            : 'flow-region',
        overviewRuler: {
          color: rulerColor(n.kind, isActive, dimmed),
          position: monaco.editor.OverviewRulerLane.Center,
        },
        hoverMessage: {
          value: `${nodeLabel(n)} · ${n.file?.path ?? ''}:${n.startLine}–${n.endLine}`,
        },
        linesDecorationsClassName: isActive ? 'flow-glyph flow-glyph-active' : 'flow-glyph',
        glyphMarginHoverMessage: {
          value: `Flow step ${n.sortOrder} · ${n.label}`,
        },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    })
  }

  // Flow-aware links: within the active region, mark calls that resolve to
  // another flow node (by symbol occurrence).
  if (activeNode && activeNode.startLine != null && activeNode.endLine != null) {
    const others = nodes.filter((n) => n.id !== activeNode.id && n.symbol && n.fileId != null)
    for (let ln = activeNode.startLine; ln <= activeNode.endLine && ln <= lines.length; ln++) {
      const text = lines[ln - 1] ?? ''
      for (const other of others) {
        const sym = other.symbol!
        let idx = text.indexOf(sym)
        while (idx >= 0) {
          // Require word-ish boundary so 'put' doesn't match 'compute'
          const before = idx === 0 ? '' : text[idx - 1]
          const after = idx + sym.length >= text.length ? '' : text[idx + sym.length]
          const wordChar = (c: string) => /[A-Za-z0-9_]/.test(c)
          if ((!wordChar(before) || before === '.') && !wordChar(after)) {
            const range = new monaco.Range(ln, idx + 1, ln, idx + sym.length + 1)
            decorations.push({
              range,
              options: {
                className: 'flow-link',
                hoverMessage: {
                  value: `→ Flow step ${other.sortOrder} · ${basename(other.file?.path ?? '')} ${other.label}`,
                },
                stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              },
            })
            links.push({
              nodeId: other.id,
              label: other.label,
              range,
            })
          }
          idx = text.indexOf(sym, idx + sym.length)
        }
      }
    }
  }

  return { decorations, links }
}

export function inLink(pos: monaco.Position | null, links: FlowLink[]): FlowLink | null {
  if (!pos) return null
  for (const l of links) {
    const r = l.range
    if (pos.lineNumber > r.startLineNumber || pos.lineNumber < r.endLineNumber) continue
    if (pos.lineNumber === r.startLineNumber && pos.column < r.startColumn) continue
    if (pos.lineNumber === r.endLineNumber && pos.column > r.endColumn) continue
    return l
  }
  return null
}

// Maps natural language names (as an agent would publish them) to Monaco
// language ids. Unknown values pass through unchanged: Monaco highlights
// whatever it knows and falls back to plain text for the rest, so flows in
// any language remain fully navigable.
const LANGUAGE_ALIASES: Record<string, string> = {
  java: 'java',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  javascript: 'javascript',
  py: 'python',
  python: 'python',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  rb: 'ruby',
  ruby: 'ruby',
  cs: 'csharp',
  'c#': 'csharp',
  csharp: 'csharp',
  c: 'cpp',
  cc: 'cpp',
  cpp: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  objcpp: 'objective-c',
  'objective-c': 'objective-c',
  objc: 'objective-c',
  swift: 'swift',
  kotlin: 'kotlin',
  php: 'php',
  scala: 'scala',
  ps: 'powershell',
  ps1: 'powershell',
  powershell: 'powershell',
  docker: 'dockerfile',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  pl: 'perl',
  perl: 'perl',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  ex: 'elixir',
  exs: 'elixir',
  elixir: 'elixir',
  fs: 'fsharp',
  fsharp: 'fsharp',
  julia: 'julia',
  vb: 'vb',
  ini: 'ini',
  toml: 'ini',
  hcl: 'hcl',
  tf: 'hcl',
  proto: 'protobuf',
  protobuf: 'protobuf',
  vue: 'html',
  htm: 'html',
  html: 'html',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  md: 'markdown',
  markdown: 'markdown',
}

export function monacoLanguageFor(language: string): string {
  const key = language.toLowerCase().trim()
  return LANGUAGE_ALIASES[key] ?? language
}
