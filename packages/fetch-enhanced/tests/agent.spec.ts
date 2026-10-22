/** Real rc.2 Agents and Web preset ancestry; scripted model transport, no timer-based synchronization. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { assembleContextFor } from '@deepseek-ai/dsh-agent'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Settings, { type SettingsNamespace } from '@deepseek-ai/dsh-settings'
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
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { installSearch as installOtherCapability } from '../../search-enhanced/src/host/runtime.ts'
import { resolveSettings as resolveOtherSettings } from '../../search-enhanced/src/settings/resolve.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { Pairings, Sessions, SessionStorage, ToolRestriction, routeFacts } from 'dsh-tool-web-enhanced-core/host'
import { installFetch } from '../src/host/runtime.ts'
import { optionsCodec, type FetchOptions } from '../src/host/options.ts'
import type { FetchSettings, ResolvedSettings } from '../src/settings/types.ts'
import { resolveSettings } from '../src/settings/resolve.ts'
import { shippedWebPreset, mountPtcRuntime } from '../../core/tests/fixtures/shipped-preset.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function presetHost(initial: FetchSettings = {}, preset: 'standard' | 'minimal' | 'ptc' = 'standard', shipped = false) {
  let settings = resolveSettings(initial)
  const configure = (value: FetchSettings) => { settings = resolveSettings(value) }
  const root = await mkdtemp(join(tmpdir(), 'fetch-agent-'))
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
  const storage = new SessionStorage(ctx, 'web_fetch_enhanced', optionsCodec)
  const domain = await storage.domain()
  await domain.table('selections').put('off', { connectionId: null, revision: 1 })
  await domain.table('selections').put('off-other', { connectionId: null, revision: 1 })
  await domain.close()
  if (preset === 'ptc') await mountPtcRuntime(ctx, root)
  await ctx.plugin(AgentPresets, { default: preset })
  // The same tool-web contribution as Web's standard preset, mounted by the real registry/Loader.
  ctx.loader.builtins.webForTest = ToolWeb
  if (shipped) await shippedWebPreset(ctx, preset)
  else await ctx.agentPresets.register({ id: 'standard', plugins: [{ id: 'tool-web', name: 'cordis:webForTest' }] })
  expect(await ctx.agentPresets.resolve()).toEqual({ id: preset })
  const plugin = await ctx.plugin({ inject: ['web'], apply: (scope: Context) => { installFetch(scope, () => settings) } })
  const create = (id: string, parent?: string) => ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'fixture' },
    ...(parent === undefined ? {} : { meta: { parentSession: SessionId(parent), isSeeded: true }, inheritedEventCount: SessionLogOffset(0), seed: [] }),
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
  })
  const update = async (value: FetchSettings) => {
    configure(value)
    await ctx.parallel('settings/document-updated', FETCH.rowId as SettingsNamespace, 1)
  }
  return { ctx, plugin, create, configure, update }
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
  expect(ctx.tools.get('web_fetch')).toBeUndefined()
  expect(ctx.tools.get('web_fetch', onScope)).toBeDefined()
  expect(ctx.tools.get('web_fetch', offScope)).toBeUndefined()
  expect(ctx.tools.schemas(offScope).map(schema => schema.name)).toEqual(['web_search'])
  expect(ctx.tools.schemas(onScope).map(schema => schema.name)).toEqual(['web_search', 'web_fetch'])
  await expect(ctx.agents.withInitiator(off.agent, () => ctx.web.fetch({ url: 'https://example.com/off' }))).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  await ctx.settings.update('web', { fetchProvider: 'other-provider' })
  // Schemas are assembled before agent/request: the old Agent must already be visible.
  expect(ctx.tools.get('web_fetch', offScope)).toBeDefined()
  const elsewhere = await create('off-other')
  cleanups.push(() => elsewhere.dispose())
  expect(ctx.tools.get('web_fetch', scopeOf(elsewhere.agent.ctx))).toBeDefined()
  // Later capture keeps the already-lifted policy unchanged.
  await ctx.waterfall('agent/request', { agent: off.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  expect(ctx.tools.get('web_fetch', offScope)).toBeDefined()
  await ctx.settings.update('web', { fetchProvider: FETCH.providerId })
  // Routing back must reapply the restriction before another request captures a plan.
  expect(ctx.tools.get('web_fetch', offScope)).toBeUndefined()
  await ctx.waterfall('agent/request', { agent: off.agent, turn: 1, step: 1, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  expect(ctx.tools.get('web_fetch', offScope)).toBeUndefined()
  await plugin.dispose()
  expect(ctx.tools.get('web_fetch', offScope)).toBeDefined()
  expect(ctx.tools.get('web_fetch')).toBeUndefined()
})

it('a seeded fork inherits off before its first request assembles tools', async () => {
  const { ctx, create } = await presetHost()
  const fork = await create('off-fork', 'off')
  cleanups.push(() => fork.dispose())
  expect(ctx.tools.schemas(scopeOf(fork.agent.ctx)).map(schema => schema.name)).not.toContain('web_fetch')
})

it('forget explicitly lifts a live Agent restriction', async () => {
  const { ctx, create } = await presetHost()
  const handle = await create('forget')
  cleanups.push(() => handle.dispose())
  const restriction = new ToolRestriction(ctx, { tool: 'web_fetch', routed: () => routeFacts(ctx, 'fetchProvider', FETCH.providerId).kind === 'this' })
  restriction.sync(handle.agent, null)
  expect(ctx.tools.get('web_fetch', scopeOf(handle.agent.ctx))).toBeUndefined()
  restriction.forget(handle.agent)
  expect(ctx.tools.get('web_fetch', scopeOf(handle.agent.ctx))).toBeDefined()
})

it('plugin disposal prevents a pending capture from reinstalling tool restrictions', async () => {
  const { ctx, plugin, create } = await presetHost()
  const handle = await create('off')
  cleanups.push(() => handle.dispose())
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  // oxlint-disable-next-line typescript/unbound-method -- Forwarded below with the original receiver via call.
  const read = Sessions.prototype.current
  const current = vi.spyOn(Sessions.prototype, 'current')
  // Forward the real JSON-backed read unchanged; the barrier only delays its continuation.
  current.mockImplementation(async function (this: Sessions<FetchOptions, ResolvedSettings>, agent) {
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
  expect(ctx.tools.get('web_fetch', scopeOf(handle.agent.ctx))).toBeDefined()
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
  const pending = ctx.fetchConnections.set({ sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 })
  try {
    await entered.promise
    await plugin.dispose()
  } finally {
    release.resolve()
  }
  await pending
  expect(ctx.tools.get('web_fetch', scopeOf(handle.agent.ctx))).toBeDefined()
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
  await writeFile(profile.installAnchor, JSON.stringify({ name: 'fetch-agent-test' }))
  await writeFile(join(dir, 'cordis.yml'), '[]')
  await writeFile(profile.patchPath, JSON.stringify([{ insert: [{ id: 'web', name: 'cordis:webRuntimeForTest', config: { fetchProvider: FETCH.providerId } }] }]))
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
  // Fetch never performs uploads; retain only the public peripheral resolver registration.
  const uploadResolvers = new Set<unknown>()
  ctx.provide('fileUploads', { registerAgentResolver: (resolver: unknown) => {
    uploadResolvers.add(resolver)
    return () => { uploadResolvers.delete(resolver) }
  } } as never)
  void new SessionController(ctx, { nativeOpen: false })
  await ctx.fiber.await()
}

it('the real loop omits web_fetch in the next request header after off and restores it after on', async () => {
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
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).toContain('web_fetch')
  await ctx.fetchConnections.set({ sessionId: agent.id, connectionId: null, expectedRevision: 0 })
  expect(ctx.tools.get('web_fetch', scopeOf(agent.ctx))).toBeUndefined()
  await send()
  expect(adapter.requests).toHaveLength(2)
  expect(adapter.requests[1]!.tools!.map(tool => tool.name)).not.toContain('web_fetch')
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).not.toContain('web_fetch')
  await ctx.fetchConnections.set({ sessionId: agent.id, connectionId: 'builtin:local', expectedRevision: 1 })
  expect(ctx.tools.get('web_fetch', scopeOf(agent.ctx))).toBeDefined()
  await send()
  expect(adapter.requests).toHaveLength(3)
  expect(adapter.requests[2]!.tools!.map(tool => tool.name)).toContain('web_fetch')
  expect(agent.session.requestHeader()!.tools!.map(tool => tool.name)).toContain('web_fetch')
})

/** Read only the latest retained context, not superseded notices in the conversation history. */
function currentContext(request: GenerateOptions): string {
  const snapshots = request.messages.flatMap(message => {
    // The loop's runtime-context kind is not re-exported from its public type entrypoint.
    const source: { readonly kind: string } | undefined = message.source
    if (source?.kind !== 'runtime-context') return []
    return [message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')]
  })
  return snapshots.at(-1) ?? ''
}

it('the real loop refreshes the allowlist notice for this step, current local settings, and route', async () => {
  const allowed = (cidr: string): FetchSettings => ({ version: 2, connections: { 'builtin:deepseek-fetch-api': { disabled: false }, 'builtin:local': { options: { allowCidrs: [cidr], allowHostnames: ['internal.example'] } } } })
  const { ctx, create, configure } = await presetHost(allowed('198.18.0.0/15'))
  await mountRemote(ctx)
  // Keep a real snapshot present when the optional allowlist contribution disappears.
  ctx.systemPrompt.context({ name: 'fixture:base', order: 0, text: 'Fixture context.' })
  const adapter = new TextAdapter()
  ctx.llm.registerAdapter(['fixture'], adapter)
  const handle = await create('notice-loop')
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  const send = async () => {
    const before = adapter.requests.length
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(adapter.requests).toHaveLength(before + 1)
    return currentContext(adapter.requests.at(-1)!)
  }
  const select = (connectionId: string | null, expectedRevision: number) => ctx.fetchConnections.set({ sessionId: agent.id, connectionId, expectedRevision })

  expect(await send()).toContain('198.18.0.0/15')
  expect(currentContext(adapter.requests[0]!)).toContain('internal.example')
  await select('builtin:deepseek-fetch-api', 0)
  expect(await send()).not.toContain('The operator has authorized web_fetch')
  await select('builtin:local', 1)
  expect(await send()).toContain('198.18.0.0/15')
  await select(null, 2)
  expect(await send()).not.toContain('The operator has authorized web_fetch')
  await select('builtin:local', 3)
  expect(await send()).toContain('198.18.0.0/15')

  // Connection identity is frozen; policy parameters remain live between requests.
  configure({})
  expect(await send()).not.toContain('The operator has authorized web_fetch')
  configure(allowed('10.0.0.0/8'))
  expect(await send()).toContain('10.0.0.0/8')
  expect(currentContext(adapter.requests.at(-1)!)).not.toContain('198.18.0.0/15')
  await ctx.settings.update('web', { fetchProvider: 'other-provider' })
  expect(await send()).not.toContain('The operator has authorized web_fetch')
  await ctx.settings.update('web', { fetchProvider: FETCH.providerId })
  expect(await send()).toContain('10.0.0.0/8')
})

it('uses the public assembly Agent when no initiating Agent exists, not the global default', async () => {
  const { ctx, create } = await presetHost({
    version: 2,
    defaultConnection: 'builtin:deepseek-fetch-api',
    connections: { 'builtin:local': { options: { allowCidrs: ['198.18.0.0/15'] } } },
  })
  await mountRemote(ctx)
  const handle = await create('assembly-agent')
  cleanups.push(() => handle.dispose())
  await ctx.fetchConnections.set({ sessionId: handle.agent.id, connectionId: 'builtin:local', expectedRevision: 0 })
  await ctx.waterfall('agent/request', { agent: handle.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'fixture', model: 'fixture' })) as never)
  expect(ctx.agents.currentInitiator()).toBeUndefined()
  const scoped = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent))
  expect(scoped.contexts.find(context => context.name === 'web-fetch-enhanced:allowlist')!.text).toContain('198.18.0.0/15')
  const global = await ctx.systemPrompt.assemble()
  expect(global.contexts.find(context => context.name === 'web-fetch-enhanced:allowlist')!.text).toBe('')
})

