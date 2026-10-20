/** Real rc.2 Agents and Web preset ancestry; scripted model transport, no timer-based synchronization. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Settings from '@deepseek-ai/dsh-settings'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import WebRuntime from '@deepseek-ai/dsh-web'
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, expect, it, vi } from 'vitest'
import { Pairings } from 'dsh-tool-web-enhanced-core/host'
import { SearchSessions, SearchRestriction, searchDomain } from './fixtures/core-host.ts'
import { installSearch } from '../src/host/runtime.ts'
import { resolveSettings } from '../src/settings/resolve.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function presetHost() {
  const root = await mkdtemp(join(tmpdir(), 'search-agent-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(process.cwd() + '/').href
  await ctx.plugin(Loader)
  // rc.1 testkit still works on rc.2 after supplying the new public projection dependency.
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await mountWebSettings(ctx, root)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const domain = await ctx.storageDomain.open(searchDomain)
  await domain.table('selections').put('off', { connectionId: null, revision: 1 })
  await domain.table('selections').put('off-other', { connectionId: null, revision: 1 })
  await domain.close()
  await ctx.plugin(AgentPresets, { default: 'standard' })
  // The same tool-web contribution as Web's standard preset, mounted by the real registry/Loader.
  ctx.loader.builtins.webForTest = ToolWeb
  await ctx.agentPresets.register({ id: 'standard', plugins: [{ id: 'tool-web', name: 'cordis:webForTest' }] })
  expect(await ctx.agentPresets.resolve()).toEqual({ id: 'standard' })
  const plugin = await ctx.plugin({ inject: ['web'], apply: (scope: Context) => installSearch(scope, () => resolveSettings({})) })
  const create = (id: string, parent?: string) => ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'fixture' },
    ...(parent === undefined ? {} : { meta: { parentSession: SessionId(parent), isSeeded: true }, inheritedEventCount: SessionLogOffset(0), seed: [] }),
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
  })
  return { ctx, plugin, create }
}

it('hides an ancestor Web preset tool from only the off Agent, never relying on the root view', async () => {
  const { ctx, plugin, create } = await presetHost()
  const off = await create('off')
  const on = await create('on')
  cleanups.push(() => off.dispose(), () => on.dispose())
  const offScope = scopeOf(off.agent.ctx)!
  const onScope = scopeOf(on.agent.ctx)!
  expect(scopeParentOf(offScope)).toBe(scopeParentOf(onScope))
  expect(scopeParentOf(offScope)).toBeDefined()
  expect(ctx.tools.get('web_search')).toBeUndefined()
  expect(ctx.tools.get('web_search', onScope)).toBeDefined()
  expect(ctx.tools.get('web_search', offScope)).toBeUndefined()
  expect(ctx.tools.schemas(offScope).map(schema => schema.name)).toEqual(['web_fetch'])
  expect(ctx.tools.schemas(onScope).map(schema => schema.name)).toEqual(['web_search', 'web_fetch'])
  await expect(ctx.agents.withInitiator(off.agent, () => ctx.web.search({ query: 'off' }))).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  await ctx.settings.update('web', { searchProvider: 'other-provider' })
  // Schemas are assembled before agent/request: the old Agent must already be visible.
  expect(ctx.tools.get('web_search', offScope)).toBeDefined()
  const elsewhere = await create('off-other')
  cleanups.push(() => elsewhere.dispose())
  expect(ctx.tools.get('web_search', scopeOf(elsewhere.agent.ctx))).toBeDefined()
  // Later capture keeps the already-lifted policy unchanged.
  await ctx.waterfall('agent/request', { agent: off.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  expect(ctx.tools.get('web_search', offScope)).toBeDefined()
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  await ctx.waterfall('agent/request', { agent: off.agent, turn: 1, step: 1, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  expect(ctx.tools.get('web_search', offScope)).toBeUndefined()
  await plugin.dispose()
  expect(ctx.tools.get('web_search', offScope)).toBeDefined()
  expect(ctx.tools.get('web_search')).toBeUndefined()
})

it('a seeded fork inherits off before its first request assembles tools', async () => {
  const { ctx, create } = await presetHost()
  const fork = await create('off-fork', 'off')
  cleanups.push(() => fork.dispose())
  expect(ctx.tools.schemas(scopeOf(fork.agent.ctx)).map(schema => schema.name)).not.toContain('web_search')
})

it('forget explicitly lifts a live Agent restriction', async () => {
  const { ctx, create } = await presetHost()
  const handle = await create('forget')
  cleanups.push(() => handle.dispose())
  const restriction = new SearchRestriction(ctx)
  restriction.sync(handle.agent, null)
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeUndefined()
  restriction.forget(handle.agent)
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeDefined()
})

it('plugin disposal prevents a pending capture from reinstalling tool restrictions', async () => {
  const { ctx, plugin, create } = await presetHost()
  const handle = await create('off')
  cleanups.push(() => handle.dispose())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  // oxlint-disable-next-line typescript/unbound-method -- Forwarded below with the original receiver via call.
  const read = SearchSessions.prototype.current
  const current = vi.spyOn(SearchSessions.prototype, 'current')
  // Forward the real JSON-backed read unchanged; the barrier only delays its continuation.
  current.mockImplementation(async function (this: SearchSessions, agent) {
    const result = await read.call(this, agent)
    entered.resolve()
    await release.promise
    return result
  })
  const pending = ctx.waterfall('agent/request', { agent: handle.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  try {
    await entered.promise
    await plugin.dispose()
  } finally {
    release.resolve()
  }
  await pending
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeDefined()
})

it('plugin disposal prevents a pending Remote write from reinstalling tool restrictions', async () => {
  const { ctx, plugin, create } = await presetHost()
  await mountRemote(ctx)
  const handle = await create('pending-write')
  cleanups.push(() => handle.dispose())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  // oxlint-disable-next-line typescript/unbound-method -- Forwarded below with the original receiver via call.
  const write = Pairings.prototype.set
  const pairing = vi.spyOn(Pairings.prototype, 'set')
  // Forward both actual session and pairing writes; pause only the final write acknowledgement.
  pairing.mockImplementation(async function (this: Pairings, model, connectionId) {
    await write.call(this, model, connectionId)
    entered.resolve()
    await release.promise
  })
  const pending = ctx.searchConnections.set({ sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 })
  try {
    await entered.promise
    await plugin.dispose()
  } finally {
    release.resolve()
  }
  await pending
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeDefined()
})

/** Real public Settings data over a disposable profile; the Web service is not mocked. */
async function mountWebSettings(ctx: Context, root: string): Promise<void> {
  const requireSettings = createRequire(import.meta.resolve('@deepseek-ai/dsh-settings'))
  const editorPath = requireSettings.resolve('@deepseek-ai/dsh-config-editor')
  const { default: ConfigEditor } = await import(pathToFileURL(editorPath).href) as { default: Plugin }
  const requireEditor = createRequire(editorPath)
  const boot = await import(pathToFileURL(requireEditor.resolve('@deepseek-ai/dsh-app-boot')).href) as {
    initProfile(dir: string, bundles: string[]): void
    readProfilePatches(bin: string, profile: object): PatchOptions[]
    mountRootInclude(ctx: Context, path: string, patches: PatchOptions[]): Promise<unknown>
  }
  const dir = join(root, 'profile')
  boot.initProfile(dir, [])
  const profile = { name: 'test', startedBundles: [], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(root, 'package.json'), cwd: root, home: root, overlays: [], telemetryDisabledEnv: undefined }
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'search-agent-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [{ id: 'web', name: 'cordis:webRuntimeForTest', config: { searchProvider: SEARCH.providerId } }] }]))
  ctx.provide('profileContext', profile)
  ctx.loader.builtins.webRuntimeForTest = WebRuntime
  await ctx.plugin(ConfigEditor)
  await ctx.plugin(Settings)
  await boot.mountRootInclude(ctx, join(dir, 'cordis.yml'), boot.readProfilePatches('dsh', profile))
  await ctx.loader.await()
}

