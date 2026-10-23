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
import { remoteMethods, type PeerId, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FETCH, type PairingsView, type ProviderView } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FetchSelectionView } from '../src/contract.ts'
import { installFetch } from '../src/host/runtime.ts'
import * as entry from '../src/index.ts'
import { routeFacts } from 'dsh-tool-web-enhanced-core/host'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { FetchSettings } from '../src/settings/types.ts'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { optionsCodec } from '../src/host/options.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
const INITIAL: FetchSettings = { version: 2, defaultConnection: 'builtin:local', connections: { 'builtin:deepseek-fetch-api': { disabled: false }, 'builtin:exa': { disabled: false }, 'builtin:firecrawl': { disabled: false }, 'builtin:tavily': { disabled: false }, 'builtin:tinyfish': { disabled: false } } }

async function host(options: { storage?: boolean; root?: string; rawSettings?: Record<string, unknown>; settings?: FetchSettings; environment?: Record<string, string> } = {}) {
  const root = options.root ?? await mkdtemp(join(tmpdir(), 'fetch-host-'))
  if (options.root === undefined) cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: options.environment ?? {} }]))
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  if (options.storage !== false) await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WebRuntime, { fetchProvider: FETCH.providerId })
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
  const pluginDefinition = { inject: ['web'], apply: (scope: Context) => { installFetch(scope, () => settings) } }
  let plugin = options.rawSettings === undefined
    ? await ctx.plugin(pluginDefinition)
    : await ctx.plugin(entry, options.rawSettings)
  const remount = async () => {
    await plugin.dispose()
    plugin = await ctx.plugin(pluginDefinition)
    await ctx.fiber.await()
  }
  await ctx.fiber.await()
  expect(ctx.get('fetchConnections')).toBeDefined()
  const add = async (id: string, extra: Omit<CreateAgentOptions, 'sessionId'> = {}) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), ...extra })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  const one = await add('one')
  const two = await add('two')
  const peer: PeerScope = { id: 'owner' as PeerId, ctx, principal: { kind: 'owner' }, interactions: 'answer', signal: new AbortController().signal, dispose: async () => {} }
  const invoke = (method: string, request: Record<string, unknown> = {}) => ctx.typertGateway.invoke({ peer, namespace: 'fetchConnections', method, args: { request } })
  const get = (agent = one) => invoke('get', { sessionId: agent.id }) as Promise<FetchSelectionView>
  const set = (change: Record<string, unknown>, agent = one) => invoke('set', { sessionId: agent.id, ...change }) as Promise<FetchSelectionView>
  const request = async (agent = one, step = 0) => {
    let continued = false
    await ctx.waterfall('agent/request', { agent, turn: 1, step, signal: new AbortController().signal } as never, (async () => { continued = true; return { provider: 'p', model: 'm' } }) as never)
    expect(continued).toBe(true)
  }
  const fetch = (agent = one, url = 'http://127.0.0.1:9/') => ctx.agents.withInitiator(agent, () => ctx.web.fetch({ url }))
  return { ctx, root, controller, one, two, add, invoke, get, set, request, fetch, remount, configure: (document: FetchSettings) => { settings = resolveSettings(document) } }
}


async function server(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const http = createServer((request, response) => { response.setHeader('content-type', 'text/plain'); handler(request, response) })
  await new Promise<void>(resolve => { http.listen(0, '127.0.0.1', resolve) })
  const address = http.address()
  if (address === null || typeof address === 'string') throw new Error('server has no TCP address')
  cleanups.push(async () => {
    http.closeAllConnections()
    await new Promise<void>((resolve, reject) => { http.close(error => { if (error === undefined) resolve(); else reject(error) }) })
  })
  return 'http://127.0.0.1:' + address.port
}

const localSettings = (allowCidrs: string[]): FetchSettings => ({ version: 2, connections: { 'builtin:deepseek-fetch-api': { disabled: false }, 'builtin:local': { options: { allowCidrs } } } })

