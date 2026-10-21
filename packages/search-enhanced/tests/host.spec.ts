/** Real WebRuntime, Agents, Session Controller, Typert and JSON storage; only the network is mocked. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { MemoryCredentials } from './fixtures/credentials.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MODEL_SETTINGS_NS, modelServer, mountModelSettings } from './fixtures/model-host.ts'
import { remoteMethods, type PeerId, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WebRuntime from '@deepseek-ai/dsh-web'
import { SEARCH, type PairingsView, type ProviderView } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SearchSelectionView } from '../src/contract.ts'
import { installSearch } from '../src/host/runtime.ts'
import * as entry from '../src/index.ts'
import { currentRoute, routed } from './fixtures/core-host.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { SearchSettings } from '../src/settings/types.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const INITIAL: SearchSettings = { version: 2, defaultConnection: 'builtin:openalex' }

async function host(options: { storage?: boolean; root?: string; rawSettings?: Record<string, unknown>; settings?: SearchSettings; environment?: Record<string, string>; routes?: Record<string, unknown> } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'search-host-'))
  if (options.root === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: options.environment ?? {} }]))
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  if (options.routes !== undefined) await mountModelSettings(ctx, root, options.routes)
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  if (options.storage !== false) await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WebRuntime, { searchProvider: SEARCH.providerId })
  await ctx.plugin(TypertRegistry)
  void new Gateway(ctx, {})
  // This suite exercises no uploads. The public resolver registration is retained, not invoked.
  const uploadResolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    uploadResolvers.add(resolver)
    return () => { uploadResolvers.delete(resolver) }
  } } as never)
  const controller = new SessionController(ctx, { nativeOpen: false })
  let settings = resolveSettings(options.settings ?? INITIAL)
  const pluginDefinition = { inject: ['web'], apply: (scope: Context) => installSearch(scope, () => settings) }
  let plugin = options.rawSettings === undefined
    ? await ctx.plugin(pluginDefinition)
    : await ctx.plugin(entry, options.rawSettings)
  const remount = async () => {
    await plugin.dispose()
    plugin = await ctx.plugin(pluginDefinition)
    await ctx.fiber.await()
  }
  await ctx.fiber.await()
  expect(ctx.get('searchConnections')).toBeDefined()
  const add = async (id: string, extra: Omit<CreateAgentOptions, 'sessionId'> = {}) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), ...extra })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  const one = await add('one')
  const two = await add('two')
  const peer: PeerScope = { id: 'owner' as PeerId, ctx, principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} }
  const invoke = (method: string, request: Record<string, unknown> = {}) => ctx.typertGateway.invoke({ peer, namespace: 'searchConnections', method, args: { request } })
  const get = (agent = one) => invoke('get', { sessionId: agent.id }) as Promise<SearchSelectionView>
  const set = (change: Record<string, unknown>, agent = one) => invoke('set', { sessionId: agent.id, ...change }) as Promise<SearchSelectionView>
  const request = async (agent = one, step = 0) => {
    let continued = false
    await ctx.waterfall('agent/request', { agent, turn: 1, step, signal: new AbortController().signal } as never, (async () => { continued = true; return { provider: 'p', model: 'm' } }) as never)
    expect(continued).toBe(true)
  }
  const search = (agent = one) => ctx.agents.withInitiator(agent, () => ctx.web.search({ query: 'query' }))
  return { ctx, root, controller, one, two, add, invoke, get, set, request, search, remount, configure: (document: SearchSettings) => { settings = resolveSettings(document) } }
}

function network() {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url)
    return Response.json({ success: true, results: [{ id: 'https://openalex.org/W1', display_name: 'Result', doi: 'https://doi.org/10.1/test' }], data: { web: [{ url: 'https://example.org/result', title: 'Result', markdown: 'evidence' }] } })
  })
  return calls
}

const fixedModel = (endpoint: string) => ({ kind: 'model', label: 'Fixed model', protocol: 'anthropic-messages', model: 'fixed-search', endpoint, credentialRef: 'FIXED_KEY', trustedEndpoint: true } as const)

function registerRoute(ctx: Context, provider = 'fixture') {
  return ctx.llm.registerConfigurableProviders([{ provider, displayName: provider, settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', provider] }])
}

describe('searchConnections model Host', () => {
  it('shows no-model and unknown-route without changing the selected connection or Seat availability', async () => {
    const h = await host({ settings: { defaultConnection: 'builtin:session-model' } })
    expect((await h.get()).connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ status: 'unsupported', reason: 'no-model', freshness: false })
    await expect(h.ctx.web.search({ query: 'outside' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-search-enhanced: the session model cannot run web search: no session model is available; choose another search connection' })
    const agent = await h.add('unknown', { agentOptions: { provider: 'unknown', model: 'm' } })
    expect((await h.get(agent)).connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ status: 'unsupported', reason: 'unknown-route' })
    expect(await h.set({ connectionId: 'builtin:session-model', expectedRevision: 0 }, agent)).toMatchObject({ selection: { connectionId: 'builtin:session-model' } })
    agent.session.append('request/context', { provider: 'unknown', model: 'm' })
    await h.request(agent)
    await expect(h.search(agent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-search-enhanced: the session model cannot run web search: the model route is unknown; choose another search connection' })
    expect((await h.get(agent)).selection.connectionId).toBe('builtin:session-model')
  })

  it('describes fixed model Credentials readiness, never account or ambient fallback', async () => {
    const h = await host({ settings: { connections: { 'custom:fixed': fixedModel('https://fixture.test') } }, environment: { FIXED_KEY: 'ambient' } })
    const agent = await h.add('fixed-account', { agentOptions: { provider: 'deepseek-account', model: 'm' } })
    const fixed = async () => (await h.get(agent)).connections.find(connection => connection.id === 'custom:fixed')
    expect(await fixed()).toMatchObject({ access: 'api-key', status: 'needs-credential', freshness: false })
    const credentials = await h.ctx.plugin(MemoryCredentials)
    expect(await fixed()).toMatchObject({ status: 'needs-credential' })
    await h.ctx.credentials.set(credentialRef('FIXED_KEY'), 'stored')
    expect(await fixed()).toMatchObject({ access: 'api-key', status: 'ready' })
    await credentials.dispose()
    expect(await fixed()).toMatchObject({ access: 'api-key', status: 'needs-credential' })
  })

  it('describes session API-key readiness from the launch environment only without Credentials', async () => {
    const h = await host({ routes: { fixture: { api: 'anthropic-messages', baseURL: 'https://fixture.test', apiKeyEnv: 'ROUTE_KEY' } }, environment: { ROUTE_KEY: 'ambient' } })
    registerRoute(h.ctx)
    const agent = await h.add('route', { agentOptions: { provider: 'fixture', model: 'm' } })
    const session = async () => (await h.get(agent)).connections.find(connection => connection.id === 'builtin:session-model')
    expect(await session()).toMatchObject({ access: 'api-key', status: 'ready', freshness: false })
    await h.ctx.plugin(MemoryCredentials)
    expect(await session()).toMatchObject({ status: 'needs-credential' })
    await h.ctx.credentials.set(credentialRef('OTHER_KEY'), 'stored')
    await h.ctx.settings.replace(MODEL_SETTINGS_NS, { routes: { fixture: { api: 'anthropic-messages', baseURL: 'https://fixture.test', apiKeyEnv: 'OTHER_KEY' } } })
    expect(await session()).toMatchObject({ status: 'ready' })
    await h.ctx.credentials.unset(credentialRef('OTHER_KEY'))
    expect(await session()).toMatchObject({ status: 'needs-credential' })
  })

  it('keeps account readiness and authentication separate from API keys, pending models and outside calls', async () => {
    const api = await modelServer()
    cleanups.push(api.close)
    const h = await host({ routes: {
      'deepseek-account': { baseURL: api.url + '/account' },
      'deepseek-official': { baseURL: api.url + '/official' },
    }, settings: { defaultConnection: 'builtin:session-model' }, environment: { DEEPSEEK_API_KEY: 'must-not-be-used-for-account' } })
    registerRoute(h.ctx, 'deepseek-account')
    registerRoute(h.ctx, 'deepseek-official')
    const endpoints: string[] = []
    let token: string | undefined
    // External account credential boundary, as in the native-backend tests;
    // routing, Settings, Agent request metadata, transport and protocol are real.
    h.ctx.provide('deepseekAccount', { resolveToken: async (url: string) => { endpoints.push(url); return token } } as never)
    const agent = await h.add('account-model', { agentOptions: { provider: 'deepseek-account', model: 'account-search' } })
    const session = async () => (await h.get(agent)).connections.find(connection => connection.id === 'builtin:session-model')
    expect(await session()).toMatchObject({ access: 'account', status: 'needs-credential', freshness: false })
    token = 'account-token'
    expect(await session()).toMatchObject({ access: 'account', status: 'ready' })
    expect(endpoints).toContain(api.url + '/account/v1/messages')
    endpoints.length = 0
    await expect(h.search(agent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }) // no resolved request yet
    expect(endpoints).toEqual([])
    agent.session.append('request/context', { provider: 'deepseek-account', model: 'account-search' })
    await h.request(agent)
    await h.search(agent)
    expect(api.calls[0]).toMatchObject({ path: '/account/v1/messages', headers: { 'x-dsh-auth-token': 'account-token' }, body: { model: 'account-search', thinking: { type: 'disabled' }, tools: [{ type: 'web_search_20250305' }] } })
    expect(api.calls[0]!.headers['x-api-key']).toBeUndefined()
    token = undefined
    await expect(h.search(agent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(api.calls).toHaveLength(1)
    token = 'account-token'
    // Menu looks ahead to account, but the request is now the official key route.
    agent.session.append('request/header', { reason: 'change', header: { config: { provider: 'deepseek-official', model: 'key-search' } } })
    agent.session.append('request/context', { provider: 'deepseek-official', model: 'key-search' })
    agent.session.append('model/selection', { provider: 'deepseek-account', model: 'account-search' })
    expect(await session()).toMatchObject({ access: 'account', status: 'ready' })
    endpoints.length = 0
    await h.request(agent, 1)
    await h.search(agent)
    expect(api.calls[1]).toMatchObject({ path: '/official/v1/messages', headers: { 'x-api-key': 'must-not-be-used-for-account' }, body: { model: 'key-search' } })
    expect(api.calls[1]!.headers['x-dsh-auth-token']).toBeUndefined()
    await expect(h.ctx.web.search({ query: 'outside' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(endpoints).toEqual([])
  })

  it.each([
    [{}, 'protocol'],
    [{ api: 'anthropic-messages' }, 'endpoint'],
    [{ api: 'anthropic-messages', baseURL: 'https://fixture.test', headers: { secret: 'not-returned' } }, 'headers'],
    [{ api: 'anthropic-messages', baseURL: 'https://fixture.test' }, 'credential'],
  ])('exposes the closed reason %s and never raw route values', async (profile, reason) => {
    const h = await host({ routes: { fixture: profile }, settings: { defaultConnection: 'builtin:session-model' } })
    registerRoute(h.ctx)
    const agent = await h.add('unsupported', { agentOptions: { provider: 'fixture', model: 'm' } })
    expect((await h.get(agent)).connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ status: 'unsupported', reason, freshness: false })
    agent.session.append('request/context', { provider: 'fixture', model: 'm' })
    await h.request(agent)
    const failure = h.search(agent)
    const phrases: Record<string, string> = {
      protocol: 'the route does not declare a supported protocol',
      endpoint: 'the route has no supported endpoint',
      headers: 'the route uses custom request headers',
      credential: 'the route has no supported credential reference',
    }
    await expect(failure).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-search-enhanced: the session model cannot run web search: ' + phrases[reason] + '; choose another search connection' })
    await expect(failure).rejects.not.toThrow('not-returned')
  })

  it('runs fixed and following model searches over real Host and local HTTP, and rereads routes every call', async () => {
    const api = await modelServer()
    cleanups.push(api.close)
    const h = await host({ settings: { defaultConnection: 'custom:fixed', connections: { 'custom:fixed': fixedModel(api.url + '/fixed') } }, routes: { fixture: { api: 'anthropic-messages', baseURL: api.url + '/first', apiKeyEnv: 'FIRST_KEY' } }, environment: { FIRST_KEY: 'first-key', SECOND_KEY: 'second-key' } })
    registerRoute(h.ctx)
    await h.ctx.plugin(MemoryCredentials)
    await h.ctx.credentials.set(credentialRef('FIXED_KEY'), 'fixed-key')
    await h.ctx.credentials.set(credentialRef('FIRST_KEY'), 'first-key')
    await h.ctx.credentials.set(credentialRef('SECOND_KEY'), 'second-key')
    await expect(h.ctx.web.search({ query: 'fixed' })).resolves.toMatchObject({ content: '  fixture answer\n', sources: [{ url: 'https://example.org/result', title: 'Fixture source' }] })
    expect(api.calls[0]).toMatchObject({ path: '/fixed/v1/messages', headers: { 'x-api-key': 'fixed-key' }, body: { model: 'fixed-search', max_tokens: 4096, tools: [{ type: 'web_search_20260318', name: 'web_search', max_uses: 5 }] } })
    expect(api.calls[0]!.body.thinking).toBeUndefined()
    const agent = await h.add('follow', { agentOptions: { provider: 'fixture', model: 'session-search' } })
    await h.set({ connectionId: 'builtin:session-model', expectedRevision: 0 }, agent)
    agent.session.append('request/context', { provider: 'fixture', model: 'session-search' })
    await h.request(agent)
    await h.search(agent)
    await h.ctx.settings.replace(MODEL_SETTINGS_NS, { routes: { fixture: { api: 'anthropic-messages', baseURL: api.url + '/second', apiKeyEnv: 'SECOND_KEY' } } })
    await h.search(agent) // same request step, new operational route and matching key
    expect(api.calls.slice(1)).toMatchObject([
      { path: '/first/v1/messages', headers: { 'x-api-key': 'first-key' }, body: { model: 'session-search' } },
      { path: '/second/v1/messages', headers: { 'x-api-key': 'second-key' }, body: { model: 'session-search' } },
    ])
    expect(api.calls.every(call => call.headers.authorization === undefined && call.headers['x-dsh-auth-token'] === undefined)).toBe(true)
  })

  it.each(['anthropic-messages', 'openai-responses'] as const)('takes only %s options at the real session-model Host seam', async protocol => {
    const api = await modelServer()
    cleanups.push(api.close)
    const h = await host({ settings: { defaultConnection: 'builtin:session-model', connections: { 'builtin:session-model': { options: { maxUses: 2, searchContextSize: 'low' } } } }, routes: { fixture: { api: protocol, baseURL: api.url, apiKeyEnv: 'ROUTE_KEY' } }, environment: { ROUTE_KEY: 'key' } })
    registerRoute(h.ctx)
    const agent = await h.add('options', { agentOptions: { provider: 'fixture', model: 'search' } })
    agent.session.append('request/context', { provider: 'fixture', model: 'search' })
    await h.request(agent)
    await h.search(agent)
    const tool = (api.calls[0]!.body.tools as Record<string, unknown>[])[0]!
    if (protocol === 'anthropic-messages') {
      expect(tool.max_uses).toBe(2)
      expect(tool).not.toHaveProperty('search_context_size')
    } else {
      expect(tool.search_context_size).toBe('low')
      expect(tool).not.toHaveProperty('max_uses')
    }
  })

  it.each(['builtin:session-model', 'custom:fixed'])('rechecks disabled/enabled %s on every call, not every step', async connectionId => {
    const h = await host({ settings: { defaultConnection: connectionId, connections: { 'custom:fixed': fixedModel('https://unused.test') } } })
    await h.request()
    const document = { connections: { 'custom:fixed': fixedModel('https://unused.test'), [connectionId]: connectionId === 'custom:fixed' ? { ...fixedModel('https://unused.test'), disabled: true } : { disabled: true } } }
    h.configure(document)
    expect((await h.get()).connections.find(connection => connection.id === connectionId)).toMatchObject({ access: 'api-key', status: 'disabled', freshness: false })
    await expect(h.set({ connectionId, expectedRevision: 0 })).rejects.toMatchObject({ code: 'searchConnections/unavailable' })
    await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    h.configure({ connections: { 'custom:fixed': fixedModel('https://unused.test') } })
    expect(await h.set({ connectionId, expectedRevision: 0 })).toMatchObject({ selection: { connectionId } })
    await expect(h.search()).rejects.toMatchObject({ code: connectionId === 'custom:fixed' ? 'WEB_PROVIDER_CREDENTIAL_MISSING' : 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })
})

describe('searchConnections real Host', () => {
  it.each([{ version: 1 }, { unknownOption: true }, { connections: [] }])('keeps invalid settings %j active with a Seat repair instruction but does not expose plugin WebError messages through Remote', async rawSettings => {
    const h = await host({ rawSettings })
    let diagnostic = ''
    try { resolveSettings(rawSettings) } catch (error) { diagnostic = (error as Error).message }
    expect(diagnostic).not.toBe('')
    const failure = { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-search-enhanced: search settings are invalid; ask the user to fix them on the settings page' }
    await expect(h.search()).rejects.toMatchObject(failure)
    await expect(h.get()).rejects.toMatchObject({
      code: 'searchConnections/invalid-settings',
      message: 'the row settings are invalid; fix them on the settings page',
      details: {},
    })
    await h.request()
    await expect(h.search()).rejects.toMatchObject(failure)
  })

  it('gets, changes, queues competing revisions and authorizes the addressed Session', async () => {
    const h = await host()
    for (const method of ['get', 'set']) {
      const marker = remoteMethods(h.ctx.searchConnections).find(item => item.method === method)!
      const addressedSession = marker.resources!.session!
      expect(addressedSession({ sessionId: h.two.id })).toBe(h.two.id)
    }
    expect(await h.get()).toMatchObject({ selection: { connectionId: 'builtin:openalex', revision: 0, options: { freshness: 'auto' } }, source: 'default' })
    const results = await Promise.allSettled([
      h.set({ connectionId: 'builtin:firecrawl', expectedRevision: 0 }),
      h.set({ connectionId: null, expectedRevision: 0 }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'searchConnections/conflict' } }])
    expect(await h.get()).toMatchObject({ selection: { revision: 1 }, source: 'session' })
    expect((await h.get(h.two)).selection.revision).toBe(0)
    const child = await h.add('owned-child', { meta: { origin: 'subagent' } })
    await expect(h.get(child)).rejects.toMatchObject({ code: 'session/agent-busy' })
    await expect(h.set({ connectionId: null, expectedRevision: 0 }, child)).rejects.toMatchObject({ code: 'session/agent-busy' })
  })

  it('rejects unavailable connections and invalid options without incrementing revision', async () => {
    const h = await host()
    h.configure({ ...INITIAL, connections: { 'builtin:session-model': { disabled: true } } })
    for (const connectionId of ['custom:gone', 'builtin:session-model']) {
      await expect(h.set({ connectionId, expectedRevision: 0 })).rejects.toMatchObject({ code: 'searchConnections/unavailable' })
    }
    h.configure({ ...INITIAL, connections: { 'builtin:firecrawl': { disabled: true } } })
    await expect(h.set({ connectionId: 'builtin:firecrawl', expectedRevision: 0 })).rejects.toMatchObject({ code: 'searchConnections/unavailable' })
    await expect(h.set({ options: { freshness: 'hourly' }, expectedRevision: 0 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.set({ options: { extra: true }, expectedRevision: 0 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect((await h.get()).selection.revision).toBe(0)
    h.configure(INITIAL)
    expect(await h.set({ connectionId: 'builtin:session-model', expectedRevision: 0 })).toMatchObject({ selection: { connectionId: 'builtin:session-model', revision: 1 } })
  })

  it('remembers model choices including off, lists and clears memories, and reports the source', async () => {
    const h = await host()
    const writer = await h.add('writer', { agentOptions: { provider: 'p', model: 'm' } })
    await h.set({ connectionId: 'builtin:firecrawl', expectedRevision: 0 }, writer)
    const reader = await h.add('reader', { agentOptions: { provider: 'p', model: 'm' } })
    expect(await h.get(reader)).toMatchObject({ source: 'model', selection: { connectionId: 'builtin:firecrawl', revision: 0 } })
    expect(await h.invoke('pairings') as PairingsView).toEqual({ pairings: [{ provider: 'p', model: 'm', connectionId: 'builtin:firecrawl' }] })
    h.configure({ ...INITIAL, connections: { 'builtin:firecrawl': { disabled: true } } })
    expect(await h.get(reader)).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:openalex' } })
    await h.set({ connectionId: null, expectedRevision: 1 }, writer)
    expect(await h.get(reader)).toMatchObject({ source: 'model', selection: { connectionId: null } })
    expect(await h.invoke('forgetPairing', { provider: 'p', model: 'm' })).toEqual({ pairings: [] })
    expect(await h.get(reader)).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:openalex' } })
  })

  it('uses next-request model identity ahead of the previous request', async () => {
    const h = await host()
    const agent = await h.add('routed', { agentOptions: { provider: 'route', model: 'first' } })
    agent.session.append('request/header', { reason: 'initial', header: { config: { provider: 'previous', model: 'second' } } })
    await h.set({ connectionId: null, expectedRevision: 0 }, agent)
    expect(await h.invoke('pairings')).toEqual({ pairings: [{ provider: 'previous', model: 'second', connectionId: null }] })
    agent.session.append('model/selection', { provider: 'pending', model: 'third' })
    await h.set({ connectionId: 'builtin:firecrawl', expectedRevision: 1 }, agent)
    expect(await h.invoke('pairings')).toEqual({ pairings: [
      { provider: 'previous', model: 'second', connectionId: null },
      { provider: 'pending', model: 'third', connectionId: 'builtin:firecrawl' },
    ] })
  })

  it('inherits a seeded fork once and survives plugin storage reopening', async () => {
    const h = await host()
    await h.set({ connectionId: null, options: { freshness: 'fresh' }, expectedRevision: 0 })
    const fork = await h.add('fork', { meta: { parentSession: h.one.session.id, isSeeded: true }, inheritedEventCount: 0 as never, seed: [] })
    expect(await h.get(fork)).toMatchObject({ source: 'inherited', selection: { connectionId: null, revision: 0, options: { freshness: 'fresh' } } })
    await h.set({ connectionId: 'builtin:openalex', expectedRevision: 1 })
    expect((await h.get(fork)).selection.connectionId).toBeNull()
    await h.ctx.fiber.dispose()
    const reopened = await host({ root: h.root })
    expect(await reopened.get()).toMatchObject({ source: 'session', selection: { connectionId: 'builtin:openalex', revision: 2, options: { freshness: 'fresh' } } })
  })

  it('freezes each step but reads tightened operational policy on every call', async () => {
    const calls = network()
    const h = await host()
    await h.request()
    await h.set({ connectionId: 'builtin:firecrawl', options: { freshness: 'realtime' }, expectedRevision: 0 })
    await h.request()
    await h.search()
    expect(calls[0]).toContain('api.openalex.org')
    await h.request(h.one, 1)
    await h.search()
    expect(calls[1]).toContain('firecrawl')
    h.configure({ ...INITIAL, connections: { 'builtin:firecrawl': { disabled: true } } })
    await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
    expect(calls).toHaveLength(2)
  })

  it('reports off from the Seat while calls outside sessions use the current default', async () => {
    const calls = network()
    const h = await host()
    await h.set({ connectionId: null, expectedRevision: 0 })
    await h.request()
    await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    await h.ctx.web.search({ query: 'outside' })
    expect(calls[0]).toContain('api.openalex.org')
    h.configure({ defaultConnection: 'builtin:openalex', connections: { 'builtin:openalex': { disabled: true } } })
    await expect(h.ctx.web.search({ query: 'outside' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })

  it('contains missing storage in failed plans without failing Agent creation or normal requests', async () => {
    const h = await host({ storage: false })
    await h.request()
    await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await h.ctx.plugin(StorageDomain, { backend: 'json' })
    await h.request() // the failed step may retry capture after recovery
    network()
    await expect(h.search()).resolves.toHaveProperty('sources')
  })

  it('requires a new step snapshot after plugin remount without disrupting the Agent', async () => {
    const h = await host()
    await h.request()
    await h.remount()
    await expect(h.search()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await h.request(h.one, 1)
    network()
    await expect(h.search()).resolves.toHaveProperty('sources')
  })

  it.each(['deepseek-messages', 'deepseek-search-api'])('%s advertises account access but only requests tokens for the account request route', async native => {
    const h = await host({ settings: { defaultConnection: 'builtin:' + native } })
    const tokenEndpoints: string[] = []
    // The installed account package is an abstract external credential boundary, not an account provider.
    // Only that public boundary is a fixture; Agents, request context, WebRuntime and native backends are real.
    h.ctx.provide('deepseekAccount', { resolveToken: async (endpoint: string) => {
      tokenEndpoints.push(endpoint)
      return 'account-token'
    } } as never)
    const accountAgent = await h.add('account', { agentOptions: { provider: 'deepseek-account', model: 'chat' } })
    const view = await h.get(accountAgent)
    expect(view.connections.filter(connection => connection.kind === 'native')).toEqual([
      expect.objectContaining({ id: 'builtin:deepseek-messages', access: 'account', status: 'ready' }),
      expect.objectContaining({ id: 'builtin:deepseek-search-api', access: 'account', status: 'ready' }),
    ])
    expect(view.connections.every(connection => !Object.hasOwn(connection, 'credentialRef'))).toBe(true)
    expect(tokenEndpoints).toHaveLength(2)
    tokenEndpoints.length = 0
    // A configured account model is not yet a resolved model request.
    await expect(h.search(accountAgent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(tokenEndpoints).toEqual([])
    const accountHeaders: (string | null)[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      accountHeaders.push(new Headers(init.headers).get('x-dsh-auth-token'))
      throw new Error('network fixture')
    })
    accountAgent.session.append('request/header', { reason: 'initial', header: { config: { provider: 'deepseek-account', model: 'chat' } } })
    accountAgent.session.append('request/context', { provider: 'deepseek-account', model: 'chat' })
    await h.request(accountAgent)
    await expect(h.search(accountAgent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(tokenEndpoints).toHaveLength(1)
    expect(accountHeaders).toEqual(['account-token'])
    tokenEndpoints.length = 0
    accountAgent.session.append('request/header', { reason: 'change', header: { config: { provider: 'other-provider', model: 'chat' } } })
    accountAgent.session.append('request/context', { provider: 'other-provider', model: 'chat' })
    await h.request(accountAgent, 1)
    const otherView = await h.get(accountAgent)
    expect(otherView.connections.filter(connection => connection.kind === 'native').every(connection => connection.access === 'api-key')).toBe(true)
    await expect(h.search(accountAgent)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    await expect(h.ctx.web.search({ query: 'outside' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(tokenEndpoints).toEqual([])
    expect(accountHeaders).toHaveLength(1)
  })

  it('logs a redacted copy of transport failures', async () => {
    const secret = 'host-private-key'
    const h = await host({ settings: { defaultConnection: 'builtin:exa', connections: { 'builtin:exa': { access: 'api-key' } } } })
    await h.ctx.plugin(MemoryCredentials)
    await h.ctx.credentials.set(credentialRef('EXA_API_KEY'), secret)
    const original = Object.assign(new Error('private transport diagnostic ' + secret, { cause: new Error(secret) }), { code: 'HOST_TRANSPORT_FAILURE' })
    const diagnostics: unknown[][] = []
    h.ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
    vi.stubGlobal('fetch', async () => { throw original })
    await h.request()
    const result = h.search()
    await expect(result).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(result).rejects.not.toThrow('private transport diagnostic')
    expect(diagnostics.some(args => args.includes(original))).toBe(false)
    const copies = diagnostics.flat().filter((value): value is Error => value instanceof Error && (value as Error & { code?: unknown }).code === original.code)
    expect(copies).toHaveLength(1)
    expect(copies[0]).toMatchObject({ name: original.name, code: original.code, message: "diagnostic message withheld: it contained this request's credential" })
    expect(copies[0]!.cause).toBeUndefined()
    expect(copies[0]!.message).not.toContain(secret)
    expect(copies[0]!.stack).not.toContain(secret)
  })

  it('does not assume a route when the public web settings row is absent', async () => {
    const h = await host()
    vi.stubEnv('DSH_WEB_SEARCH_PROVIDER', SEARCH.providerId)
    expect(await h.invoke('provider') as ProviderView).toEqual({ providerId: SEARCH.providerId, envProvider: SEARCH.providerId })
    expect(currentRoute(h.ctx)).toEqual({ kind: 'unknown' })
    expect(routed(h.ctx)).toBe(false)
  })
})