const enhancedNames = [FETCH.tools.action, FETCH.tools.list]

it.each(['standard', 'minimal'] as const)('offers real enhanced definitions through the shipped %s Web preset seam', async preset => {
  const { ctx, create } = await presetHost({ enhancedTools: true }, preset, true)
  const handle = await create('enhanced-' + preset)
  cleanups.push(() => handle.dispose())
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  for (const name of enhancedNames) expect(assembly.tools.map(tool => tool.name)).toContain(name)
  expect(assembly.tools.some(tool => tool.name === 'web_fetch')).toBe(preset === 'standard')
})

it.each(['elsewhere', 'auto', ''])('removes enhanced tools on an unconfirmed route (%s) and restores authorized conversations', async route => {
  const { ctx, create } = await presetHost({ enhancedTools: true })
  const handle = await create('route-enhanced')
  cleanups.push(() => handle.dispose())
  const scope = scopeOf(handle.agent.ctx)!
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeDefined()
  await ctx.settings.update('web', { fetchProvider: route })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeUndefined()
  await ctx.settings.update('web', { fetchProvider: FETCH.providerId })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeDefined()
})

it('does not backfill old conversations when enhanced tools are enabled later', async () => {
  const { ctx, create, update } = await presetHost()
  const old = await create('before-enhanced')
  cleanups.push(() => old.dispose())
  await update({ enhancedTools: true })
  for (const name of enhancedNames) expect(ctx.tools.get(name, scopeOf(old.agent.ctx))).toBeUndefined()
  const fresh = await create('after-enhanced')
  cleanups.push(() => fresh.dispose())
  for (const name of enhancedNames) expect(ctx.tools.get(name, scopeOf(fresh.agent.ctx))).toBeDefined()
})

