import type { RemoteResult, TypertRemoteMap, TypertRemoteNamespaceMap } from '@deepseek-ai/dsh-typert-protocol'
import type { Auth } from 'dsh-tool-web-enhanced-core/host'
import type { SearchDeps } from '../src/search/execute.ts'
import { SEARCH, type PairingsView } from 'dsh-tool-web-enhanced-core/shared'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { contract, searchOptions, type SearchConnectionView, type SearchSelectionChange, type SearchSelectionView } from '../src/contract.ts'

const view: SearchSelectionView = {
  selection: { connectionId: null, revision: 0, options: { freshness: 'auto' } },
  source: 'default', connections: [],
}
const connection: SearchConnectionView = {
  id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true,
  access: 'keyless', status: 'ready', freshness: false,
}

describe('search Remote contract', () => {
  it('keeps account authentication owned exclusively by native backends', () => {
    expectTypeOf<Auth>().extract<{ kind: 'account' }>().toEqualTypeOf<never>()
    expectTypeOf<SearchDeps>().not.toHaveProperty('accountToken')
  })
  it('has strict capability options', () => {
    for (const freshness of ['auto', 'fresh', 'realtime']) expect(searchOptions.safeParse({ freshness }).success).toBe(true)
    for (const options of [{}, { freshness: 'hourly' }, { freshness: 'auto', secret: 'no' }]) expect(searchOptions.safeParse(options).success).toBe(false)
    expect(searchOptions.partial().parse({})).toEqual({})
  })

  it('puts session options and selection provenance on the shared view', () => {
    expect(contract.selectionView.parse({ ...view, connections: [connection] })).toEqual({ ...view, connections: [connection] })
    for (const source of ['session', 'inherited', 'model', 'default']) expect(contract.selectionView.safeParse({ ...view, source }).success).toBe(true)
    expect(contract.selectionView.safeParse({ ...view, source: 'unknown' }).success).toBe(false)
    expect(contract.selectionView.safeParse({ ...view, freshness: 'auto' }).success).toBe(false)
    expect(contract.selectionView.safeParse({ ...view, selection: { connectionId: null, revision: 0, freshness: 'auto' } }).success).toBe(false)
    expect(contract.connectionView.safeParse({ ...connection, credential: 'secret' }).success).toBe(false)
  })

  it('requires a meaningful revision-checked change and supports off', () => {
    const change: SearchSelectionChange = { sessionId: 'session', connectionId: null, expectedRevision: 1 }
    expect(contract.selectionChange.parse(change)).toEqual(change)
    expect(contract.selectionChange.parse({ sessionId: 'session', options: { freshness: 'fresh' }, expectedRevision: 0 })).toHaveProperty('options.freshness', 'fresh')
    for (const invalid of [
      { sessionId: 'session', expectedRevision: 0 },
      { sessionId: 'session', connectionId: null, expectedRevision: -1 },
      { sessionId: 'session', connectionId: null, expectedRevision: 0.5 },
      { sessionId: '', connectionId: null, expectedRevision: 0 },
      { sessionId: 'session', connectionId: null },
      { sessionId: 'session', connectionId: null, freshness: 'auto', expectedRevision: 0 },
    ]) expect(contract.selectionChange.safeParse(invalid).success).toBe(false)
  })

  it('mounts all five namespaced direct methods for the shared package identity', () => {
    expect(contract.namespace).toBe('searchConnections')
    expect(Object.keys(contract.remoteInfo.methods)).toEqual(['searchConnections/get', 'searchConnections/set', 'searchConnections/provider', 'searchConnections/pairings', 'searchConnections/forgetPairing'])
    expect(contract.remoteInfo).toMatchObject({ package: SEARCH.packageName })
    const get = contract.remoteInfo.methods['searchConnections/get']!
    expect(get.invocation).toEqual({ kind: 'direct' })
    expect(get.result.create().parse(view)).toEqual(view)
    const set = contract.remoteInfo.methods['searchConnections/set']!
    expect(set.input({ strict: true }).create().parse({ request: { sessionId: 'session', connectionId: null, expectedRevision: 0 } })).toEqual({ request: { sessionId: 'session', connectionId: null, expectedRevision: 0 } })
  })

  it('merges the mapped Remote methods into the native protocol types', () => {
    expectTypeOf<ReturnType<TypertRemoteMap['searchConnections/get']>>().toEqualTypeOf<Promise<RemoteResult<SearchSelectionView>>>()
    expectTypeOf<ReturnType<TypertRemoteMap['searchConnections/pairings']>>().toEqualTypeOf<Promise<RemoteResult<PairingsView>>>()
    expectTypeOf<TypertRemoteNamespaceMap['searchConnections']>().toHaveProperty('get')
  })
})
