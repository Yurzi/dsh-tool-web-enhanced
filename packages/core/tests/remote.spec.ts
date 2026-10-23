/** Real Agents, Session Controller, Gateway, selection domain and JSON backend. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { Context, type Message } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import { SessionId, SessionLogOffset, type SessionStore } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { RemoteError, type PeerId, type PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { afterEach, describe, expect, it } from 'vitest'
import { selectionContract, type ConnectionView, type ProviderView } from '../src/shared/selection.ts'
import type { OptionsCodec } from '../src/host/capability.ts'
import type { SessionModel } from '../src/host/model.ts'
import { Pairings } from '../src/host/pairings.ts'
import { createConnectionsService } from '../src/host/remote.ts'
import { ToolRestriction } from '../src/host/restriction.ts'
import { liveSession, Sessions } from '../src/host/sessions.ts'
import { SessionStorage } from '../src/host/storage.ts'
import { settingsRow } from '../src/host/settings-row.ts'
import { WebError } from '@deepseek-ai/dsh-web'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })
const namespace = 'coreConnections'
const domainName = 'core_remote'
const internal = { code: 'gateway/internal', message: 'connection request failed; retry or check the Host logs', details: {} }

async function host(options: {
  providerView?: () => ProviderView
  describe?: (settings: unknown, model: SessionModel | undefined) => Promise<ConnectionView[]>
  persistence?: boolean
  query?: boolean
  invalidSettings?: boolean
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'remote-private-storage-token-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const logs: Message[] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { logs.push(message) } })
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  if (options.persistence) {
    await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
    await ctx.plugin(AgentDefaultModel, { provider: 'fixture', model: 'm' })
  }
  if (options.query) {
    // Peer-only resolution exposes the public instance type here, not the exported constructor type.
    const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-session-controller'))
    type Query = Context['sessionQuery']
    const { default: SessionQuery }: {
      default: abstract new (ctx: Context) => Query
    } = await import(require.resolve('@deepseek-ai/dsh-session-query'))
    // Keep real exact reads for cold recovery/not-found; this fixture does not provide search.
    class ExactReadQuery extends SessionQuery {
      override searchSessions(..._args: Parameters<Query['searchSessions']>): ReturnType<Query['searchSessions']> {
        throw new Error('remote fixture does not support session search')
      }

      override searchEvents(..._args: Parameters<Query['searchEvents']>): ReturnType<Query['searchEvents']> {
        throw new Error('remote fixture does not support event search')
      }
    }
    void new ExactReadQuery(ctx)
  }
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(TypertRegistry)
  void new Gateway(ctx, {})
  // As in the plugin Host suites, retain the unused public upload resolver registration.
  const uploadResolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    uploadResolvers.add(resolver)
    return () => { uploadResolvers.delete(resolver) }
  } } as never)
  const controller = new SessionController(ctx, { nativeOpen: false })
  const settings = { defaultConnection: 'builtin:local', enhancedTools: false, connections: new Map([
    ['builtin:local', { id: 'builtin:local', kind: 'local' as const, disabled: false }],
  ]) }
  const codec: OptionsCodec<Record<string, never>, typeof settings> = {
    initial: () => ({}), fromRecord: () => ({}), toRecord: () => ({}),
  }
  const storage = new SessionStorage(ctx, domainName, codec)
  const pairings = new Pairings(storage)
  let readSettings = () => settings
  if (options.invalidSettings) {
    const row = settingsRow({
      identity: { packageName: 'core-remote-test', rowId: 'core-remote-test' },
      capabilityLabel: 'fixture', retiredFields: [], secretFields: [],
      resolve: () => { throw new Error('private invalid settings diagnostic') },
    })
    row.apply(ctx, row.Config({}), (_scope, read) => { readSettings = read })
  }
  const sessions = new Sessions(ctx, () => readSettings(), storage, pairings,
    new ToolRestriction(ctx, { tool: 'web_fetch', routed: () => false }), options.describe)
  const contract = selectionContract({ namespace, packageName: 'core-remote-test', options: {}, extras: {} })
  const service = createConnectionsService(ctx, {
    namespace, contract, sessions, pairings,
    providerView: options.providerView ?? (() => ({ providerId: 'fixture', envProvider: null })),
  })
  await ctx.fiber.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('ordinary'), agentOptions: { provider: 'fixture', model: 'm' } })
  cleanups.push(() => handle.dispose())
  const peer: PeerScope = {
    id: 'owner' as PeerId, ctx, principal: { kind: 'owner' }, interactions: 'answer',
    signal: new AbortController().signal, dispose: async () => {},
  }
  const invoke = (method: string, request: Record<string, unknown> = {}) =>
    ctx.typertGateway.invoke({ peer, namespace, method, args: { request } })
  const blockWrites = async () => {
    // Replace only this fixture's JSON document with a directory: real rename() now fails.
    const path = resolve(root, domainName + '.json')
    expect(dirname(path)).toBe(root)
    await rm(path, { force: true })
    await mkdir(path)
  }
  return { ctx, root, logs, controller, storage, pairings, sessions, service, agent: handle.agent, invoke, blockWrites }
}

type Host = Awaited<ReturnType<typeof host>>
async function sanitized(h: Host, work: Promise<unknown>) {
  const result = await work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('expected a Remote failure')
  const wire = h.ctx.typertGateway.wireStream.failure(result.error)
  expect(wire).toEqual(internal)
  expect(result.error).toBeInstanceOf(RemoteError)
  expect(result.error).not.toHaveProperty('cause')
  expect((result.error as Error).stack).not.toContain('private')
  expect(JSON.stringify(wire)).not.toContain('private')
  const diagnostic = h.logs.flatMap(message => message.args).find(value => value instanceof Error)
  expect(diagnostic).toBeInstanceOf(Error)
  return diagnostic as Error
}

describe('connection Remote failure boundary', () => {
  it.each(['get', 'set'] as const)('reports invalid row settings during %s without repeating diagnostics', async method => {
    const h = await host({ invalidSettings: true })
    expect(h.logs.some(message => message.args.some(value => value instanceof Error && value.message.includes('private invalid settings')))).toBe(true)
    h.logs.splice(0)
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await h.invoke(method, {
        sessionId: h.agent.id, ...(method === 'set' ? { connectionId: 'builtin:local', expectedRevision: 0 } : {}),
      }).then(() => { throw new Error('expected rejection') }, (error: unknown) => error)
      expect(failure).toBeInstanceOf(RemoteError)
      expect(failure).not.toHaveProperty('cause')
      expect(h.ctx.typertGateway.wireStream.failure(failure)).toEqual({
        code: namespace + '/invalid-settings', message: 'the row settings are invalid; fix them on the settings page', details: {},
      })
    }
    expect(h.logs).toHaveLength(0)
  })

  it('does not classify an unrelated WebError by its code or settings-invalid message', async () => {
    const failure = new WebError('fixture settings are invalid; ask the user to fix them on the settings page', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    const h = await host({ describe: async () => { throw failure } })
    expect(await sanitized(h, h.invoke('get', { sessionId: h.agent.id }))).toBe(failure)
  })
  it.each(['get', 'set'] as const)('sanitizes a real JSON storage write failure during %s and logs its private path', async method => {
    const h = await host()
    await h.storage.domain()
    if (method === 'set') await h.sessions.current(liveSession(h.agent))
    await h.blockWrites()
    const error = await sanitized(h, h.invoke(method, {
      sessionId: h.agent.id, ...(method === 'set' ? { connectionId: null, expectedRevision: 0 } : {}),
    }))
    expect(error.message).toContain(h.root)
    expect(error.stack).toContain('remote-private-storage-token-')
  })

  it('sanitizes malformed stored pairing keys while retaining the original parse error in Host logs', async () => {
    const h = await host()
    await (await h.storage.domain()).table('pairings').put('private-pairing-token', { connectionId: null })
    const error = await sanitized(h, h.invoke('pairings'))
    expect(error).toBeInstanceOf(SyntaxError)
    expect(error.message).toContain('private')
  })

  it('sanitizes a real JSON storage delete failure during forgetPairing', async () => {
    const h = await host()
    const model = { provider: 'fixture', model: 'm' }
    await h.pairings.set(model, null)
    await h.blockWrites()
    const error = await sanitized(h, h.invoke('forgetPairing', model))
    expect(error.message).toContain(h.root)
    expect(await h.pairings.list()).toEqual([{ ...model, connectionId: null }])
  })

  it.each(['get', 'set'] as const)('contains asynchronous connection-view failures after %s', async method => {
    const cause = new Error('private upstream cause')
    const failure = new Error('private credential token', { cause })
    failure.stack = 'private upstream stack'
    const h = await host({ describe: async () => { throw failure } })
    const error = await sanitized(h, h.invoke(method, {
      sessionId: h.agent.id, ...(method === 'set' ? { connectionId: null, expectedRevision: 0 } : {}),
    }))
    expect(error).toBe(failure)
    expect(error.cause).toBe(cause)
  })

  it.each([new Error('private provider secret', { cause: 'private cause' }), 'private thrown string', { token: 'private thrown object' }, undefined])(
    'sanitizes provider failures, including non-Errors (%s)', async failure => {
      const h = await host({ providerView: () => { throw failure } })
      const result = await h.invoke('provider').then(() => { throw new Error('expected rejection') }, (error: unknown) => error)
      expect(h.ctx.typertGateway.wireStream.failure(result)).toEqual(internal)
      expect(result).toBeInstanceOf(RemoteError)
      expect(result).not.toHaveProperty('cause')
      expect(h.logs.some(message => message.args.includes(failure))).toBe(true)
    },
  )

  it.each([
    new RemoteError('gateway/bad-request', 'declared failure', { issues: [] }),
    new RemoteError('gateway/internal', 'declared internal diagnostic', {}),
  ])('preserves RemoteError identity and details rather than logging or replacing it (%s)', async failure => {
    const h = await host({ providerView: () => { throw failure } })
    await expect(h.invoke('provider')).rejects.toBe(failure)
    expect(h.ctx.typertGateway.wireStream.failure(failure)).toEqual({
      code: failure.code, message: failure.message, details: failure.details,
    })
    expect(h.logs).toHaveLength(0)
  })

  it('preserves bad-request, unavailable and conflict errors and leaves the selection unchanged on rejection', async () => {
    const h = await host()
    await expect(h.invoke('get', {})).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(h.invoke('set', { sessionId: h.agent.id, connectionId: 'custom:missing', expectedRevision: 0 }))
      .rejects.toMatchObject({ code: namespace + '/unavailable', details: { connectionId: 'custom:missing' } })
    await h.invoke('set', { sessionId: h.agent.id, connectionId: null, expectedRevision: 0 })
    await expect(h.invoke('set', { sessionId: h.agent.id, connectionId: 'builtin:local', expectedRevision: 0 }))
      .rejects.toMatchObject({ code: namespace + '/conflict', details: {} })
    expect(await h.invoke('get', { sessionId: h.agent.id })).toMatchObject({ selection: { connectionId: null, revision: 1 } })
    expect(h.logs).toHaveLength(0)
  })

  it('preserves the real resolveAgent gateway/internal message and details on the browser wire', async () => {
    const h = await host()
    // No session-query facility is mounted: the real controller reports its resume failure.
    const sessionId = SessionId('private-resume-session')
    const found = await h.controller.resolveAgent(sessionId)
    if (!('error' in found)) throw new Error('expected resume failure')
    expect(found.error.code).toBe('gateway/internal')
    expect(found.error.message).toContain('resume failed')
    const error = await h.invoke('get', { sessionId }).then(
      () => { throw new Error('expected rejection') }, (failure: unknown) => failure,
    )
    expect(h.ctx.typertGateway.wireStream.failure(error)).toEqual({
      code: found.error.code, message: found.error.message, details: found.error.details,
    })
    expect(h.logs).toHaveLength(0)
  })

  async function child(h: Host, id: string, fork: boolean) {
    const handle = await h.ctx.agents.create({
      // Another model than the parent's: its memory, written by the parent's set, does not apply.
      sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'child' },
      meta: { cwd: h.root, parentSession: h.agent.session.id, origin: 'subagent', isSeeded: fork },
      ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
    })
    cleanups.push(() => handle.dispose())
    // The controller reserves child Sessions for subagent routing.
    const found = await h.controller.resolveAgent(handle.agent.session.id)
    if (!('error' in found)) throw new Error('expected session ownership rejection')
    expect(found.error.code).toBe('session/agent-busy')
    return { handle, error: found.error }
  }

  it.each([false, true])('reads the connection status of a live child Agent (fork=%s) with the usual inheritance', async fork => {
    const h = await host()
    await h.invoke('set', { sessionId: h.agent.id, connectionId: null, expectedRevision: 0 })
    const { handle } = await child(h, fork ? 'fork-child' : 'spawn-child', fork)
    const view = await h.invoke('get', { sessionId: handle.agent.id })
    // A fork copies the parent's selection; a spawned child starts from the default, as on the request path.
    expect(view).toMatchObject(fork
      ? { selection: { connectionId: null, revision: 0 }, source: 'inherited' }
      : { selection: { connectionId: 'builtin:local', revision: 0 }, source: 'default' })
    expect(view).toHaveProperty('connections')
    const table = (await h.storage.domain()).table('selections')
    expect(table.get(handle.agent.id)).toMatchObject({ connectionId: fork ? null : 'builtin:local', revision: 0 })
    expect(await h.invoke('get', { sessionId: h.agent.id })).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    expect(h.logs).toHaveLength(0)
  })

  it.each([false, true])('writes a live child Agent without changing model memory (fork=%s)', async fork => {
    const h = await host()
    const { handle } = await child(h, 'owned-child', fork)
    await h.invoke('get', { sessionId: handle.agent.id })
    expect(await h.invoke('set', { sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 }))
      .toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    expect(await h.pairings.list()).toEqual([])
    expect(await h.invoke('get', { sessionId: handle.agent.id })).toMatchObject({ selection: { connectionId: null, revision: 1 } })
    expect(h.logs).toHaveLength(0)
  })

  async function makeCold(h: Host, handle: Awaited<ReturnType<Host['ctx']['agents']['create']>>) {
    const sessions = h.ctx.sessions as unknown as SessionStore
    await sessions.flush(handle.agent.session)
    const id = handle.agent.session.id
    await handle.dispose()
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect((h.ctx.sessions as unknown as SessionStore).get(id)).toBeUndefined()
    expect(await h.ctx.sessionPersistence.stat(id)).toMatchObject({ header: { id } })
    return id
  }

  it.each([false, true])('reads and writes a real JSONL cold child without restoring it, then resumes its durable choice (fork=%s)', async fork => {
    const describedModels: Array<SessionModel | undefined> = []
    const h = await host({ persistence: true, describe: async (_settings, model) => {
      describedModels.push(model)
      return []
    } })
    const { handle } = await child(h, 'durable-child', fork)
    // Establish a record while live, just as the runtime capture does.
    await h.invoke('get', { sessionId: handle.agent.id })
    const id = await makeCold(h, handle)
    const created: SessionId[] = []
    h.ctx.on('agent/created', ({ agent }) => { created.push(agent.id) })
    describedModels.splice(0)
    expect(await h.invoke('get', { sessionId: id })).toMatchObject({ selection: { connectionId: 'builtin:local', revision: 0 } })
    expect(await h.invoke('set', { sessionId: id, connectionId: null, expectedRevision: 0 }))
      .toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    expect(await h.invoke('get', { sessionId: id })).toMatchObject({ selection: { connectionId: null, revision: 1 } })
    expect(describedModels).toEqual([undefined, undefined, undefined])
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect((h.ctx.sessions as unknown as SessionStore).get(id)).toBeUndefined()
    expect(created).toEqual([])
    expect(await h.pairings.list()).toEqual([])
    expect((await h.storage.domain()).table('selections').get(id)).toMatchObject({ connectionId: null, revision: 1 })

    const resumed = await h.ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'fixture', model: 'child' } })
    cleanups.push(() => resumed.dispose())
    expect(resumed.agent.id).toBe(id)
    expect(created).toEqual([id])
    expect(await h.sessions.current(liveSession(resumed.agent)))
      .toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    // Once explicitly selected, a fork no longer follows later parent changes.
    await h.invoke('set', { sessionId: h.agent.id, connectionId: 'builtin:local', expectedRevision: 0 })
    expect(await h.invoke('get', { sessionId: id })).toMatchObject({ selection: { connectionId: null, revision: 1 } })
    expect(h.logs).toHaveLength(0)
  })

  it.each([false, true])('uses default or inherited selection for a cold child with no record, not model memory (fork=%s)', async fork => {
    const h = await host({ persistence: true })
    await h.invoke('set', { sessionId: h.agent.id, connectionId: null, expectedRevision: 0 })
    await h.pairings.set({ provider: 'fixture', model: 'child' }, null)
    const before = await h.pairings.list()
    const { handle } = await child(h, 'no-selection-record', fork)
    const id = await makeCold(h, handle)
    const table = (await h.storage.domain()).table('selections')
    expect(table.get(id)).toBeUndefined()
    const created: SessionId[] = []
    h.ctx.on('agent/created', ({ agent }) => { created.push(agent.id) })
    expect(await h.invoke('get', { sessionId: id })).toMatchObject(fork
      ? { selection: { connectionId: null, revision: 0 }, source: 'inherited' }
      : { selection: { connectionId: 'builtin:local', revision: 0 }, source: 'default' })
    expect(table.get(id)).toMatchObject({ connectionId: fork ? null : 'builtin:local', revision: 0 })
    expect(await h.pairings.list()).toEqual(before)
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(created).toEqual([])
    const resumed = await h.ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'fixture', model: 'child' } })
    cleanups.push(() => resumed.dispose())
    // Revision-zero defaults are recalculated with the next live model; inheritance stays inheritance.
    expect(await h.invoke('get', { sessionId: id })).toMatchObject({
      selection: { connectionId: null, revision: 0 }, source: fork ? 'inherited' : 'model',
    })
    expect(h.logs).toHaveLength(0)
  })

  it.each([false, true])('restores an ordinary JSONL cold Session through the real controller and writes model memory (user fork=%s)', async fork => {
    for (const method of ['get', 'set'] as const) {
      const h = await host({ persistence: true, query: true })
      const original = await h.ctx.agents.create({
        sessionId: SessionId('cold-ordinary-' + method), agentOptions: { provider: 'fixture', model: 'm' },
        meta: { cwd: h.root, ...(fork ? { parentSession: h.agent.id, isSeeded: true } : {}) },
        ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
      })
      cleanups.push(() => original.dispose())
      const id = await makeCold(h, original)
      const created: SessionId[] = []
      h.ctx.on('agent/created', ({ agent }) => { created.push(agent.id) })
      expect(await h.invoke(method, { sessionId: id, ...(method === 'set' ? { connectionId: null, expectedRevision: 0 } : {}) }))
        .toMatchObject({ selection: { connectionId: method === 'set' ? null : 'builtin:local', revision: method === 'set' ? 1 : 0 } })
      expect(created).toEqual([id])
      const restored = h.ctx.agents.get(id)!
      expect(restored.id).toBe(id)
      expect(restored.session.header.origin).toBeUndefined()
      expect(await h.controller.resolveAgent(id)).toEqual({ agent: restored })
      expect(restored.options).toMatchObject({ provider: 'fixture', model: 'm' })
      if (method === 'get') await h.invoke('set', { sessionId: id, connectionId: null, expectedRevision: 0 })
      expect(await h.pairings.list()).toEqual([{ provider: 'fixture', model: 'm', connectionId: null }])
      expect(h.logs).toHaveLength(0)
    }
  })

  it.each(['get', 'set'] as const)('preserves the real controller not-found response for a missing JSONL Session during %s', async method => {
    const h = await host({ persistence: true, query: true })
    const sessionId = SessionId('missing-session')
    expect(await h.ctx.sessionPersistence.stat(sessionId)).toBeUndefined()
    const found = await h.controller.resolveAgent(sessionId)
    if (!('error' in found)) throw new Error('expected not-found')
    expect(found.error.code).toBe('session/not-found')
    const failure = await h.invoke(method, { sessionId, ...(method === 'set' ? { connectionId: null, expectedRevision: 0 } : {}) })
      .then(() => { throw new Error('expected rejection') }, (error: unknown) => error)
    expect(h.ctx.typertGateway.wireStream.failure(failure)).toEqual(h.ctx.typertGateway.wireStream.failure(found.error))
    expect(h.ctx.agents.get(sessionId)).toBeUndefined()
    expect(h.logs).toHaveLength(0)
  })

  it.each([false, true])('serializes concurrent cold child writes and rejects exactly one stale revision (fork=%s)', async fork => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let descriptions = 0
    const h = await host({ persistence: true, describe: async () => {
      if (descriptions++ === 0) {
        entered.resolve()
        await release.promise
      }
      return []
    } })
    const { handle } = await child(h, 'contended-child', fork)
    const id = await makeCold(h, handle)
    // The first write is committed but its response is still in flight at the
    // asynchronous capability-description seam when the second request arrives.
    const first = h.invoke('set', { sessionId: id, connectionId: null, expectedRevision: 0 })
    await entered.promise
    const second = await h.invoke('set', { sessionId: id, connectionId: 'builtin:local', expectedRevision: 0 })
      .then(value => ({ kind: 'accepted' as const, value }), (error: unknown) => ({ kind: 'rejected' as const, error }))
    release.resolve()
    const winner = await first
    expect(second).toMatchObject({ kind: 'rejected', error: { code: namespace + '/conflict', details: {} } })
    expect(winner).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    expect(await h.invoke('get', { sessionId: id })).toEqual(winner)
    expect(await h.pairings.list()).toEqual([])
    expect(h.ctx.agents.get(id)).toBeUndefined()
    expect(h.logs).toHaveLength(0)
  })

  it('falls back to the controller for writes when persistence is unavailable', async () => {
    const h = await host()
    const { handle } = await child(h, 'gone-child-write', false)
    await handle.dispose()
    expect(h.ctx.get('sessionPersistence')).toBeUndefined()
    const found = await h.controller.resolveAgent(handle.agent.id)
    if (!('error' in found)) throw new Error('expected a controller failure')
    const failure = await h.invoke('set', { sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 })
      .then(() => { throw new Error('expected rejection') }, (error: unknown) => error)
    expect(h.ctx.typertGateway.wireStream.failure(failure)).toEqual(h.ctx.typertGateway.wireStream.failure(found.error))
    expect(h.ctx.agents.get(handle.agent.id)).toBeUndefined()
    expect(h.logs).toHaveLength(0)
  })

  it('falls back to the controller once a child Agent is no longer live', async () => {
    const h = await host()
    const { handle } = await child(h, 'gone-child', false)
    await handle.dispose()
    expect(h.ctx.agents.get(handle.agent.session.id)).toBeUndefined()
    const found = await h.controller.resolveAgent(handle.agent.session.id)
    if (!('error' in found)) throw new Error('expected a controller failure')
    const failure = await h.invoke('get', { sessionId: handle.agent.id })
      .then(() => { throw new Error('expected rejection') }, (rejection: unknown) => rejection)
    expect(h.ctx.typertGateway.wireStream.failure(failure)).toEqual(h.ctx.typertGateway.wireStream.failure(found.error))
    expect(h.logs).toHaveLength(0)
  })
})
