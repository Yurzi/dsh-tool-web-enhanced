// @vitest-environment jsdom
/** Whether web_search reaches this plugin, judged the way ctx.web selects a provider. */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SEARCH, type ProviderView } from 'dsh-tool-web-enhanced-core/shared'
import type { SearchConnectionsRemote } from '../src/client/selection.ts'
import { SearchRouteStatus, type WebSelection } from '../src/client/route.ts'
import { CredentialStatus } from '../src/client/credentials.ts'
import { PairingsStatus } from '../src/client/pairings.ts'
import type { SearchSettings } from '../src/settings/types.ts'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'

function fixture(web: Partial<ConfigFormSnapshot<WebSelection>>, host: ProviderView = { providerId: SEARCH.providerId, envProvider: null }) {
  let snapshot = { status: 'ready', value: {}, base: {}, user: {}, revision: 1, writable: true, ...web } as ConfigFormSnapshot<WebSelection>
  const listeners = new Set<() => void>()
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  } as unknown as ConfigForm<WebSelection>
  const answer = { current: host }
  const reader = { provider: vi.fn(async () => ({ ok: true as const, value: answer.current })) }
  const status = new SearchRouteStatus(form)
  const detach = status.attach(reader as unknown as SearchConnectionsRemote)
  const editWeb = (value: WebSelection) => { snapshot = { ...snapshot, value }; for (const listener of listeners) listener() }
  const observe = () => status.source.subscribe(() => {})
  const route = () => status.source.getSnapshot()
  return { status, reader, answer, detach, editWeb, observe, route, listeners }
}

describe('search route on the settings page', () => {
  it('asks the Host only while the page observes it and follows web row edits', async () => {
    const h = fixture({ value: { searchProvider: SEARCH.providerId } })
    expect(h.reader.provider).not.toHaveBeenCalled()
    const stop = h.observe()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.editWeb({ searchProvider: 'deepseek-search-api' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'deepseek-search-api', providerId: SEARCH.providerId })
    h.editWeb({})
    expect(h.route()).toEqual({ kind: 'auto', providerId: SEARCH.providerId })
    stop()
    expect(h.listeners.size).toBe(0)
    h.status.refresh()
    expect(h.reader.provider).toHaveBeenCalledTimes(1)
  })

  it('lets the environment pick the provider only while the web row names none', async () => {
    const h = fixture({ value: {} }, { providerId: SEARCH.providerId, envProvider: SEARCH.providerId })
    h.observe()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.editWeb({ searchProvider: 'another' })
    expect(h.route()).toEqual({ kind: 'other', provider: 'another', providerId: SEARCH.providerId })
  })

  it('ignores late provider answers after detaching', async () => {
    const h = fixture({ value: { searchProvider: SEARCH.providerId } })
    let finish!: (value: { ok: true; value: ProviderView }) => void
    h.reader.provider.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const stop = h.observe()
    h.detach()
    finish({ ok: true, value: h.answer.current })
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'unknown' })
    stop()
  })

  it('rereads the Host after a refresh and says nothing it cannot judge', async () => {
    const h = fixture({ value: { searchProvider: SEARCH.providerId } }, { providerId: 'another', envProvider: null })
    h.observe()
    await Promise.resolve()
    expect(h.route()).toMatchObject({ kind: 'other' })
    h.answer.current = { providerId: SEARCH.providerId, envProvider: null }
    h.status.refresh()
    await Promise.resolve()
    expect(h.route()).toEqual({ kind: 'this' })
    h.detach()
    expect(h.route()).toEqual({ kind: 'unknown' })
    const unserved = fixture({ status: 'unavailable', value: undefined })
    unserved.observe()
    await Promise.resolve()
    expect(unserved.reader.provider).toHaveBeenCalled()
    expect(unserved.route()).toEqual({ kind: 'unknown' })
  })
})

describe('settings metadata sources', () => {
  it('leaves invalid configuration diagnostics to the page without querying credentials', () => {
    const describeCredentials = vi.fn(async () => ({ ok: true as const, value: {} }))
    const status = new CredentialStatus(() => ({ version: 2, providerId: 'old' } as SearchSettings), { describe: describeCredentials })
    const stop = status.source.subscribe(() => {})
    expect(status.source.getSnapshot()).toEqual({})
    expect(describeCredentials).not.toHaveBeenCalled()
    stop()
  })
  it('describes credential states only while observed and rejects superseded answers', async () => {
    let config: SearchSettings = { version: 2 }
    let finish!: (result: { ok: true; value: Record<string, { configured: boolean; writable: boolean }> }) => void
    const late = new Promise<{ ok: true; value: Record<string, { configured: boolean; writable: boolean }> }>(resolve => { finish = resolve })
    const describeCredentials = vi.fn(async (refs: string[]) => ({ ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: true, writable: true }])) }))
    describeCredentials.mockImplementationOnce(() => late)
    const status = new CredentialStatus(() => config, { describe: describeCredentials })
    status.refresh()
    expect(describeCredentials).not.toHaveBeenCalled()
    const stop = status.source.subscribe(() => {})
    config = { version: 2, connections: { 'builtin:exa': { credentialRef: 'NEW_KEY' } } }
    status.refresh()
    await Promise.resolve()
    expect(status.source.getSnapshot().NEW_KEY).toBe('configured')
    expect(status.source.getSnapshot().EXA_API_KEY).toBeUndefined()
    finish({ ok: true, value: { EXA_API_KEY: { configured: false, writable: true } } })
    await late
    expect(status.source.getSnapshot().NEW_KEY).toBe('configured')
    stop()
    status.refresh()
    expect(describeCredentials).toHaveBeenCalledTimes(2)
  })

  it('marks failed credential descriptions unknown without reading secret values', async () => {
    const describeCredentials = vi.fn(async () => ({ ok: false as const, error: new RemoteError('gateway/internal', 'private diagnostic', {}) }))
    const status = new CredentialStatus(() => ({ version: 2 }), { describe: describeCredentials })
    const stop = status.source.subscribe(() => {})
    await Promise.resolve()
    expect(status.source.getSnapshot()).toMatchObject({ EXA_API_KEY: 'unknown', DEEPSEEK_API_KEY: 'unknown' })
    stop()
  })

  it('distinguishes failed model-memory reads from an empty list', async () => {
    const remote = { pairings: vi.fn(async () => ({ ok: false as const, error: new RemoteError('gateway/internal', 'private diagnostic', {}) })) }
    const status = new PairingsStatus(remote as unknown as SearchConnectionsRemote, key => key)
    await status.refresh()
    expect(status.source.getSnapshot()).toEqual({ state: 'failed', message: 'private diagnostic' })
  })

  it('loads visible model memories and propagates refused forget operations', async () => {
    const pairings = [{ provider: 'p', model: 'm', connectionId: null }]
    const remote = {
      pairings: vi.fn(async () => ({ ok: true as const, value: { pairings } })),
      forgetPairing: vi.fn(async () => ({ ok: false as const, error: new RemoteError('gateway/internal', 'private diagnostic', {}) })),
    }
    const status = new PairingsStatus(remote as unknown as SearchConnectionsRemote, key => key)
    expect(remote.pairings).not.toHaveBeenCalled()
    const stop = status.source.subscribe(() => {})
    await status.refresh()
    expect(status.source.getSnapshot()).toEqual({ state: 'ready', pairings })
    await expect(status.forget('p', 'm')).rejects.toThrow('pairings.forgetFailed')
    stop()
    const reads = remote.pairings.mock.calls.length
    status.invalidate()
    expect(remote.pairings).toHaveBeenCalledTimes(reads)
  })
})