it('the real loop removes enhanced tools from the next request after switch-off and Session off', async () => {
  const { ctx, create, update } = await presetHost({ enhancedTools: true })
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
  await update({ enhancedTools: false })
  for (const name of enhancedNames) expect(await send()).not.toContain(name)
  await update({ enhancedTools: true })
  for (const name of enhancedNames) expect(await send()).toContain(name)
  await ctx.fetchConnections.set({ sessionId: handle.agent.id, connectionId: null, expectedRevision: 0 })
  const off = await send()
  for (const name of enhancedNames) expect(off).not.toContain(name)
  expect(off).not.toContain('web_fetch')
})

it.each([false, true])('inherits the provider list into a child before its first model assembly (fork=%s)', async fork => {
  const { ctx, create } = await presetHost({ enhancedTools: true })
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
  const { ctx, create } = await presetHost({ enhancedTools: true }, preset, true)
  const handle = await create('enhanced-ptc')
  cleanups.push(() => handle.dispose())
  const assembly = await ctx.systemPrompt.assemble(assembleContextFor(handle.agent, new AbortController().signal))
  expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
  const sdk = assembly.sections.find(section => section.name === 'tools:sdk')!.text
  for (const name of enhancedNames) expect(sdk).toContain(name)
  const outputMap = sdk.slice(sdk.indexOf('interface ToolOutputMap'))
  const outputType = (name: string) => outputMap.match(new RegExp('^  ' + name + ': ([\\s\\S]*?)(?=^  [A-Za-z_]|^\\})', 'mu'))![1]!
  expect(outputType(FETCH.tools.action)).toContain('provider: string;')
  expect(outputType(FETCH.tools.list)).toContain('sessionProviderTurnedOff: boolean;')
})

it('unloading this plugin removes only its enhanced pair, not the other capability', async () => {
  const { ctx, plugin, create } = await presetHost({ enhancedTools: true })
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  await ctx.plugin({ inject: ['web'], apply(scope: Context) { installOtherCapability(scope, () => resolveOtherSettings({ enhancedTools: true })) } })
  const handle = await create('both-capabilities')
  cleanups.push(() => handle.dispose())
  const scope = scopeOf(handle.agent.ctx)!
  for (const name of [...enhancedNames, SEARCH.tools.action, SEARCH.tools.list]) expect(ctx.tools.get(name, scope)).toBeDefined()
  await plugin.dispose()
  for (const name of enhancedNames) expect(ctx.tools.get(name, scope)).toBeUndefined()
  for (const name of [SEARCH.tools.action, SEARCH.tools.list]) expect(ctx.tools.get(name, scope)).toBeDefined()
})
