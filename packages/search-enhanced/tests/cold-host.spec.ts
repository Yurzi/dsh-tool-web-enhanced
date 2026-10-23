/** Real capability lifecycle, WebRuntime, Remote and JSONL; adapter HTTP stays on loopback. */
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SessionId, SessionLogOffset, type SessionStore } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import type { PeerId, PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import WebRuntime from '@deepseek-ai/dsh-web'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { installSearch } from '../src/host/runtime.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { CustomConnection } from '../src/settings/types.ts'
import { MemoryCredentials } from './fixtures/credentials.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function adapterServer() {
  const calls: Array<{ path: string; query: string }> = []
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { query: string }
    const path = request.url!
    calls.push({ path, query: body.query })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ results: [{ url: 'https://example.org' + path, title: path, text: body.query }] }))
  })
  cleanups.push(() => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error === undefined) resolve(); else reject(error) })
    server.closeAllConnections()
  }))
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected loopback HTTP address')
  return { url: 'http://127.0.0.1:' + String(address.port), calls }
}

async function host(url: string) {
  const root = await mkdtemp(join(tmpdir(), 'search-cold-host-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'child' })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WebRuntime, { searchProvider: SEARCH.providerId })
  await ctx.plugin(TypertRegistry)
  void new Gateway(ctx, {})
  // No uploads in this fixture; preserve the controller's public resolver registration.
  const uploadResolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    uploadResolvers.add(resolver)
    return () => { uploadResolvers.delete(resolver) }
  } } as never)
  void new SessionController(ctx, { nativeOpen: false })
  const credentials = new MemoryCredentials(ctx)
  await credentials.set(credentialRef('FIXTURE_KEY'), 'local-fixture-key')
  const connection = (path: string): CustomConnection => ({
    kind: 'adapter', adapter: 'exa', label: path, credentialRef: 'FIXTURE_KEY',
    endpoint: url + path, trustedEndpoint: true,
  })
  const settings = resolveSettings({
    version: 2, defaultConnection: 'custom:old',
    connections: { 'custom:old': connection('/old'), 'custom:new': connection('/new') },
  })
  await ctx.plugin({ inject: ['web'], apply: (scope: Context) => installSearch(scope, () => settings) })
  await ctx.fiber.await()
  const peer: PeerScope = {
    id: 'owner' as PeerId, ctx, principal: { kind: 'owner' }, interactions: 'answer',
    signal: new AbortController().signal, dispose: async () => {},
  }
  const invoke = (method: string, request: Record<string, unknown> = {}) => ctx.typertGateway.invoke({
    peer, namespace: 'searchConnections', method, args: { request },
  })
  const search = (agent: Agent, query: string) => ctx.agents.withInitiator(agent, () => ctx.web.search({ query }))
  const request = async (agent: Agent, step: number) => {
    let continued = false
    await ctx.waterfall('agent/request', { agent, turn: 1, step, signal: new AbortController().signal } as never, (async () => {
      continued = true
      return { provider: 'fixture', model: 'child' }
    }) as never)
    expect(continued).toBe(true)
  }
  return { ctx, root, invoke, search, request }
}

describe('cold child capability recovery', () => {
  it.each([
    { origin: 'spawn', seeded: false },
    { origin: 'fork', seeded: true },
  ])('captures the cold Remote choice on agent/created and agent/request ($origin)', async ({ seeded }) => {
    const api = await adapterServer()
    const h = await host(api.url)
    const model = { provider: 'fixture', model: 'child' }
    const parent = await h.ctx.agents.create({ sessionId: SessionId('parent'), agentOptions: model, meta: { cwd: h.root } })
    cleanups.push(() => parent.dispose())
    // Nonempty memory makes accidental child writes observable (also after resume).
    await h.invoke('set', { sessionId: parent.agent.id, connectionId: 'custom:old', expectedRevision: 0 })
    const memory = await h.invoke('pairings')
    expect(memory).toEqual({ pairings: [{ ...model, connectionId: 'custom:old' }] })
    const child = await h.ctx.agents.create({
      sessionId: SessionId('child'), agentOptions: model,
      meta: { cwd: h.root, parentSession: parent.agent.id, origin: 'subagent', isSeeded: seeded },
      ...(seeded ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
    })
    cleanups.push(() => child.dispose())
    // No manual Sessions.current: even the initial live seat needs agent/created capture.
    await h.search(child.agent, 'live')
    expect(api.calls).toEqual([{ path: '/old', query: 'live' }])
    const id = child.agent.session.id
    const sessions = h.ctx.sessions as unknown as SessionStore
    await sessions.flush(child.agent.session)
    await child.dispose()
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(sessions.get(id)).toBeUndefined()
    expect(await h.ctx.sessionPersistence.stat(id)).toMatchObject({ header: { id, origin: 'subagent', isSeeded: seeded } })
    const created: SessionId[] = []
    const requested: number[] = []
    h.ctx.on('agent/created', ({ agent }) => { created.push(agent.id) })
    h.ctx.on('agent/request', ({ agent, step }, next) => {
      if (agent.id === id) requested.push(step)
      return next()
    })
    expect(await h.invoke('set', { sessionId: id, connectionId: 'custom:new', expectedRevision: 0 }))
      .toMatchObject({ selection: { connectionId: 'custom:new', revision: 1 }, source: 'session' })
    expect(created).toEqual([])
    expect(requested).toEqual([])
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(sessions.get(id)).toBeUndefined()
    expect(await h.invoke('pairings')).toEqual(memory)

    const resumed = await h.ctx.agents.resume({ resumeSessionId: id, agentOptions: model })
    cleanups.push(() => resumed.dispose())
    expect(resumed.agent.id).toBe(id)
    expect(created).toEqual([id])
    // Before any request or Remote get, the created capture must already serve /new.
    expect(requested).toEqual([])
    await h.search(resumed.agent, 'created')
    expect(api.calls.at(-1)).toEqual({ path: '/new', query: 'created' })
    await h.request(resumed.agent, 0)
    await h.search(resumed.agent, 'request')
    expect(requested).toEqual([0])
    expect(api.calls.at(-1)).toEqual({ path: '/new', query: 'request' })
    expect(await h.invoke('pairings')).toEqual(memory)

    // Distinguish actual request recapture from merely retaining the created plan.
    await h.invoke('set', { sessionId: id, connectionId: 'custom:old', expectedRevision: 1 })
    await h.request(resumed.agent, 0)
    await h.search(resumed.agent, 'same-step')
    expect(api.calls.at(-1)).toEqual({ path: '/new', query: 'same-step' })
    await h.request(resumed.agent, 1)
    await h.search(resumed.agent, 'next-step')
    expect(requested).toEqual([0, 0, 1])
    expect(api.calls).toEqual([
      { path: '/old', query: 'live' },
      { path: '/new', query: 'created' },
      { path: '/new', query: 'request' },
      { path: '/new', query: 'same-step' },
      { path: '/old', query: 'next-step' },
    ])
    expect(await h.invoke('pairings')).toEqual(memory)
  })
})
