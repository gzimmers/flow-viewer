// Region helpers: locate a function/method's line span by anchor, including
// its doc comment and decorators.
//
// Works for brace languages (Java, TS, Go, C…) and braceless languages
// (Python, Ruby): the block ends at the first non-noise line whose
// indentation does not exceed the signature's indentation. When that line is
// a closing brace (possibly followed by `)`, `,`, `[`, `]`), it is included.

export interface Region {
  start: number // 1-based inclusive
  end: number // 1-based inclusive
}

function indentOf(line: string): string {
  return line.match(/^\s*/)![0]
}

function isNoise(line: string): boolean {
  const t = line.trim()
  return (
    t === '' ||
    t.startsWith('#') ||
    t.startsWith('//') ||
    t.startsWith('*') ||
    t.startsWith('/*') ||
    t.startsWith('*/') ||
    t.startsWith('--') ||
    t.startsWith(';;')
  )
}

/**
 * Find the line span of a function/method starting at the line containing
 * `startAnchor`. The span is extended upwards to include a contiguous doc
 * comment and any decorators, and ends per the rules above — unless
 * `endAnchor` is given, in which case the span ends at the first line
 * containing `endAnchor` after the start.
 */
export function regionOf(content: string, startAnchor: string, endAnchor?: string): Region {
  const lines = content.split('\n')
  const si = lines.findIndex((l) => l.includes(startAnchor))
  if (si < 0) throw new Error(`start anchor not found: ${startAnchor}`)

  const indent = indentOf(lines[si])

  // Extend upwards over decorators and contiguous doc comments.
  let start = si
  while (start > 0 && /^\s*@/.test(lines[start - 1])) start--
  if (start > 0 && (lines[start - 1].includes('/**') || /^\s*\*/.test(lines[start - 1]))) {
    let j = start - 1
    while (j >= 0 && !lines[j].includes('/**')) j--
    start = Math.max(j, 0)
  }
  if (start > 0 && /^\s*#/.test(lines[start - 1])) {
    let j = start - 1
    while (j >= 0 && /^\s*#/.test(lines[j])) j--
    start = Math.max(j + 1, 0)
  }

  let end: number
  if (endAnchor) {
    const ei = lines.findIndex((l, i) => i > si && l.includes(endAnchor))
    if (ei < 0) throw new Error(`end anchor not found: ${endAnchor}`)
    end = ei + 1
  } else {
    const braceClose = new RegExp(`^${indent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}\\s*[),\\[\\]]*\\s*$`)
    end = -1
    for (let i = si + 1; i < lines.length; i++) {
      if (isNoise(lines[i])) continue
      if (indentOf(lines[i]).length <= indent.length) {
        end = braceClose.test(lines[i]) ? i + 1 : i
        break
      }
    }
    if (end < 0) end = lines.length
  }
  return { start: start + 1, end }
}

/** Region from a line anchor to the final closing brace of the file (class-level). */
export function classRegionOf(content: string, anchor: string): Region {
  const lines = content.split('\n')
  const si = lines.findIndex((l) => l.includes(anchor))
  if (si < 0) throw new Error(`class anchor not found: ${anchor}`)
  let end = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '}') {
      end = i + 1
      break
    }
  }
  if (end <= si) throw new Error(`class close not found for anchor: ${anchor}`)
  return { start: si + 1, end }
}

/** 1-based line number of the first line containing the needle. */
export function lineOf(content: string, needle: string): number {
  const i = content.split('\n').findIndex((l) => l.includes(needle))
  if (i < 0) throw new Error(`line anchor not found: ${needle}`)
  return i + 1
}
