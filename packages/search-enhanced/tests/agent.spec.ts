/** Real rc.2 Agents and Web preset ancestry; scripted model transport, no timer-based synchronization. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { assembleContextFor, installModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { LlmAdapter, ToolCallId, createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import WebRuntime from '@deepseek-ai/dsh-web'
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import { SEARCH, FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { installFetch as installOtherCapability } from '../../fetch-enhanced/src/host/runtime.ts'
import { resolveSettings as resolveOtherSettings } from '../../fetch-enhanced/src/settings/resolve.ts'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { MODEL_SETTINGS_NS, modelServer, modelSettingsPlugin } from './fixtures/model-host.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Pairings } from 'dsh-tool-web-enhanced-core/host'
import { SearchSessions, SearchRestriction, searchDomain } from './fixtures/core-host.ts'
import { installSearch } from '../src/host/runtime.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import type { SearchSettings } from '../src/settings/types.ts'
import { shippedWebPreset, mountPtcRuntime } from '../../core/tests/fixtures/shipped-preset.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function presetHost(routes: Record<string, unknown> = {}, options: { enhancedTools?: boolean; preset?: 'standard' | 'minimal' | 'ptc' } = {}) {
  let document: SearchSettings = { enhancedTools: options.enhancedTools ?? false, connections: { 'builtin:openalex': { disabled: false } } }
  const root = await mkdtemp(join(tmpdir(), 'search-agent-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: { ROUTE_KEY: 'agent-fixture-key' } }]))
  cleanups.push(() => ctx.fiber.dispose())
  ctx.baseUrl = pathToFileURL(process.cwd() + '/').href
  await ctx.plugin(Loader)
  // rc.1 testkit still works on rc.2 after supplying the new public projection dependency.
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await mountWebSettings(ctx, root, routes)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const domain = await ctx.storageDomain.open(searchDomain)
  await domain.table('selections').put('off', { connectionId: null, revision: 1 })
  await domain.table('selections').put('off-other', { connectionId: null, revision: 1 })
  await domain.close()
  const preset = options.preset ?? 'standard'
  if (preset === 'ptc') await mountPtcRuntime(ctx, root)
  await ctx.plugin(AgentPresets, { default: preset })
  // The same tool-web contribution as Web's standard preset, mounted by the real registry/Loader.
  ctx.loader.builtins.webForTest = ToolWeb
  if (options.preset === undefined) await ctx.agentPresets.register({ id: 'standard', plugins: [{ id: 'tool-web', name: 'cordis:webForTest' }] })
  else await shippedWebPreset(ctx, preset)
  expect(await ctx.agentPresets.resolve()).toEqual({ id: preset })
  const plugin = await ctx.plugin({ inject: ['web'], apply: (scope: Context) => installSearch(scope, () => resolveSettings(document)) })
  const create = (id: string, parent?: string) => ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'fixture' },
    ...(parent === undefined ? {} : { meta: { parentSession: SessionId(parent), isSeeded: true }, inheritedEventCount: SessionLogOffset(0), seed: [] }),
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
  })
  const configure = async (value: SearchSettings) => {
    document = value
    await ctx.parallel('settings/document-updated', SEARCH.rowId as SettingsNamespace, 1)
  }
  return { ctx, plugin, create, configure }
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
async function mountWebSettings(ctx: Context, root: string, routes: Record<string, unknown>): Promise<void> {
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
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [
    { id: 'web', name: 'cordis:webRuntimeForTest', config: { searchProvider: SEARCH.providerId } },
    { id: MODEL_SETTINGS_NS, name: 'cordis:modelSettingsFixture', config: { routes } },
  ] }]))
  ctx.provide('profileContext', profile)
  ctx.loader.builtins.webRuntimeForTest = WebRuntime
  ctx.loader.builtins.modelSettingsFixture = modelSettingsPlugin
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

/** Script only the provider transport; every web_search is dispatched by the real Agent loop. */
class SearchAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly entered = Promise.withResolvers<void>()
  readonly release = Promise.withResolvers<void>()
  override resolveModel(provider: string, model: string) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async * stream(request: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(request)
    if (this.requests.length === 1) {
      this.entered.resolve()
      await this.release.promise
    }
    if (this.requests.length % 2 === 1) {
      const block = { type: 'tool-call' as const, id: ToolCallId('search-' + String(this.requests.length)), name: 'web_search', arguments: JSON.stringify({ queries: ['fixture search'] }) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

it('a real Web preset Agent follows A then B, rejects an unsupported next model, and never changes the search selection', async () => {
  const api = await modelServer()
  cleanups.push(api.close)
  const { ctx, create } = await presetHost({ fixture: {
    api: 'anthropic-messages', apiKeyEnv: 'ROUTE_KEY', models: [
      { id: 'model-a', baseURL: api.url + '/a' },
      { id: 'model-b', baseURL: api.url + '/b' },
      { id: 'unsupported', api: 'google-generative-ai', baseURL: api.url + '/never' },
    ],
  } })
  await mountRemote(ctx)
  const adapter = new SearchAdapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  ctx.llm.registerConfigurableProviders([{ provider: 'fixture', displayName: 'Fixture model transport', settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', 'fixture'] }])
  const handle = await create('follow-model')
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
  // Same public installer used by SessionController; no route fields are copied into search plans.
  const disposeSelection = installModelSelection(agent.ctx, selection)
  cleanups.push(async () => { disposeSelection() })
  const select = (model: string) => {
    selection.current = { provider: 'fixture', model }
    agent.session.append('model/selection', selection.current)
  }
  const results: ToolExecutionResult[] = []
  agent.ctx.on('tools/result', (exec, result) => { if (exec.name === 'web_search') results.push(result) })
  await ctx.searchConnections.set({ sessionId: agent.id, connectionId: 'builtin:session-model', expectedRevision: 0 })
  select('model-a')
  const send = () => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'search now' }], source: { kind: 'user' } }))
    return agent.whenIdle()
  }
  const first = send()
  try {
    await adapter.entered.promise
    expect(agent.session.requestContext()).toMatchObject({ provider: 'fixture', model: 'model-a' })
    // A queued switch changes menu readiness, never this already resolved call.
    select('model-b')
  } finally { adapter.release.resolve() }
  await first
  expect(api.calls).toMatchObject([{ path: '/a/v1/messages', headers: { 'x-api-key': 'agent-fixture-key' }, body: { model: 'model-a' } }])
  expect(results).toMatchObject([{ isError: false }])
  await send()
  expect(api.calls).toMatchObject([
    { path: '/a/v1/messages', body: { model: 'model-a' } },
    { path: '/b/v1/messages', body: { model: 'model-b' } },
  ])
  expect(agent.session.requestContext()).toMatchObject({ provider: 'fixture', model: 'model-b' })
  select('unsupported')
  const unsupportedView = await ctx.searchConnections.get({ sessionId: agent.id })
  expect(unsupportedView.connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ status: 'unsupported', reason: 'protocol' })
  await send()
  expect(results).toHaveLength(3)
  expect(results[2]).toMatchObject({ isError: true, error: { info: { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }, message: 'dsh-web-search-enhanced: the session model cannot run web search: the route does not declare a supported protocol; choose another search connection' } })
  expect(api.calls).toHaveLength(2)
  expect((await ctx.searchConnections.get({ sessionId: agent.id })).selection).toMatchObject({ connectionId: 'builtin:session-model', revision: 1 })
  expect(adapter.requests).toHaveLength(6)
  expect(adapter.requests[5]!.messages.filter(message => message.role === 'tool').at(-1)).toMatchObject({ isError: true })
})

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

