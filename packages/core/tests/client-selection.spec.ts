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
