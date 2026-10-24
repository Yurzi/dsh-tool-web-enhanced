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
import { SessionId, SessionLogOffset, type SessionStore } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Projections from '@deepseek-ai/dsh-session-projection'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import WebRuntime from '@deepseek-ai/dsh-web'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { SEARCH, selectionContract, type ConnectionView } from '../src/shared/index.ts'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { afterEach, expect, it, vi } from 'vitest'
import { inertEnhanced } from './fixtures/enhanced.ts'
import { installCapability, liveSession, Pairings, Sessions, SessionStorage, ToolRestriction, selectionDomain, routeFacts, type Capability, type OptionsCodec } from '../src/host/index.ts'

const domainName = 'core_restriction'
const searchDomain = selectionDomain(domainName)
const initialSettings = () => ({ defaultConnection: 'builtin:test', enhancedTools: false, connections: new Map([['builtin:test', { id: 'builtin:test', label: 'Test', kind: 'native' as const, disabled: false }]]) })
type SettingsValue = ReturnType<typeof initialSettings>
const optionsCodec: OptionsCodec<Record<string, never>, SettingsValue> = { initial: () => ({}), fromRecord: () => ({}), toRecord: () => ({}) }

function installFixture(ctx: Context, settings: () => SettingsValue = initialSettings): void {
  const capability: Capability<SettingsValue, Record<string, never>, ConnectionView, string, WebSearchRequest, WebSearchResult> = {
    identity: SEARCH, tool: 'web_search', field: 'searchProvider',
    remoteNamespace: 'coreRestriction', storageDomain: domainName, optionsCodec, settings,
    contract: selectionContract({ namespace: 'coreRestriction', packageName: SEARCH.packageName, options: {}, extras: {} }),
    describe: async () => [],
    target: connection => connection.id,
    execute: async () => ({ sources: [], truncated: false }),
    register: (scope, search) => { scope.web.registerSearchProvider({ id: SEARCH.providerId, available: () => true, search }) },
    enhanced: inertEnhanced(SEARCH.tools),
  }
  installCapability(ctx, capability)
}

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function presetHost(persistence = false) {
  let settings = initialSettings()
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
  if (persistence) await ctx.plugin(SessionPersistenceJsonl, { root: join(root, 'sessions'), compression: 'none' })
  const domain = await ctx.storageDomain.open(searchDomain)
  await domain.table('selections').put('off', { connectionId: null, revision: 1 })
  await domain.table('selections').put('off-other', { connectionId: null, revision: 1 })
  await domain.close()
  await ctx.plugin(AgentPresets, { default: 'standard' })
  // The same tool-web contribution as Web's standard preset, mounted by the real registry/Loader.
  ctx.loader.builtins.webForTest = ToolWeb
  await ctx.agentPresets.register({ id: 'standard', plugins: [{ id: 'tool-web', name: 'cordis:webForTest' }] })
  expect(await ctx.agentPresets.resolve()).toEqual({ id: 'standard' })
  const plugin = await ctx.plugin({ inject: ['web'], apply: (scope: Context) => installFixture(scope, () => settings) })
  const create = (id: string, parent?: string) => ctx.agents.create({
    sessionId: SessionId(id), agentOptions: { provider: 'fixture', model: 'fixture' },
    ...(parent === undefined ? {} : { meta: { parentSession: SessionId(parent), isSeeded: true }, inheritedEventCount: SessionLogOffset(0), seed: [] }),
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
  })
  return { ctx, plugin, create, configure: (value: SettingsValue) => { settings = value } }
}

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


it('recomputes every known off Agent immediately when the web route returns', async () => {
  const { ctx, create } = await presetHost()
  const off = await create('off')
  cleanups.push(() => off.dispose())
  const scope = scopeOf(off.agent.ctx)!
  await ctx.settings.update('web', { searchProvider: 'elsewhere' })
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  const other = await create('off-other')
  cleanups.push(() => other.dispose())
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  expect(ctx.tools.get('web_search', scope)).toBeUndefined()
  expect(ctx.tools.get('web_search', scopeOf(other.agent.ctx))).toBeUndefined()
})