const enhancedNames = [SEARCH.tools.action, SEARCH.tools.list]

it.each(['standard', 'minimal'] as const)('offers real enhanced definitions through the shipped %s Web preset seam', async preset => {
  const { ctx, create } = await presetHost({}, { enhancedTools: true, preset })
  const handle = await create('enhanced-' + preset)
  cleanups.push(() => handle.dispose())
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  for (const name of enhancedNames) expect(assembly.tools.map(tool => tool.name)).toContain(name)
  expect(assembly.tools.some(tool => tool.name === 'web_search')).toBe(preset === 'standard')
})

it.each(['elsewhere', 'auto', ''])('removes enhanced tools on an unconfirmed route (%s) and restores authorized conversations', async route => {
  const { ctx, create } = await presetHost({}, { enhancedTools: true })
  const handle = await create('route-enhanced')
  cleanups.push(() => handle.dispose())
  const scope = scopeOf(handle.agent.ctx)!
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeDefined()
  await ctx.settings.update('web', { searchProvider: route })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeUndefined()
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeDefined()
})

it('does not backfill old conversations when enhanced tools are enabled later', async () => {
  const { ctx, create, configure } = await presetHost()
  const old = await create('before-enhanced')
  cleanups.push(() => old.dispose())
  await configure({ enhancedTools: true })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scopeOf(old.agent.ctx))).toBeUndefined()
  const fresh = await create('after-enhanced')
  cleanups.push(() => fresh.dispose())
  for (const name of enhancedNames) expect(ctx.tools.get(name, scopeOf(fresh.agent.ctx))).toBeDefined()
})

