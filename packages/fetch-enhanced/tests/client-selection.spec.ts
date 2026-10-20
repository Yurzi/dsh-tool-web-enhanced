// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { FetchSelectionView as SelectionView } from '../src/contract.ts'
import { FetchSelectionStore, type FetchConnectionsRemote } from '../src/client/selection.ts'

const view = (connectionId: string | null, revision: number): SelectionView => ({
  selection: { connectionId, options: {}, revision }, source: 'session',
  connections: [{ id: 'builtin:local', label: 'Local HTTP', kind: 'local', remote: false, access: 'keyless', status: 'ready' }],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

function fixture() {
  let current = view('builtin:local', 1)
  const remote = {
    get: vi.fn(async () => ({ ok: true as const, value: current })),
    set: vi.fn(async (request: { connectionId?: string | null; expectedRevision: number }) => {
      if (request.expectedRevision !== current.selection.revision) {
        return { ok: false as const, error: new RemoteError('fetchConnections/conflict', 'stale revision', {}) }
      }
      current = view(request.connectionId ?? null, current.selection.revision + 1)
      return { ok: true as const, value: current }
    }),
  }
  const selections = new FetchSelectionStore(remote as unknown as FetchConnectionsRemote)
  return { remote, selections, bump: (next: SelectionView) => { current = next } }
}

describe('FetchSelectionStore', () => {
  it('shares one read per session between concurrent views and serves the cache afterwards', async () => {
    const { remote, selections } = fixture()
    await Promise.all([selections.load('s1', 'p/m'), selections.load('s1', 'p/m')])
    await selections.load('s1', 'p/m')
    expect(remote.get).toHaveBeenCalledOnce()
    expect(selections.source('s1').getSnapshot().view?.selection.connectionId).toBe('builtin:local')
    expect(selections.source('s1')).toBe(selections.source('s1'))
  })

  it('reads again when the session model changes', async () => {
    const { remote, selections } = fixture()
    await selections.load('s1', 'p/a')
    await selections.load('s1', 'p/b')
    expect(remote.get).toHaveBeenCalledTimes(2)
  })

  it('writes against the shown revision and publishes the confirmed view to every observer', async () => {
    const { remote, selections } = fixture()
    await selections.load('s1')
    const seen = vi.fn()
    selections.source('s1').subscribe(seen)
    await expect(selections.set('s1', { connectionId: null })).resolves.toEqual({ ok: true })
    expect(remote.set).toHaveBeenCalledWith({ sessionId: 's1', connectionId: null, expectedRevision: 1 })
    expect(selections.source('s1').getSnapshot()).toMatchObject({ saving: false, view: { selection: { connectionId: null, revision: 2 } } })
    expect(seen).toHaveBeenCalled()
    expect(remote.get).toHaveBeenCalledOnce()
  })

  it('rereads after a refused write so views show what the Host holds', async () => {
    const { remote, selections, bump } = fixture()
    await selections.load('s1')
    bump(view('builtin:local', 5))
    const result = await selections.set('s1', { connectionId: null })
    expect(!result.ok && result.error.code).toBe('fetchConnections/conflict')
    expect(selections.source('s1').getSnapshot().view?.selection.revision).toBe(5)
    expect(remote.get).toHaveBeenCalledTimes(2)
  })

  it('invalidation rereads observed sessions now and the others on their next load', async () => {
    const { remote, selections } = fixture()
    await selections.load('watched')
    await selections.load('idle')
    const stop = selections.source('watched').subscribe(() => {})
    selections.invalidate()
    await selections.load('watched')
    expect(remote.get).toHaveBeenCalledTimes(3)
    expect(remote.get).toHaveBeenLastCalledWith({ sessionId: 'watched' })
    await selections.load('idle')
    expect(remote.get).toHaveBeenCalledTimes(4)
    stop()
  })

  it('never publishes a read that a newer event outdated', async () => {
    const { remote, selections, bump } = fixture()
    const late = deferred<{ ok: true; value: SelectionView }>()
    remote.get.mockImplementationOnce(() => late.promise)
    const loading = selections.load('s1')
    selections.invalidate()
    bump(view(null, 9))
    late.resolve({ ok: true, value: view('builtin:local', 1) })
    await loading
    expect(selections.source('s1').getSnapshot().view?.selection).toMatchObject({ connectionId: null, revision: 9 })
  })

  it('clears saving while propagating a transport rejection', async () => {
    const { remote, selections } = fixture()
    await selections.load('s1')
    remote.set.mockRejectedValueOnce(new Error('transport disconnected'))
    await expect(selections.set('s1', { connectionId: null })).rejects.toThrow('transport disconnected')
    expect(selections.source('s1').getSnapshot().saving).toBe(false)
    await selections.load('s1')
    expect(remote.get).toHaveBeenCalledTimes(2)
  })

  it('does not let a read started before a write replace the confirmed revision', async () => {
    const { remote, selections } = fixture()
    await selections.load('s1')
    const late = deferred<{ ok: true; value: SelectionView }>()
    remote.get.mockImplementationOnce(() => late.promise)
    const loading = selections.refresh('s1')
    await selections.set('s1', { connectionId: null })
    late.resolve({ ok: true, value: view('builtin:local', 1) })
    await loading
    expect(selections.source('s1').getSnapshot().view?.selection).toMatchObject({ connectionId: null, revision: 2 })
  })

  it('does not lose invalidation arriving while an unobserved session writes', async () => {
    const { remote, selections, bump } = fixture()
    await selections.load('s1')
    const writing = deferred<{ ok: true; value: SelectionView }>()
    remote.set.mockImplementationOnce(() => writing.promise)
    const saved = selections.set('s1', { connectionId: null })
    selections.invalidate()
    bump(view(null, 6))
    writing.resolve({ ok: true, value: view(null, 2) })
    await saved
    await selections.load('s1')
    expect(selections.source('s1').getSnapshot().view?.selection.revision).toBe(6)
  })

  it('keeps the last view and reports a failed read', async () => {
    const { remote, selections } = fixture()
    await selections.load('s1')
    remote.get.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'Host unreachable', {}) } as never)
    await selections.refresh('s1')
    expect(selections.source('s1').getSnapshot()).toMatchObject({ readFailure: 'failed', view: { selection: { revision: 1 } } })
  })
})
