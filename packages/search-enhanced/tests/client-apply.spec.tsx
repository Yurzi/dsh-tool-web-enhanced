// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext, runInThisContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import * as slotsCore from '@deepseek-ai/dsh-client-ui-slots'
import type { StandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { createWebConnectionsService } from '../../ui/src/client/service.ts'
import { PROFILE_PACKAGE, SEARCH, WEB_ROW, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/client/index.tsx'
import type { SettingsPageInjected } from '../src/client/injected.ts'
import { en, zh } from '../src/client/locales.ts'
import type { SearchSelectionView } from '../src/contract.ts'

/** Execute shipped public client bundles with their documented module-loader protocol. */
function browserModule(specifier: string): unknown {
  const modules: Record<string, unknown> = {
    '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': clientStore,
    '@deepseek-ai/dsh-client-ui-slots': slotsCore, '@deepseek-ai/dsh-client-ui-primitives': primitives,
    react: React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOMClient, 'react/jsx-runtime': jsxRuntime,
  }
  let loaded: unknown
  const loaderWindow = { __ModuleLoader__: { load({ factory }: { factory: (require: (id: string) => unknown) => unknown }) {
    loaded = factory(id => {
      if (!Object.hasOwn(modules, id)) throw new Error('unprovided platform module: ' + id)
      return modules[id]
    })
  } } }
  const script = readFileSync(new URL(import.meta.resolve(specifier)), 'utf8')
  const nodeStructuredClone = runInThisContext('structuredClone') as typeof structuredClone
  runInNewContext(script, { window: loaderWindow, console, navigator, queueMicrotask, structuredClone: nodeStructuredClone })
  return loaded
}

const settingsPlugin = browserModule('@deepseek-ai/dsh-client-ui-settings/client') as { apply(ctx: cordis.Context): void; inject: string[] }
const rendererPlugin = browserModule('@deepseek-ai/dsh-client-ui-renderer/client') as { apply(ctx: cordis.Context): void; inject: string[]; SlotRegistry: typeof SlotRegistry }
const localeModule = browserModule('@deepseek-ai/dsh-client-locale/client') as { LocaleRuntime: typeof LocaleRuntime }

const contexts: cordis.Context[] = []
const roots: ReactDOMClient.Root[] = []
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  await React.act(async () => { for (const root of roots.splice(0)) root.unmount() })
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  document.body.replaceChildren()
})

function namespace(ns: string, value: SettingsNamespaceView['value']): SettingsNamespaceView {
  return { ns, value, base: {}, user: {}, revision: 1, autoGenerate: false, schema: { type: 'object', dict: {} }, applies: 'live', secrets: [] }
}

