// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionsRemoteErrors, SelectionView } from '../src/shared/selection.ts'
import { ConnectionSelectionStore } from '../src/client/selection.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap extends ConnectionsRemoteErrors<'coreConnections'> {}
}

const view: SelectionView = {
  selection: { connectionId: 'builtin:local', revision: 1, options: {} }, source: 'default', connections: [],
}

describe('selection read failure classification', () => {
  it.each(['coreConnections/invalid-settings', 'gateway/internal'] as const)('distinguishes %s, retains the last view and clears the failure on read recovery', async code => {
    let result: RemoteResult<SelectionView> = { ok: true, value: view }
    const store = new ConnectionSelectionStore({ get: async () => result, set: async () => ({ ok: true, value: view }) })
    expect(store.source('session').getSnapshot()).toEqual({ view: undefined, saving: false, readFailure: undefined })
    await store.load('session')
    result = { ok: false, error: new RemoteError(code, 'safe failure', {}) }
    await store.refresh('session')
    expect(store.source('session').getSnapshot()).toEqual({
      view, saving: false, readFailure: code === 'coreConnections/invalid-settings' ? 'invalid-settings' : 'failed',
    })
    result = { ok: true, value: view }
    await store.refresh('session')
    expect(store.source('session').getSnapshot()).toEqual({ view, saving: false, readFailure: undefined })
  })

  it('clears invalid-settings after a confirmed write and classifies rereads after a rejected write', async () => {
    let result: RemoteResult<SelectionView> = { ok: true, value: view }
    let write: RemoteResult<SelectionView> = { ok: true, value: view }
    const store = new ConnectionSelectionStore({ get: async () => result, set: async () => write })
    await store.load('session')
    result = { ok: false, error: new RemoteError('coreConnections/invalid-settings', 'safe failure', {}) }
    await store.refresh('session')
    await store.set('session', { connectionId: null })
    expect(store.source('session').getSnapshot().readFailure).toBeUndefined()
    write = result
    await store.set('session', { connectionId: null })
    expect(store.source('session').getSnapshot().readFailure).toBe('invalid-settings')
  })
})

describe('a Session changed without the store', () => {
  interface Read { readonly sessionId: string; answer(value: SelectionView): void }

  it('reads only that Session again, once more past a read already in flight, and lazily when nothing shows it', async () => {
    const written: SelectionView = { ...view, source: 'session', selection: { connectionId: null, revision: 2, options: {} } }
    const reads: Read[] = []
    const waiting = new Map<number, (read: Read) => void>()
    const readAt = (index: number) => new Promise<Read>(resolve => {
      const read = reads[index]
      if (read === undefined) waiting.set(index, resolve)
      else resolve(read)
    })
    const store = new ConnectionSelectionStore<SelectionView>({
      get: ({ sessionId }) => new Promise(resolve => {
        const read: Read = { sessionId, answer: value => { resolve({ ok: true, value }) } }
        reads.push(read)
        waiting.get(reads.length - 1)?.(read)
      }),
      set: async () => ({ ok: true, value: written }),
    })
    const cold = store.load('cold')
    const first = await readAt(0)
    first.answer(view)
    await cold

    const source = store.source('shown')
    const shown: (SelectionView | undefined)[] = []
    const stop = source.subscribe(() => { shown.push(source.getSnapshot().view) })
    const loading = store.load('shown')
    const stale = await readAt(1)
    store.invalidateSession('shown')
    store.invalidateSession('cold')
    store.invalidateSession('never-read')
    expect(reads.map(read => read.sessionId)).toEqual(['cold', 'shown'])
    // The answer to the read in flight predates the change: it is never shown.
    stale.answer(view)
    const reread = await readAt(2)
    expect(reread.sessionId).toBe('shown')
    reread.answer(written)
    await loading
    expect(shown).toEqual([written])
    stop()

    expect(reads).toHaveLength(3)
    const coldReload = store.load('cold')
    const coldRead = await readAt(3)
    expect(coldRead.sessionId).toBe('cold')
    coldRead.answer(written)
    await coldReload
    expect(store.source('cold').getSnapshot().view).toEqual(written)
    expect(reads.map(read => read.sessionId)).not.toContain('never-read')
  })
})
