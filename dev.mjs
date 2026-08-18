#!/usr/bin/env node
// Runs server + web dev processes with prefixed, colored output.
import { spawn } from 'node:child_process'

const COLORS = {
  server: '\x1b[36m',
  web: '\x1b[35m',
}
const RESET = '\x1b[0m'
const DIM = '\x1b[2m'

function makeLogger(name) {
  let buf = ''
  const color = COLORS[name] ?? ''
  return (chunk) => {
    buf += String(chunk)
    let idx
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (line.length > 0) process.stdout.write(`${color}${DIM}${name}${RESET} ${line}\n`)
    }
  }
}

const procs = [
  { name: 'server', cmd: 'npm', args: ['run', 'dev', '--workspace', 'server'] },
  { name: 'web', cmd: 'npm', args: ['run', 'dev', '--workspace', 'web'] },
]

const children = procs.map((p) => {
  const log = makeLogger(p.name)
  const child = spawn(p.cmd, p.args, { cwd: process.cwd(), env: process.env })
  child.stdout.on('data', log)
  child.stderr.on('data', log)
  child.on('exit', (code) => {
    console.log(`${COLORS[p.name]}[${p.name}] exited with code ${code}${RESET}`)
    shutdown(code ?? 0)
  })
  return child
})

let exiting = false
function shutdown(code) {
  if (exiting) return
  exiting = true
  for (const c of children) c.kill('SIGTERM')
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