it('does not discover unrelated live Agents on web updates after a plugin remount', async () => {
  const { ctx, plugin, create } = await presetHost()
  const off = await create('off')
  cleanups.push(() => off.dispose())
  const scope = scopeOf(off.agent.ctx)!
  await plugin.dispose()
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  await ctx.plugin({ inject: ['web'], apply: (child: Context) => installFixture(child) })
  await ctx.settings.update('web', { searchProvider: 'elsewhere' })
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  await ctx.waterfall('agent/request', { agent: off.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
  expect(ctx.tools.get('web_search', scope)).toBeUndefined()
})

it('refreshes known selections without materializing changed defaults', async () => {
  const { ctx, create, configure } = await presetHost()
  const handle = await create('read-only')
  cleanups.push(() => handle.dispose())
  configure({ ...initialSettings(), defaultConnection: 'builtin:changed' })
  const writes: unknown[] = []
  ctx.on('domain/changed', event => { if (event.domain === domainName) writes.push(event) })
  await ctx.settings.update('web', { searchProvider: 'elsewhere' })
  await ctx.settings.update('web', { searchProvider: SEARCH.providerId })
  const web = ctx.settings.describe().find(document => document.ns === 'web')!
  await ctx.parallel('settings/document-updated', web.ns, web.revision)
  expect(writes).toEqual([])
})

it('logs every failed refresh without rejecting a saved web document or blocking other Agents', async () => {
  const { ctx, plugin, create } = await presetHost()
  const broken = await create('broken')
  const brokenToo = await create('broken-too')
  const healthy = await create('healthy')
  cleanups.push(() => broken.dispose(), () => brokenToo.dispose(), () => healthy.dispose())
  await plugin.dispose()
  await ctx.settings.update('web', { searchProvider: 'elsewhere' })
  const failures = [new Error('first read failed'), new Error('second read failed')]
  const restriction = new ToolRestriction(ctx, {
    tool: 'web_search',
    routed: () => routeFacts(ctx, 'searchProvider', SEARCH.providerId).kind === 'this',
    selection: async agent => {
      if (agent === broken.agent) throw failures[0]
      if (agent === brokenToo.agent) throw failures[1]
      return null
    },
  })
  for (const handle of [broken, brokenToo, healthy]) restriction.sync(handle.agent, 'builtin:test')
  const diagnostics: unknown[][] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
  await expect(ctx.settings.update('web', { searchProvider: SEARCH.providerId })).resolves.toBeUndefined()
  const web = ctx.settings.describe().find(document => document.ns === 'web')!
  await ctx.parallel('settings/document-updated', web.ns, web.revision)
  expect(ctx.tools.get('web_search', scopeOf(healthy.agent.ctx))).toBeUndefined()
  expect(ctx.tools.get('web_search', scopeOf(broken.agent.ctx))).toBeDefined()
  for (const failure of failures) expect(diagnostics.some(args => args.includes(failure))).toBe(true)
})

it('reads a known choice once before applying route-return visibility', async () => {
  const { ctx, plugin, create } = await presetHost()
  const handle = await create('off')
  cleanups.push(() => handle.dispose())
  await plugin.dispose()
  let routed = false
  let reads = 0
  const restriction = new ToolRestriction(ctx, {
    tool: 'web_search', routed: () => routed,
    selection: async () => {
      reads++
      expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeDefined()
      return 'builtin:test'
    },
  })
  restriction.sync(handle.agent, null)
  const web = ctx.settings.describe().find(document => document.ns === 'web')!
  await ctx.parallel('settings/document-updated', web.ns, web.revision)
  expect(reads).toBe(0)
  routed = true
  await ctx.parallel('settings/document-updated', web.ns, web.revision)
  expect(reads).toBe(1)
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeDefined()
})

it.each([false, true])('immediately hides the native tool after a child selection commits off (fork=%s)', async fork => {
  const { ctx, plugin, create } = await presetHost()
  const parent = await create('parent')
  cleanups.push(() => parent.dispose())
  const child = await ctx.agents.create({
    sessionId: SessionId('child'), agentOptions: { provider: 'fixture', model: 'child' },
    meta: { parentSession: parent.agent.id, origin: 'subagent', isSeeded: fork },
    ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
  })
  cleanups.push(() => child.dispose())
  await plugin.dispose()
  const storage = new SessionStorage(ctx, domainName, optionsCodec)
  const pairings = new Pairings(storage)
  const sessions = new Sessions(ctx, initialSettings, storage, pairings,
    new ToolRestriction(ctx, { tool: 'web_search', routed: () => routeFacts(ctx, 'searchProvider', SEARCH.providerId).kind === 'this' }))
  const scope = scopeOf(child.agent.ctx)
  expect(ctx.tools.get('web_search', scope)).toBeDefined()
  await sessions.change(liveSession(child.agent), { connectionId: null }, 0)
  // No agent/request or other refresh runs between the commit and this assertion.
  expect(ctx.tools.get('web_search', scope)).toBeUndefined()
  expect(ctx.tools.get('web_search', scopeOf(parent.agent.ctx))).toBeDefined()
  expect(await pairings.list()).toEqual([])
})

it.each([false, true].flatMap(fork => [null, 'builtin:test'].map(connectionId => ({ fork, connectionId }))))(
  'syncs the restored Agent when a queued cold write commits (fork=$fork, next=$connectionId)', async ({ fork, connectionId }) => {
    const { ctx, plugin, create } = await presetHost(true)
    const parent = await create('race-parent')
    cleanups.push(() => parent.dispose())
    const original = await ctx.agents.create({
      sessionId: SessionId('race-child'), agentOptions: { provider: 'fixture', model: 'child' },
      meta: { parentSession: parent.agent.id, origin: 'subagent', isSeeded: fork },
      ...(fork ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
    })
    const { id, header } = original.agent.session
    await (ctx.sessions as unknown as SessionStore).flush(original.agent.session)
    await original.dispose()
    await plugin.dispose()
    expect(ctx.agents.get(id)).toBeUndefined()
    const storage = new SessionStorage(ctx, domainName, optionsCodec)
    const pairings = new Pairings(storage)
    const restriction = new ToolRestriction(ctx, { tool: 'web_search', routed: () => routeFacts(ctx, 'searchProvider', SEARCH.providerId).kind === 'this' })
    const sessions = new Sessions(ctx, initialSettings, storage, pairings, restriction)
    const previous = connectionId === null ? 'builtin:test' : null
    await (await storage.domain()).table('selections').put(id, { connectionId: previous, revision: 1 })
    const entered = Promise.withResolvers<void>()
    const releaseWrite = Promise.withResolvers<void>()
    const queued = storage.exclusive(id, async () => { entered.resolve(); await releaseWrite.promise })
    await entered.promise
    // The addressed target is cold and the change is already queued before restoration.
    const changed = sessions.change({ kind: 'cold', id, header }, { connectionId }, 1)
    const restored = await ctx.agents.resume({
      resumeSessionId: id, agentOptions: { provider: 'fixture', model: 'child' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) },
    })
    cleanups.push(() => restored.dispose())
    restriction.created(restored.agent)
    restriction.captured(restored.agent, restriction.begin(restored.agent), previous, { kind: 'unread' })
    const staleCapture = restriction.begin(restored.agent)
    const releaseCapture = Promise.withResolvers<void>()
    const oldCapture = releaseCapture.promise.then(() => restriction.captured(restored.agent, staleCapture, previous, { kind: 'unread' }))
    const scope = scopeOf(restored.agent.ctx)
    expect(ctx.tools.get('web_search', scope) !== undefined).toBe(previous !== null)
    releaseWrite.resolve()
    await queued
    await changed
    expect(ctx.agents.get(id)).toBe(restored.agent)
    const immediatelyVisible = ctx.tools.get('web_search', scope) !== undefined
    releaseCapture.resolve()
    await oldCapture
    expect(immediatelyVisible).toBe(connectionId !== null)
    expect(ctx.tools.get('web_search', scope) !== undefined).toBe(connectionId !== null)
    expect(await pairings.list()).toEqual([])
  },
)

it('applies a committed selection immediately when model-memory persistence fails', async () => {
  const { ctx, plugin, create } = await presetHost()
  const handle = await create('memory-failure')
  cleanups.push(() => handle.dispose())
  await plugin.dispose()
  const storage = new SessionStorage(ctx, domainName, optionsCodec)
  const sessions = new Sessions(ctx, initialSettings, storage, new Pairings(storage), new ToolRestriction(ctx, { tool: 'web_search', routed: () => routeFacts(ctx, 'searchProvider', SEARCH.providerId).kind === 'this' }))
  const domain = await storage.domain()
  await sessions.current(liveSession(handle.agent))
  const diagnostics: unknown[][] = []
  ctx.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args) } })
  let closing = Promise.resolve()
  // Public lifecycle fault: the primary write is durable, but subsequent writes are rejected.
  ctx.on('domain/changed', event => {
    if (event.domain === domain.name && event.table === 'selections' && event.key === handle.agent.id) {
      closing = domain.close()
    }
  })
  const [changed] = await Promise.allSettled([sessions.change(liveSession(handle.agent), { connectionId: null }, 0)])
  await closing
  expect(ctx.tools.get('web_search', scopeOf(handle.agent.ctx))).toBeUndefined()
  expect(changed).toMatchObject({ status: 'fulfilled', value: { source: 'session', selection: { connectionId: null, revision: 1 } } })
  expect(diagnostics.some(args => args.some(value => value instanceof Error))).toBe(true)
})