describe('fetchConnections real Host', () => {
  it.each([{ version: 1 }, { unknownOption: true }, { connections: [] }])('keeps invalid settings %j active with a Seat repair instruction but does not expose plugin WebError messages through Remote', async rawSettings => {
    const h = await host({ rawSettings })
    let diagnostic = ''
    try { resolveSettings(rawSettings) } catch (error) { diagnostic = (error as Error).message }
    expect(diagnostic).not.toBe('')
    const failure = { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: 'dsh-web-fetch-enhanced: fetch settings are invalid; ask the user to fix them on the settings page' }
    await expect(h.fetch()).rejects.toMatchObject(failure)
    await expect(h.get()).rejects.toMatchObject({
      code: 'fetchConnections/invalid-settings',
      message: 'the row settings are invalid; fix them on the settings page',
      details: {},
    })
    await h.request()
    await expect(h.fetch()).rejects.toMatchObject(failure)
  })

  it('gets, changes, queues competing revisions and authorizes the addressed Session', async () => {
    const h = await host()
    for (const method of ['get', 'set']) {
      const marker = remoteMethods(h.ctx.fetchConnections).find(item => item.method === method)!
      expect(marker.resources!.session!({ sessionId: h.two.id })).toBe(h.two.id)
    }
    expect(await h.get()).toMatchObject({ selection: { connectionId: 'builtin:local', revision: 0, options: {} }, source: 'default' })
    const results = await Promise.allSettled([
      h.set({ connectionId: 'builtin:deepseek-fetch-api', expectedRevision: 0 }),
      h.set({ connectionId: null, expectedRevision: 0 }),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { code: 'fetchConnections/conflict' } }])
    expect(await h.get()).toMatchObject({ selection: { revision: 1 }, source: 'session' })
    expect((await h.get(h.two)).selection.revision).toBe(0)
    const child = await h.add('owned-child', { meta: { origin: 'subagent' } })
    // A live child Agent is readable; writes stay with DSH's subagent routing.
    expect(await h.get(child)).toMatchObject({ selection: { connectionId: 'builtin:local', revision: 0 }, source: 'default' })
    await expect(h.set({ connectionId: null, expectedRevision: 0 }, child)).rejects.toMatchObject({ code: 'session/agent-busy' })
    expect((await h.get(child)).selection.revision).toBe(0)
  })

  it('rejects unavailable connections and all session options without changing revision', async () => {
    const h = await host()
    await expect(h.set({ connectionId: 'custom:gone', expectedRevision: 0 })).rejects.toMatchObject({ code: 'fetchConnections/unavailable' })
    h.configure({ version: 2, connections: { 'builtin:deepseek-fetch-api': { disabled: true } } })
    await expect(h.set({ connectionId: 'builtin:deepseek-fetch-api', expectedRevision: 0 })).rejects.toMatchObject({ code: 'fetchConnections/unavailable' })
    await expect(h.set({ options: { allowCidrs: ['0.0.0.0/0'] }, expectedRevision: 0 })).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect((await h.get()).selection.revision).toBe(0)
    expect(optionsCodec.fromRecord({ arbitrary: true }, resolveSettings({}))).toEqual({})
    expect(optionsCodec.toRecord({})).toEqual({})
  })

  it('remembers model choices including off, clears memories, and reports their source', async () => {
    const h = await host()
    const writer = await h.add('writer', { agentOptions: { provider: 'p', model: 'm' } })
    await h.set({ connectionId: 'builtin:deepseek-fetch-api', expectedRevision: 0 }, writer)
    const reader = await h.add('reader', { agentOptions: { provider: 'p', model: 'm' } })
    expect(await h.get(reader)).toMatchObject({ source: 'model', selection: { connectionId: 'builtin:deepseek-fetch-api', revision: 0 } })
    expect(await h.invoke('pairings') as PairingsView).toEqual({ pairings: [{ provider: 'p', model: 'm', connectionId: 'builtin:deepseek-fetch-api' }] })
    h.configure({ version: 2, connections: { 'builtin:deepseek-fetch-api': { disabled: true } } })
    expect(await h.get(reader)).toMatchObject({ source: 'default', selection: { connectionId: 'builtin:local' } })
    await h.set({ connectionId: null, expectedRevision: 1 }, writer)
    expect(await h.get(reader)).toMatchObject({ source: 'model', selection: { connectionId: null } })
    expect(await h.invoke('forgetPairing', { provider: 'p', model: 'm' })).toEqual({ pairings: [] })
    expect(await h.get(reader)).toMatchObject({ source: 'default' })
  })

  it('uses pending model identity ahead of the previous request model', async () => {
    const h = await host()
    const agent = await h.add('routed', { agentOptions: { provider: 'route', model: 'first' } })
    agent.session.append('request/header', { reason: 'initial', header: { config: { provider: 'previous', model: 'second' } } })
    await h.set({ connectionId: null, expectedRevision: 0 }, agent)
    agent.session.append('model/selection', { provider: 'pending', model: 'third' })
    await h.set({ connectionId: 'builtin:deepseek-fetch-api', expectedRevision: 1 }, agent)
    expect(await h.invoke('pairings')).toEqual({ pairings: [
      { provider: 'previous', model: 'second', connectionId: null },
      { provider: 'pending', model: 'third', connectionId: 'builtin:deepseek-fetch-api' },
    ] })
  })

  it('inherits a seeded fork once and persists across storage reopening', async () => {
    const h = await host()
    await h.set({ connectionId: null, expectedRevision: 0 })
    const fork = await h.add('fork', { meta: { parentSession: h.one.session.id, isSeeded: true }, inheritedEventCount: 0 as never, seed: [] })
    expect(await h.get(fork)).toMatchObject({ source: 'inherited', selection: { connectionId: null, revision: 0, options: {} } })
    await h.set({ connectionId: 'builtin:local', expectedRevision: 1 })
    expect((await h.get(fork)).selection.connectionId).toBeNull()
    await h.ctx.fiber.dispose()
    const reopened = await host({ root: h.root })
    expect(await reopened.get()).toMatchObject({ source: 'session', selection: { connectionId: 'builtin:local', revision: 2, options: {} } })
  })

  it('freezes only the connection per step and applies local allowlist tightening on the very next call', async () => {
    let hits = 0
    const origin = await server((_request, response) => { hits++; response.end('local evidence') })
    const h = await host({ settings: localSettings(['127.0.0.1/32']) })
    await h.request()
    await expect(h.fetch(h.one, origin)).resolves.toMatchObject({ body: { content: 'local evidence' } })
    await h.set({ connectionId: 'builtin:deepseek-fetch-api', expectedRevision: 0 })
    await h.request() // repeated capture of the same step does not replace its plan
    await expect(h.fetch(h.one, origin)).resolves.toMatchObject({ body: { content: 'local evidence' } })
    h.configure(localSettings([]))
    await expect(h.fetch(h.one, origin)).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    expect(hits).toBe(2)
    await h.request(h.one, 1)
    await expect(h.fetch(h.one, origin)).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    h.configure({ version: 2, connections: { 'builtin:deepseek-fetch-api': { disabled: true } } })
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  })

  it('rejects off at the Seat but uses builtin:local outside any Session', async () => {
    const origin = await server((_request, response) => { response.end('outside') })
    const h = await host({ settings: localSettings(['127.0.0.1/32']) })
    await h.set({ connectionId: null, expectedRevision: 0 })
    await h.request()
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    await expect(h.ctx.web.fetch({ url: origin })).resolves.toMatchObject({ body: { content: 'outside' } })
  })

  it('contains missing storage in failed plans and recovers without failing normal Agent requests', async () => {
    const h = await host({ storage: false })
    await h.request()
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await h.ctx.plugin(StorageDomain, { backend: 'json' })
    await h.request()
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('requires a new step after remount without disrupting the Agent', async () => {
    const h = await host()
    await h.request()
    await h.remount()
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await h.request(h.one, 1)
    await expect(h.fetch()).rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('describes keyless local and credential/account remote readiness without exposing refs', async () => {
    const h = await host()
    expect((await h.get()).connections).toEqual([
      { id: 'builtin:local', label: 'Local HTTP', kind: 'local', remote: false, access: 'keyless', status: 'ready' },
      { id: 'builtin:deepseek-fetch-api', label: 'DeepSeek Fetch API', kind: 'native', remote: true, access: 'api-key', status: 'needs-credential' },
      { id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true, access: 'keyless', status: 'ready' },
      { id: 'builtin:firecrawl', label: 'Firecrawl', kind: 'adapter', remote: true, access: 'keyless', status: 'ready' },
      { id: 'builtin:tavily', label: 'Tavily', kind: 'adapter', remote: true, access: 'keyless', status: 'ready' },
      { id: 'builtin:tinyfish', label: 'Tinyfish', kind: 'adapter', remote: true, access: 'api-key', status: 'needs-credential' },
    ])
    const tokenEndpoints: string[] = []
    h.ctx.provide('deepseekAccount', { resolveToken: async (endpoint: string) => { tokenEndpoints.push(endpoint); return 'account-token' } } as never)
    const agent = await h.add('account', { agentOptions: { provider: 'deepseek-account', model: 'chat' } })
    const connections = (await h.get(agent)).connections
    expect(connections[1]).toMatchObject({ access: 'account', status: 'ready' })
    expect(connections[5]).toMatchObject({ access: 'api-key', status: 'needs-credential' })
    expect(tokenEndpoints).toHaveLength(1)
    h.configure({ connections: { 'builtin:exa': { disabled: true }, 'builtin:tinyfish': { disabled: true }, 'builtin:firecrawl': { disabled: false, access: 'api-key' } } })
    const changed = (await h.get(agent)).connections
    expect(changed[2]).toMatchObject({ access: 'keyless', status: 'disabled' })
    expect(changed[3]).toMatchObject({ access: 'api-key', status: 'needs-credential' })
    expect(changed[5]).toMatchObject({ access: 'api-key', status: 'disabled' })
    expect(tokenEndpoints.length).toBeGreaterThan(0)
    expect((await h.get(agent)).connections.every(connection => !Object.hasOwn(connection, 'credentialRef'))).toBe(true)
  })

  it('sends remote target URLs unchanged to a real API, never through the local address policy', async () => {
    const targets: string[] = []
    const origin = await server((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { url: string }
        targets.push(body.url)
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ content: 'remote evidence' }))
      })
    })
    const h = await host({ environment: { DEEPSEEK_API_KEY: 'fixture-key' }, settings: { version: 2, defaultConnection: 'builtin:deepseek-fetch-api', connections: { 'builtin:deepseek-fetch-api': { disabled: false, trustedEndpoint: true, options: { baseURL: origin } } } } })
    const url = 'http://127.0.0.1:1234/private?token=unchanged#fragment'
    await expect(h.ctx.web.fetch({ url })).resolves.toMatchObject({ url, body: { content: 'remote evidence' } })
    expect(targets).toEqual([url])
  })

  it('does not infer routing from the environment when public web settings are absent', async () => {
    const h = await host()
    vi.stubEnv('DSH_WEB_FETCH_PROVIDER', FETCH.providerId)
    expect(await h.invoke('provider') as ProviderView).toEqual({ providerId: FETCH.providerId, envProvider: FETCH.providerId })
    expect(routeFacts(h.ctx, 'fetchProvider', FETCH.providerId)).toEqual({ kind: 'unknown' })
  })
})
