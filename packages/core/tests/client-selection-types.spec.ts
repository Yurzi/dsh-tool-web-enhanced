// @vitest-environment jsdom
import { expect, it } from 'vitest'
import type { z } from 'zod'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { selectionContract } from '../src/shared/selection.ts'
import { ConnectionSelectionStore } from '../src/client/selection.ts'
import type { SelectionStore } from '../src/client/section.ts'

const emptyContract = selectionContract({ namespace: 'emptyConnections', packageName: 'empty-capability', options: {}, extras: {} })
type EmptyView = z.infer<typeof emptyContract.selectionView>
type EmptyChange = z.infer<typeof emptyContract.selectionChange>

it('accepts a strict empty-options capability remote without casting and retains the UI seam', async () => {
  let view: EmptyView = { selection: { connectionId: 'builtin:local', revision: 0, options: {} }, source: 'default', connections: [] }
  const remote = {
    get: async (): Promise<RemoteResult<EmptyView>> => ({ ok: true, value: view }),
    set: async (request: EmptyChange): Promise<RemoteResult<EmptyView>> => {
      const parsed = emptyContract.selectionChange.safeParse(request)
      if (!parsed.success) return { ok: false, error: new RemoteError('gateway/bad-request', 'Invalid selection', {}) }
      view = { ...view, source: 'session', selection: { ...view.selection,
        connectionId: parsed.data.connectionId === undefined ? view.selection.connectionId : parsed.data.connectionId,
        revision: view.selection.revision + 1,
      } }
      return { ok: true, value: view }
    },
  }
  // This is the consumer constructor that failed under exactOptionalPropertyTypes.
  const store = new ConnectionSelectionStore<EmptyView>(remote)
  const ui: SelectionStore = store
  await store.load('session')
  expect(await ui.set('session', { connectionId: null })).toEqual({ ok: true })
  expect(store.source('session').getSnapshot().view?.selection).toEqual({ connectionId: null, revision: 1, options: {} })
  // A capability-erased UI caller still goes through the Remote schema guard.
  const result = await ui.set('session', { options: { freshness: 'fresh' } })
  expect(result.ok).toBe(false)
  expect(!result.ok && result.error.code).toBe('gateway/bad-request')
  expect(store.source('session').getSnapshot().view?.selection.revision).toBe(1)
})