async function fixture(served = true) {
  const ctx = new cordis.Context()
  contexts.push(ctx)
  const generation = clientStore.createSnapshotStore(0)
  ctx.provide('connection', { generation })
  let namespaces = [namespace(WEB_ROW, { searchProvider: SEARCH.providerId }), ...(served ? [namespace(SEARCH.rowId, { version: 2 })] : [])]
  let current: SearchSelectionView = { selection: { connectionId: 'builtin:exa', revision: 1, options: { freshness: 'auto' } }, source: 'default', connections: [
    { id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true, access: 'keyless', status: 'ready', freshness: false },
  ] }
  const searchConnections = {
    get: vi.fn(async () => ({ ok: true as const, value: current })),
    set: vi.fn(async (change: { connectionId?: string | null }) => {
      current = { ...current, source: 'session', selection: { ...current.selection, connectionId: change.connectionId === undefined ? current.selection.connectionId : change.connectionId, revision: current.selection.revision + 1 } }
      return { ok: true as const, value: current }
    }),
    provider: vi.fn(async () => ({ ok: true as const, value: { providerId: SEARCH.providerId, envProvider: null as string | null } })),
    pairings: vi.fn(async () => ({ ok: true as const, value: { pairings: [{ provider: 'p', model: 'm', connectionId: null }] } })),
    forgetPairing: vi.fn(async () => ({ ok: true as const, value: { pairings: [] } })),
  }
  const events = new Map<string, Set<() => void>>()
  const remote = {
    searchConnections,
    settings: {
      describe: vi.fn(async () => ({ ok: true as const, value: { namespaces, writable: true, hasDocument: true } })),
      mutate: vi.fn(async (_ns: string, ops: { op: string; path: string[]; value?: unknown }[]) => {
        const row = namespaces.find(candidate => candidate.ns === SEARCH.rowId)
        if (row === undefined) throw new Error('search row is not served')
        const value = { ...row.value as Record<string, SettingsNamespaceView['value']> }
        for (const op of ops) {
          const [key] = op.path
          if (key === undefined) throw new Error('fixture expects a field operation')
          if (op.op === 'unset') delete value[key]
          else value[key] = op.value as SettingsNamespaceView['value']
        }
        const next = { ...row, value, revision: row.revision + 1 }
        namespaces = namespaces.map(candidate => candidate.ns === SEARCH.rowId ? next : candidate)
        return { ok: true as const, value: next }
      }),
    },
    credentials: {
      describe: vi.fn(async (refs: string[]) => ({ ok: true as const, value: Object.fromEntries(refs.map(ref => [ref, { configured: ref === 'EXA_API_KEY', writable: true }])) })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
    $on(event: string, callback: () => void) {
      let listeners = events.get(event)
      if (listeners === undefined) { listeners = new Set(); events.set(event, listeners) }
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    $mount: vi.fn(async () => {
      const release = ctx.provide('remote.searchConnections', searchConnections)
      return release
    }),
  }
  ctx.provide('remote', remote)
  ctx.provide('remote.settings', remote.settings)
  ctx.provide('remote.credentials', remote.credentials)
  await ctx.plugin(settingsPlugin)
  await ctx.configForms.describe().ensure()
  const locale = new localeModule.LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  await ctx.plugin(rendererPlugin)
  ctx.slots.installLocale(locale)
  // The shell installs the Session domain adapter even on pages without a selected Session.
  const absentSession = clientStore.createSnapshotStore<StandardSourceBinding>({ key: undefined, hooks: {}, keyedHooks: {}, props: {} })
  ctx.slots.installScope('session', { current: absentSession, bindingSource: () => absentSession })
  ctx.slots.register({ name: 'root', children: {
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
    'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
  } }, ({ renderSlot }) => renderSlot('plugins.row.config', { view: 'page' }, { entryKey: rowConfigKey(SEARCH) }))
  const commands = new Map<string, CommandContribution>()
  let commandRegistered!: () => void
  const commandReady = new Promise<void>(resolve => { commandRegistered = resolve })
  ctx.provide('commandUi', { register(command: CommandContribution) {
    commands.set(command.name, command)
    commandRegistered()
    return () => { commands.delete(command.name) }
  } })
  const fiber = await ctx.plugin(plugin)
  await commandReady
  return {
    ctx, fiber, remote, searchConnections, generation, commands,
    emit(event: string) { const listeners = events.get(event); if (listeners !== undefined) for (const listener of listeners) listener() },
    async served(next: boolean) {
      namespaces = [namespace(WEB_ROW, { searchProvider: SEARCH.providerId }), ...(next ? [namespace(SEARCH.rowId, { version: 2 })] : [])]
      const changed = new Promise<void>(resolve => {
        const stop = ctx.configForms.describe().subscribe(() => { stop(); resolve() })
      })
      this.emit('settings/document-updated')
      await changed
      await when({ getSnapshot: () => ctx.slots.entries('plugins.row.config'), subscribe: listener => ctx.slots.subscribe('plugins.row.config', listener) }, entries => entries.length === (next ? 1 : 0))
    },
    page(): SettingsPageInjected {
      const entry = ctx.slots.entries('plugins.row.config')[0]
      if (entry === undefined || entry.inject === undefined) throw new Error('missing row page')
      return entry.inject() as unknown as SettingsPageInjected
    },
  }
}

function when<T>(source: ObservableSnapshot<T>, matches: (value: T) => boolean): Promise<void> {
  if (matches(source.getSnapshot())) return Promise.resolve()
  return new Promise(resolve => {
    const stop = source.subscribe(() => {
      if (matches(source.getSnapshot())) { stop(); resolve() }
    })
  })
}

async function mountUi(ctx: cordis.Context) {
  const ui = createWebConnectionsService()
  const registered = when(ui.sections, sections => sections.length > 0)
  ctx.provide('webConnections', ui)
  await registered
  return ui
}

describe('browser apply composition', () => {
  it('keeps environment-aware route facts when the selector is hidden, then removes them on unload', async () => {
    const h = await fixture()
    await h.page().mutate([{ op: 'set', path: ['showSelector'], value: false }], 1)
    h.ctx.configForms.describe().acceptView(namespace(WEB_ROW, {}))
    h.searchConnections.provider.mockResolvedValue({ ok: true, value: { providerId: SEARCH.providerId, envProvider: 'external-provider' } })
    const ui = createWebConnectionsService()
    const registered = when(ui.routes, routes => routes.get('search')?.kind === 'other')
    h.ctx.provide('webConnections', ui)
    await registered
    expect(ui.sections.getSnapshot()).toEqual([])
    expect(ui.routes.getSnapshot().get('search')).toEqual({ kind: 'other', provider: 'external-provider', providerId: SEARCH.providerId })
    await h.fiber.dispose()
    expect(ui.routes.getSnapshot().size).toBe(0)
  })

  it('reads the public secrets sidecar and renders manual repair without exposing or unsetting a secret', async () => {
    const h = await fixture()
    const mirror = h.ctx.configForms.describe()
    const row = mirror.getSnapshot().view!.namespaces.find(entry => entry.ns === SEARCH.rowId)!
    mirror.acceptView({ ...row, secrets: [{ path: ['apiKey'], set: true }] })
    const snapshot = h.page().hooks.settings.getSnapshot()
    expect(snapshot).toMatchObject({ diagnostic: en['settings.retiredSecret'].replace('{fields}', 'apiKey') })
    expect(snapshot.value).not.toHaveProperty('apiKey')
    expect(snapshot.user).not.toHaveProperty('apiKey')
    expect(h.page().hooks.settings.getSnapshot()).toBe(snapshot)
    const container = document.body.appendChild(document.createElement('div'))
    const root = ReactDOMClient.createRoot(container)
    roots.push(root)
    await React.act(async () => { root.render(h.ctx.slots.renderSlot('root', {})); await h.page().refreshPairings() })
    const alert = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.textContent).toBe(en['settings.unsupported'])
    expect(alert.title).toBe(en['settings.retiredSecret'].replace('{fields}', 'apiKey'))
    await React.act(async () => { h.ctx.locale.setLocale('zh') })
    expect(alert.title).toBe(zh['settings.retiredSecret'].replace('{fields}', 'apiKey'))
    expect(h.remote.settings.mutate).not.toHaveBeenCalled()
    await React.act(async () => { mirror.acceptView({ ...row, secrets: [{ path: ['apiKey'], set: false }] }) })
    expect(h.page().hooks.settings.getSnapshot()).not.toHaveProperty('diagnostic')
    expect(container.textContent).toContain(zh['defaults.title'])
  })

  it('keeps the row page and command without UI; follows row serving and unload', async () => {
    const h = await fixture()
    expect(h.ctx.slots.entries('plugins.row.config')[0]?.options.key).toBe(rowConfigKey(SEARCH))
    expect(h.ctx.slots.entries('plugins.bundle.config')).toHaveLength(0)
    expect(h.commands.has('setup-search')).toBe(true)
    await h.served(false)
    expect(h.ctx.slots.entries('plugins.row.config')).toHaveLength(0)
    await h.served(true)
    expect(h.ctx.slots.entries('plugins.row.config')).toHaveLength(1)
    await h.fiber.dispose()
    expect(h.commands.size).toBe(0)
    expect(h.ctx.slots.entries('plugins.row.config')).toHaveLength(0)
  })

  it('returns false for a refused write even when the visible locale is Chinese', async () => {
    const h = await fixture()
    h.ctx.locale.setLocale('zh')
    h.remote.settings.mutate.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'private diagnostic', {}) } as never)
    await expect(h.page().mutate([{ op: 'set', path: ['showSelector'], value: false }], 1)).resolves.toBe(false)
  })

  it('registers optional sections late and shares command writes with their selection', async () => {
    const h = await fixture()
    const ui = await mountUi(h.ctx)
    const [section] = ui.sections.getSnapshot()
    if (section === undefined) throw new Error('missing section')
    expect(section.capability).toBe('search')
    const command = h.commands.get('setup-search')
    if (command === undefined || command.ui.kind !== 'popupSelect') throw new Error('missing popup command')
    await command.ui.onSelect({ id: 'off', label: '' }, { sessionId: 's1' } as never)
    expect(section.selection.source('s1').getSnapshot().view?.selection.connectionId).toBeNull()
    const stop = section.selection.source('s1').subscribe(() => {})
    for (const invalidate of [() => h.emit('settings/document-updated'), () => h.emit('credentials/reference-updated'), () => h.generation.set(1)]) {
      const previous = h.searchConnections.get.mock.calls.length
      invalidate()
      await section.selection.load('s1')
      expect(h.searchConnections.get.mock.calls.length).toBeGreaterThan(previous)
    }
    stop()
    await h.fiber.dispose()
    expect(ui.sections.getSnapshot()).toEqual([])
  })

  it('honors showSelector changes without hiding commands or the settings page', async () => {
    const h = await fixture()
    const ui = await mountUi(h.ctx)
    expect(ui.sections.getSnapshot()).toHaveLength(1)
    const page = h.page()
    await page.mutate([{ op: 'set', path: ['showSelector'], value: false }], 1)
    expect(ui.sections.getSnapshot()).toHaveLength(0)
    expect(h.commands.has('setup-search')).toBe(true)
    expect(h.ctx.slots.entries('plugins.row.config')).toHaveLength(1)
    await page.mutate([{ op: 'unset', path: ['showSelector'] }], 2)
    expect(ui.sections.getSnapshot()).toHaveLength(1)
  })

  it("asks Credentials about a fixed model connection's key and about none for the conversation model", async () => {
    const h = await fixture()
    const page = h.page()
    await page.mutate([{ op: 'set', path: ['connections'], value: { 'custom:claude': {
      kind: 'model', protocol: 'anthropic-messages', model: 'claude-x', label: 'Claude', credentialRef: 'CLAUDE_KEY', endpoint: 'https://api.anthropic.com', trustedEndpoint: true,
    } } }], 1)
    const stop = page.hooks.credentials.subscribe(() => {})
    await vi.waitFor(() => { expect(page.hooks.credentials.getSnapshot()).toHaveProperty('CLAUDE_KEY', 'missing') })
    const refs = h.remote.credentials.describe.mock.calls.at(-1)![0]
    expect(refs.toSorted()).toEqual(['CLAUDE_KEY', 'DEEPSEEK_API_KEY', 'EXA_API_KEY', 'FIRECRAWL_API_KEY', 'OPENALEX_API_KEY', 'SEMANTIC_SCHOLAR_API_KEY', 'TAVILY_API_KEY', 'TINYFISH_API_KEY'])
    stop()
  })

  it('injects real forms plus lazy credential, route and model-memory sources', async () => {
    const h = await fixture()
    const page = h.page()
    expect(page.hooks.settings.getSnapshot()).toBe(h.ctx.configForms.get(SEARCH.rowId).getSnapshot())
    expect(h.searchConnections.provider).not.toHaveBeenCalled()
    expect(h.remote.credentials.describe).not.toHaveBeenCalled()
    const stops = [page.hooks.route.subscribe(() => {}), page.hooks.credentials.subscribe(() => {}), page.hooks.pairings.subscribe(() => {})]
    await page.refreshPairings()
    expect(page.hooks.route.getSnapshot()).toEqual({ kind: 'this' })
    expect(page.hooks.credentials.getSnapshot()).toMatchObject({ EXA_API_KEY: 'configured', DEEPSEEK_API_KEY: 'missing' })
    expect(page.hooks.pairings.getSnapshot()).toEqual({ state: 'ready', pairings: [{ provider: 'p', model: 'm', connectionId: null }] })
    await page.saveCredential('MY_KEY', 'secret')
    expect(h.remote.credentials.set).toHaveBeenCalledWith('MY_KEY', 'secret')
    await page.mutate([{ op: 'unset', path: ['freshness'] }], 1)
    expect(h.remote.settings.mutate).toHaveBeenCalled()
    await page.forgetPairing('p', 'm')
    expect(h.searchConnections.forgetPairing).toHaveBeenCalledWith({ provider: 'p', model: 'm' })
    for (const stop of stops) stop()
  })

  it('renders the row page through the real renderer hook injection', async () => {
    const h = await fixture()
    const container = document.body.appendChild(document.createElement('div'))
    const root = ReactDOMClient.createRoot(container)
    roots.push(root)
    await React.act(async () => {
      root.render(h.ctx.slots.renderSlot('root', {}))
      await h.page().refreshPairings()
    })
    expect(container.textContent).toContain(en['defaults.title'])
    expect(container.textContent).toContain(en['pairings.title'])
    expect(container.textContent).not.toContain('pairings.title')
  })

  it('offers the public bundle navigation fallback and paired locale keys', async () => {
    const h = await fixture()
    const ui = await mountUi(h.ctx)
    const openBundle = vi.fn()
    const [section] = ui.sections.getSnapshot()
    if (section === undefined) throw new Error('missing section')
    const available = when(section.settings, action => action !== undefined)
    const release = h.ctx.provide('pluginNavigation', { openBundle })
    await available
    const open = section.settings.getSnapshot()
    if (open === undefined) throw new Error('missing settings action')
    open()
    expect(openBundle).toHaveBeenCalledWith(PROFILE_PACKAGE)
    const unavailable = when(section.settings, action => action === undefined)
    release()
    await unavailable
    expect(section.settings.getSnapshot()).toBeUndefined()
    expect(Object.keys(en)).toEqual(Object.keys(zh))
  })
})