it('the real loop removes enhanced tools from the next request after switch-off and Session off', async () => {
  const { ctx, create, configure } = await presetHost({}, { enhancedTools: true })
  await mountRemote(ctx)
  const adapter = new TextAdapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const handle = await create('enhanced-loop')
  cleanups.push(() => handle.dispose())
  const send = async () => {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    return (adapter.requests.at(-1)!.tools ?? []).map(tool => tool.name)
  }
  for (const name of enhancedNames) expect(await send()).toContain(name)
  await configure({ enhancedTools: false })
  for (const name of enhancedNames) expect(await send()).not.toContain(name)
  await configure({ enhancedTools: true })
  for (const name of enhancedNames) expect(await send()).toContain(name)
  await ctx.searchConnections.set({ sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 })
  const off = await send()
  for (const name of enhancedNames) expect(off).not.toContain(name)
  expect(off).not.toContain('web_search')
})

it.each([false, true])('inherits the provider list into a child before its first model assembly (fork=%s)', async fork => {
  const { ctx, create } = await presetHost({}, { enhancedTools: true })
  const parent = await create('enhanced-parent')
  cleanups.push(() => parent.dispose())
  const child = await ctx.agents.create({
    sessionId: SessionId('enhanced-child'), parentAgent: parent.agent,
    meta: { parentSession: parent.agent.id, origin: 'subagent', isSeeded: fork },
    ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
    setup: scope => { ctx.agentPresets.composeFrom(scope, parent.agent.ctx) },
  })
  cleanups.push(() => child.dispose())
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(child.agent, new AbortController().signal))
  for (const name of enhancedNames) expect(assembly.tools.map(tool => tool.name)).toContain(name)
})

it('includes both enhanced definitions in the shipped PTC SDK, never as direct model functions', async () => {
  const preset = 'ptc'
  const { ctx, create } = await presetHost({}, { enhancedTools: true, preset })
  const handle = await create('enhanced-ptc')
  cleanups.push(() => handle.dispose())
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
  const sdk = assembly.sections.find(section => section.name === 'tools:sdk')!.text
  for (const name of enhancedNames) expect(sdk).toContain(name)
  const outputMap = sdk.slice(sdk.indexOf('interface ToolOutputMap'))
  const outputType = (name: string) => outputMap.match(new RegExp('^  ' + name + ': ([\\s\\S]*?)(?=^  [A-Za-z_]|^\\})', 'mu'))![1]!
  expect(outputType(SEARCH.tools.action)).toContain('provider: string;')
  expect(outputType(SEARCH.tools.list)).toContain('sessionProviderTurnedOff: boolean;')
})

it('unloading this plugin removes only its enhanced pair, not the other capability', async () => {
  const { ctx, plugin, create } = await presetHost({}, { enhancedTools: true })
  await ctx.settings.update('web', { fetchProvider: FETCH.providerId })
  await ctx.plugin({ inject: ['web'], apply(scope: Context) { installOtherCapability(scope, () => resolveOtherSettings({ enhancedTools: true })) } })
  const handle = await create('both-capabilities')
  cleanups.push(() => handle.dispose())
  const scope = scopeOf(handle.agent.ctx)!
  for (const name of [...enhancedNames, FETCH.tools.action, FETCH.tools.list]) expect(ctx.tools.get(name, scope)).toBeDefined()
  await plugin.dispose()
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeUndefined()
  for (const name of [FETCH.tools.action, FETCH.tools.list]) expect(ctx.tools.get(name, scope)).toBeDefined()
})