/** Only the model transport is scripted; the loop assembles and logs the real request. */
class TextAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'done' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function mountRemote(ctx: Context) {
  await ctx.plugin(TypertRegistry)
  // Search never performs uploads; retain only the public peripheral resolver registration.
  const uploadResolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    uploadResolvers.add(resolver)
    return () => { uploadResolvers.delete(resolver) }
  } } as never)
  void new SessionController(ctx, { nativeOpen: false })
  await ctx.fiber.await()
}

it('the real loop omits web_search in the next request header after off and restores it after on', async () => {
  const { ctx, create } = await presetHost()
  await mountRemote(ctx)
  const adapter = new TextAdapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const handle = await create('loop')
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  const send = async () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  await send()
  expect(adapter.requests).toHaveLength(1)
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).toContain('web_search')
  await ctx.searchConnections.set({ sessionId: agent.id, connectionId: null, expectedRevision: 0 })
  expect(ctx.tools.get('web_search', scopeOf(agent.ctx))).toBeUndefined()
  await send()
  expect(adapter.requests).toHaveLength(2)
  expect(adapter.requests[1]!.tools!.map(tool => tool.name)).not.toContain('web_search')
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).not.toContain('web_search')
  await ctx.searchConnections.set({ sessionId: agent.id, connectionId: 'builtin:openalex', expectedRevision: 1 })
  expect(ctx.tools.get('web_search', scopeOf(agent.ctx))).toBeDefined()
  await send()
  expect(adapter.requests).toHaveLength(3)
  expect(adapter.requests[2]!.tools!.map(tool => tool.name)).toContain('web_search')
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).toContain('web_search')
})
