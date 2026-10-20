// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { runInNewContext, runInThisContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import * as clientStore from '@deepseek-ai/dsh-client-store'
import * as slotsCore from '@deepseek-ai/dsh-client-ui-slots'
import type { ScopedStandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import * as uiPlugin from '../../ui/src/client/index.tsx'
import { en as uiEn } from '../../ui/src/client/locales.ts'
import { fireEvent, screen } from '@testing-library/react'
import { SEARCH, WEB_ROW } from 'dsh-tool-web-enhanced-core/shared'
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/client/index.tsx'
import type { SearchSelectionChange, SearchSelectionView } from '../src/contract.ts'

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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function when<T>(source: ObservableSnapshot<T>, matches: (value: T) => boolean): Promise<void> {
  if (matches(source.getSnapshot())) return Promise.resolve()
  return new Promise(resolve => {
    const stop = source.subscribe(() => {
      if (matches(source.getSnapshot())) { stop(); resolve() }
    })
  })
}

async function fixture(holdSelection = false) {
  const ctx = new cordis.Context()
  contexts.push(ctx)
  ctx.provide('connection', { generation: clientStore.createSnapshotStore(0) })
  const namespaces = [namespace(WEB_ROW, { searchProvider: SEARCH.providerId }), namespace(SEARCH.rowId, { version: 2 })]
  let current: SearchSelectionView = {
    selection: { connectionId: 'builtin:exa', revision: 1, options: { freshness: 'auto' } },
    source: 'default',
    connections: [
      { id: 'builtin:exa', label: 'Exa', kind: 'adapter', remote: true, access: 'keyless', status: 'ready', freshness: false },
      { id: 'builtin:tavily', label: 'Tavily', kind: 'adapter', remote: true, access: 'api-key', status: 'ready', freshness: false },
    ],
  }
  const initialRead = deferred<void>()
  const searchConnections = {
    get: vi.fn(async () => {
      if (holdSelection) await initialRead.promise
      return { ok: true as const, value: current }
    }),
    set: vi.fn(async (change: SearchSelectionChange) => {
      expect(change.sessionId).toBe('s1')
      expect(change.expectedRevision).toBe(current.selection.revision)
      current = {
        ...current, source: 'session',
        selection: {
          connectionId: change.connectionId === undefined ? current.selection.connectionId : change.connectionId,
          revision: current.selection.revision + 1,
          options: { freshness: change.options?.freshness ?? current.selection.options.freshness },
        },
      }
      return { ok: true as const, value: current }
    }),
    provider: vi.fn(async () => ({ ok: true as const, value: { providerId: SEARCH.providerId, configured: SEARCH.providerId, envProvider: null, routed: true } })),
    pairings: vi.fn(async () => ({ ok: true as const, value: { pairings: [] } })),
    forgetPairing: vi.fn(async () => ({ ok: true as const, value: { pairings: [] } })),
  }
  const events = new Map<string, Set<() => void>>()
  const remote = {
    searchConnections,
    settings: {
      describe: vi.fn(async () => ({ ok: true as const, value: { namespaces, writable: true, hasDocument: true } })),
    },
    credentials: {
      describe: vi.fn(async () => ({ ok: true as const, value: {} })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
    $on(event: string, callback: () => void) {
      let listeners = events.get(event)
      if (listeners === undefined) { listeners = new Set(); events.set(event, listeners) }
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    $mount: vi.fn(async () => ctx.provide('remote.searchConnections', searchConnections)),
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
  // UiSession's real adapter requires a live Session Controller generation and retained
  // SessionReference. This Remote-only fixture supplies the public binding contract:
  // the real renderer builds useProjection from this keyed observable source.
  const modelSelection = clientStore.createSnapshotStore({ next: { provider: 'fixture', model: 'search' } })
  const session = clientStore.createSnapshotStore<ScopedStandardSourceBinding>({
    key: 's1', ctx, hooks: {},
    keyedHooks: { projection: key => key === 'modelSelection' ? modelSelection : undefined },
    props: { sessionId: 's1' },
  })
  ctx.slots.installScope('session', { current: session, bindingSource: () => session, renderArea: (_binding, props) => props.children })
  ctx.slots.register({ name: 'root', children: {
    'conversation.input.right': { kind: 'list', scope: 'session' },
    'plugins.row.config': { kind: 'keyed', scope: 'root' },
  } }, ({ renderSlot }) => renderSlot('conversation.input.right', {}))

  // The Plugins page navigation the ui package stores for its "open Plugins page" links.
  const openBundle = vi.fn()
  ctx.provide('pluginNavigation', { openBundle })
  // The shell registration seam captures the real contribution, not a replacement command implementation.
  let command!: CommandContribution
  const registered = deferred<void>()
  ctx.provide('commandUi', { register(contribution: CommandContribution) {
    command = contribution
    registered.resolve()
    return () => {}
  } })
  await ctx.plugin(uiPlugin)
  await ctx.plugin(plugin)
  await registered.promise
  await when(ctx.webConnections.sections, sections => sections.length === 1)
  const section = ctx.webConnections.sections.getSnapshot()[0]
  if (section === undefined) throw new Error('missing real search section')
  if (command.ui.kind !== 'popupSelect') throw new Error('missing real popup command')
  const popup = command.ui
  const container = document.body.appendChild(document.createElement('div'))
  const root = ReactDOMClient.createRoot(container)
  roots.push(root)
  const render = async () => {
    await React.act(async () => { root.render(ctx.slots.renderSlot('root', {})) })
  }
  await render()
  return {
    ctx, root, render, remote, searchConnections, section, popup, openBundle,
    async releaseSelection() {
      await React.act(async () => {
        initialRead.resolve()
        await section.selection.load('s1')
      })
    },
    async toggleMenu() {
      await React.act(async () => { fireEvent.click(screen.getByRole('button', { name: uiEn['button.aria'] })) })
    },
    async chooseCommand(id: string) {
      await React.act(async () => { await popup.onSelect({ id, label: '' }, { sessionId: 's1' } as never) })
    },
    async commandConnections() {
      let options!: Awaited<ReturnType<typeof popup.options>>
      await React.act(async () => { options = await popup.options({ sessionId: 's1' } as never, new AbortController().signal) })
      return options.filter(option => option.id === 'off' || option.id.startsWith('connection:'))
    },
  }
}

describe('real UI and search browser apply composition', () => {
  it('stores the Plugins page navigation without navigating on activation', async () => {
    // A snapshot store runs a function passed to set() as an updater; the callback must be wrapped.
    const h = await fixture()
    await h.toggleMenu()
    expect(h.openBundle).not.toHaveBeenCalled()
  })

  it('does not mark Off as selected or show its check while the initial selection is loading', async () => {
    const h = await fixture(true)
    try {
      expect(screen.getByRole('button', { name: uiEn['button.aria'] }).textContent).toContain(uiEn['button.loading'])
      await h.toggleMenu()
      const menu = screen.getByRole('menu', { hidden: true })
      expect(menu.querySelector('[aria-checked="true"]') === null).toBe(true)
      expect(screen.queryByRole('menuitemradio', { name: uiEn['menu.offRow'], hidden: true })).toBeNull()
      expect(h.searchConnections.set).not.toHaveBeenCalled()
    } finally {
      await h.releaseSelection()
    }
    const selected = screen.getByRole('menuitemradio', { name: /Exa/, hidden: true })
    expect(selected.getAttribute('aria-checked')).toBe('true')
    expect(selected.querySelector('svg')).not.toBeNull()
    const off = screen.getByRole('menuitemradio', { name: uiEn['menu.offRow'], hidden: true })
    expect(off.getAttribute('aria-checked')).toBe('false')
    expect(off.querySelector('svg')).toBeNull()
    expect(h.searchConnections.get).toHaveBeenCalledTimes(1)
  })

  it('reads provider facts only once per menu mount despite real route and selection rerenders', async () => {
    const h = await fixture()
    expect(h.searchConnections.provider).not.toHaveBeenCalled()
    await h.toggleMenu()
    expect(h.searchConnections.provider).toHaveBeenCalledTimes(1)
    expect(h.section.route.source.getSnapshot()).toEqual({ kind: 'this' })
    await h.render()
    await h.chooseCommand('connection:builtin:tavily')
    await h.chooseCommand('off')
    expect(h.searchConnections.provider).toHaveBeenCalledTimes(1)
    await h.toggleMenu()
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    await h.toggleMenu()
    expect(h.searchConnections.provider).toHaveBeenCalledTimes(2)
    await h.render()
    expect(h.searchConnections.provider).toHaveBeenCalledTimes(2)
  })

  it('keeps real composer radio checks, trigger text and command options in sync after switches from either surface', async () => {
    const h = await fixture()
    await h.toggleMenu()
    expect(screen.getByRole('menuitemradio', { name: /Exa/, hidden: true }).getAttribute('aria-checked')).toBe('true')
    expect((await h.commandConnections()).filter(option => option.active).map(option => option.id)).toEqual(['connection:builtin:exa'])

    await React.act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: uiEn['menu.offRow'], hidden: true })) })
    expect(screen.queryByRole('menu', { hidden: true })).toBeNull()
    expect(screen.getByRole('button', { name: uiEn['button.aria'] }).textContent).toContain(uiEn['button.off'])
    expect((await h.commandConnections()).filter(option => option.active).map(option => option.id)).toEqual(['off'])

    await h.toggleMenu()
    const off = screen.getByRole('menuitemradio', { name: uiEn['menu.offRow'], hidden: true })
    expect(off.getAttribute('aria-checked')).toBe('true')
    expect(off.querySelector('svg')).not.toBeNull()
    await h.chooseCommand('connection:builtin:tavily')
    expect(screen.getByRole('button', { name: uiEn['button.aria'] }).textContent).toContain('Tavily')
    expect(screen.getByRole('menuitemradio', { name: /Tavily/, hidden: true }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: uiEn['menu.offRow'], hidden: true }).getAttribute('aria-checked')).toBe('false')
    expect((await h.commandConnections()).filter(option => option.active).map(option => option.id)).toEqual(['connection:builtin:tavily'])

    await React.act(async () => { fireEvent.click(screen.getByRole('menuitemradio', { name: /Exa/, hidden: true })) })
    expect(screen.getByRole('button', { name: uiEn['button.aria'] }).textContent).toContain('Exa')
    expect((await h.commandConnections()).filter(option => option.active).map(option => option.id)).toEqual(['connection:builtin:exa'])
    expect(h.searchConnections.set.mock.calls.map(([change]) => change.connectionId)).toEqual([null, 'builtin:tavily', 'builtin:exa'])
  })
})
