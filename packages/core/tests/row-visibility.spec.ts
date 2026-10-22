/** Actual plugin entries and Settings user-layer mutations, not mutable settings callbacks. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { shippedWebPreset } from './fixtures/shipped-preset.ts'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import Projections from '@deepseek-ai/dsh-session-projection'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SessionId, SessionLogOffset, type SessionStore } from '@deepseek-ai/dsh-session'
import { isNewConversation } from '../src/host/provider-lists.ts'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { SEARCH, FETCH } from '../src/shared/index.ts'
import * as searchPlugin from '../../search-enhanced/src/index.ts'
import * as fetchPlugin from '../../fetch-enhanced/src/index.ts'
import { mountWebSettings } from './fixtures/web-settings.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host(enhancedTools: boolean, priorEvents = false, persistence = false) {
  const root = await mkdtemp(join(tmpdir(), 'real-row-visibility-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  if (priorEvents) ctx.on('agent/created', ({ agent }) => {
    agent.session.append('model/selection', { provider: 'fixture', model: 'fixture' })
  })
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  if (persistence) {
    const installed = createRequire('/usr/lib/node_modules/@deepseek-ai/dsh/package.json')
    const backend = await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-session-persistence-jsonl')).href)
    await ctx.plugin(backend, { root: join(root, 'sessions'), compression: 'none' })
  }
  await mountWebSettings(ctx, root, {
    web: { searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId },
    rows: [
      { id: SEARCH.rowId, name: 'cordis:searchPluginForTest', config: { enhancedTools } },
      { id: FETCH.rowId, name: 'cordis:fetchPluginForTest', config: { enhancedTools } },
    ],
    configure(scope) {
      scope.loader.builtins.searchPluginForTest = searchPlugin
      scope.loader.builtins.fetchPluginForTest = fetchPlugin
    },
  })
  await ctx.fiber.await()
  const create = async (id: string) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id) })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  return { ctx, create, root }
}

it.each([SEARCH, FETCH])('uses the actual $rowId volatile row when Settings mutates enhancedTools on and off', async identity => {
  const { ctx, create } = await host(false)
  const names = [identity.tools.action, identity.tools.list]
  const old = await create('before-enable')
  for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
  await ctx.settings.mutate(identity.rowId, [{ op: 'set', path: ['enhancedTools'], value: true }])
  for (const name of names) expect(ctx.tools.get(name)).toBeDefined()
  for (const name of names) expect(ctx.tools.get(name, scopeOf(old.ctx))).toBeUndefined()
  const fresh = await create('after-enable')
  for (const name of names) expect(ctx.tools.get(name, scopeOf(fresh.ctx))).toBeDefined()
  await ctx.settings.mutate(identity.rowId, [{ op: 'set', path: ['enhancedTools'], value: false }])
  for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
})

it.each([SEARCH, FETCH])('offers initial enabled row $rowId and follows actual web user-layer route mutations', async identity => {
  const { ctx, create } = await host(true)
  const names = [identity.tools.action, identity.tools.list]
  const agent = await create('routed')
  for (const name of names) expect(ctx.tools.get(name, scopeOf(agent.ctx))).toBeDefined()
  const field = identity === SEARCH ? 'searchProvider' : 'fetchProvider'
  await ctx.settings.mutate('web', [{ op: 'set', path: [field], value: 'elsewhere' }])
  for (const name of names) expect(ctx.tools.get(name)).toBeUndefined()
  await ctx.settings.mutate('web', [{ op: 'set', path: [field], value: identity.providerId }])
  for (const name of names) expect(ctx.tools.get(name, scopeOf(agent.ctx))).toBeDefined()
})

async function controller(ctx: Context): Promise<SessionController> {
  const installed = createRequire('/usr/lib/node_modules/@deepseek-ai/dsh/package.json')
  const defaults = await import(pathToFileURL(installed.resolve('@deepseek-ai/dsh-agent-default-model')).href)
  await ctx.plugin(defaults.default, { provider: 'fixture', model: 'fixture' })
  await ctx.plugin(TypertRegistry)
  const resolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    resolvers.add(resolver)
    return () => { resolvers.delete(resolver) }
  } } as never)
  return new SessionController(ctx, { nativeOpen: false })
}

it('authorizes a genuine Controller-created conversation even after earlier created listeners appended live events', async () => {
  const { ctx, root } = await host(true, true)
  const api = await controller(ctx)
  const created = await api.create({ cwd: root })
  const agent = ctx.agents.get(created.sessionId)!
  expect(agent.session.seq).toBeGreaterThan(0)
  expect(agent.session.firstLiveSeq).toBe(0)
  expect(agent.session.firstLifecycleSeq).toBe(0)
  for (const name of [SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list]) {
    expect(ctx.tools.get(name, scopeOf(agent.ctx))).toBeDefined()
  }
})

it('persists an empty authorization when first created while off, never backfilling the same Session identity', async () => {
  const { ctx } = await host(false)
  const id = SessionId('never-backfill')
  const first = await ctx.agents.create({ sessionId: id })
  expect(first.agent.session.firstLiveSeq).toBe(0)
  for (const domain of ['web_search_enhanced', 'web_fetch_enhanced']) {
    expect(ctx.storageDomain.get(domain)!.table('provider_lists').get(id)).toEqual([])
  }
  await first.dispose()
  await ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: ['enhancedTools'], value: true }])
  await ctx.settings.mutate(FETCH.rowId, [{ op: 'set', path: ['enhancedTools'], value: true }])
  const next = await ctx.agents.create({ sessionId: id })
  cleanups.push(() => next.dispose())
  expect(next.agent.session.firstLiveSeq).toBe(0)
  for (const name of [SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list]) {
    expect(ctx.tools.get(name)).toBeDefined()
    expect(ctx.tools.get(name, scopeOf(next.agent.ctx))).toBeUndefined()
  }
})

it.each([false, true])('classifies a real JSONL resume using public lifecycle boundaries (nonempty=%s)', async nonempty => {
  const { ctx, root } = await host(true, false, true)
  const id = SessionId(nonempty ? 'stored-nonempty' : 'stored-empty')
  const original = await ctx.agents.create({ sessionId: id, meta: { cwd: root } })
  expect(isNewConversation(original.agent.session)).toBe(true)
  if (nonempty) original.agent.session.append('model/selection', { provider: 'fixture', model: 'fixture' })
  // Another DSH ambient declaration narrows Context.sessions to ISessions; the mounted service is SessionStore.
  const sessions = ctx.sessions as unknown as SessionStore
  await sessions.flush(original.agent.session)
  await original.dispose()
  const restored = await ctx.agents.resume({ resumeSessionId: id })
  cleanups.push(() => restored.dispose())
  if (nonempty) {
    expect(restored.agent.session.firstLiveSeq).toBeGreaterThan(0)
    expect(restored.agent.session.firstLifecycleSeq).toBeGreaterThan(0)
    expect(isNewConversation(restored.agent.session)).toBe(false)
  } else {
    // No public non-deprecated boundary distinguishes this truly empty restored conversation.
    expect(restored.agent.session.firstLiveSeq).toBe(0)
    expect(restored.agent.session.firstLifecycleSeq).toBe(0)
    expect(isNewConversation(restored.agent.session)).toBe(true)
  }
})

it.each([false, true])('inherits, never resnapshots, authorization for a Controller parent’s child (fork=%s)', async fork => {
  const { ctx, root } = await host(true, true)
  const api = await controller(ctx)
  const parent = await api.create({ cwd: root })
  const child = await ctx.agents.create({
    sessionId: SessionId('controller-child'), meta: { parentSession: parent.sessionId, origin: 'subagent', isSeeded: fork },
    ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
  })
  cleanups.push(() => child.dispose())
  expect(isNewConversation(child.agent.session)).toBe(false)
  for (const domain of ['web_search_enhanced', 'web_fetch_enhanced']) {
    const table = ctx.storageDomain.get(domain)!.table('provider_lists')
    expect(table.get(child.agent.id)).toEqual(table.get(parent.sessionId))
  }
  for (const name of [SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list]) {
    expect(ctx.tools.get(name, scopeOf(child.agent.ctx))).toBeDefined()
  }
})

it.each([false, true])('returns from real Settings.update after an old Agent exists when enabling search then fetch (standard=%s)', async standard => {
  const { ctx, create: createBare, root } = await host(false, false, true)
  if (standard) {
    await ctx.plugin(AgentPresets, { default: 'standard' })
    await shippedWebPreset(ctx, 'standard')
  }
  const create = async (id: string) => {
    if (!standard) return createBare(id)
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta: { cwd: root, agentPreset: 'standard' },
      setup: async scope => { await ctx.agentPresets.mount(scope, 'standard') },
    })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  const old = await create('before-update')
  expect(ctx.tools.schemas(scopeOf(old.ctx))).not.toContainEqual(expect.objectContaining({ name: SEARCH.tools.action }))
  await ctx.settings.update(SEARCH.rowId, { enhancedTools: true })
  expect(ctx.tools.get(SEARCH.tools.action)).toBeDefined()
  await ctx.settings.update(FETCH.rowId, { enhancedTools: true })
  expect(ctx.tools.get(FETCH.tools.action)).toBeDefined()
  const fresh = await create('after-updates')
  for (const name of [SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list]) {
    expect(ctx.tools.get(name, scopeOf(old.ctx))).toBeUndefined()
    expect(ctx.tools.get(name, scopeOf(fresh.ctx))).toBeDefined()
  }
  await ctx.settings.update(SEARCH.rowId, { enhancedTools: false })
  await ctx.settings.update(FETCH.rowId, { enhancedTools: false })
})
