import type { Collection, FlowDetail, FlowSummary, Repository, TagCount } from './types'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path} -> ${res.status}`)
  return res.json() as Promise<T>
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = `${res.status}`
    try {
      const j = await res.json()
      if (j?.error) message = j.error
    } catch {
      // ignore
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface FlowListParams {
  q?: string
  type?: string
  repo?: string
  tag?: string
  view?: 'all' | 'favorites' | 'archived'
}

export const api = {
  listFlows(p: FlowListParams = {}): Promise<FlowSummary[]> {
    const sp = new URLSearchParams()
    if (p.q) sp.set('q', p.q)
    if (p.type) sp.set('type', p.type)
    if (p.repo) sp.set('repo', p.repo)
    if (p.tag) sp.set('tag', p.tag)
    if (p.view === 'favorites') sp.set('favorite', '1')
    if (p.view === 'archived') sp.set('archived', '1')
    const qs = sp.toString()
    return get(`/api/flows${qs ? `?${qs}` : ''}`)
  },
  getFlow(id: string, version?: number): Promise<FlowDetail> {
    return get(`/api/flows/${id}${version ? `?version=${version}` : ''}`)
  },
  patchFlow(id: string, body: Record<string, unknown>): Promise<FlowDetail['flow']> {
    return send('PATCH', `/api/flows/${id}`, body)
  },
  deleteFlow(id: string): Promise<void> {
    return send('DELETE', `/api/flows/${id}`)
  },
  publishFlow(payload: unknown): Promise<{ id: string; version: number }> {
    return send('POST', '/api/flows', payload)
  },
  collections(): Promise<Collection[]> {
    return get('/api/collections')
  },
  tags(): Promise<TagCount[]> {
    return get('/api/tags')
  },
  repositories(): Promise<Repository[]> {
    return get('/api/repositories')
  },
}
