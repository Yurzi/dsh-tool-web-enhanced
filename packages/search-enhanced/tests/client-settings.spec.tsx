// @vitest-environment jsdom
import { act, useSyncExternalStore, type ComponentProps, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Pairing, Route } from 'dsh-tool-web-enhanced-core/shared'
import type { SearchSettings } from '../src/settings/types.ts'
import type { CredentialStatusMap, PairingsState } from '../src/client/injected.ts'
import { zh } from '../src/client/locales.ts'
import { SettingsPage, type SettingsPageProps } from '../src/client/settings/SettingsPage.tsx'
import { CATALOG } from '../src/catalog.ts'
import { OptionsForm } from '../src/client/settings/OptionsEditor.tsx'
import type { FieldSpec } from '../src/client/settings/model.ts'
import { CredentialEditor } from '../src/client/settings/CredentialEditor.tsx'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []
afterEach(() => {
  act(() => { for (const root of roots.splice(0)) root.unmount() })
  document.body.innerHTML = ''
})

function render(element: ReactElement): { container: HTMLElement } {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(element) })
  return { container }
}

function bindHook<T>(source: ObservableSnapshot<T>) {
  return <S,>(selector: (value: T) => S): S => selector(useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot()))
}

function observable<T>(initial: T): ObservableSnapshot<T> & { set(next: T): void } {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next) => { value = next; for (const listener of listeners) listener() },
  }
}

async function flush(): Promise<void> {
  await act(async () => {})
}

function click(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
  act(() => { element.click() })
}

function byText(root: ParentNode, selector: string, text: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(selector)].find(element => element.textContent?.includes(text))
}

function type(element: Element | null | undefined, value: string): void {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('nothing to type into')
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function blur(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to blur')
  act(() => { element.focus(); element.blur() })
}

const tZh = (key: string, params?: Record<string, unknown>): string => {
  const template = zh[key as keyof typeof zh] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const val = params?.[name]
    if (val === undefined) return match
    if (typeof val === 'string') return val
    if (typeof val === 'number' || typeof val === 'boolean') return `${val}`
    return JSON.stringify(val)
  })
}

interface MountOptions {
  user?: Record<string, unknown>
  base?: Record<string, unknown>
  writable?: boolean
  routeState?: Route
  pairingsList?: Pairing[]
  credentialsMap?: CredentialStatusMap
  translate?: typeof tZh
}

function mountPage({
  user = { version: 2 },
  base = {},
  writable = true,
  routeState = { kind: 'this' },
  pairingsList = [],
  credentialsMap = { SEMANTIC_SCHOLAR_API_KEY: 'missing' },
  translate = tZh,
}: MountOptions = {}) {
  const snapshot: ConfigFormSnapshot<SearchSettings> = {
    status: 'ready',
    value: user,
    base,
    user,
    revision: 8,
    writable,
  }
  const settings = observable(snapshot)
  const credentials = observable<CredentialStatusMap>(credentialsMap)
  const route = observable<Route>(routeState)
  const pairings = observable<PairingsState>({ state: 'ready', pairings: pairingsList })
  const mutate = vi.fn(async () => true)
  const saveCredential = vi.fn(async () => {})
  const forgetPairing = vi.fn(async () => {})
  const refreshPairings = vi.fn(async () => {})

  const props = {
    view: 'page' as const,
    useSettings: bindHook(settings),
    useCredentials: bindHook(credentials),
    useRoute: bindHook(route),
    usePairings: bindHook(pairings),
    mutate,
    saveCredential,
    forgetPairing,
    refreshPairings,
    t: translate,
  } as unknown as SettingsPageProps

  const { container } = render(<SettingsPage {...props} />)
  const row = (name: string) => byText(container, 'li', name)!
  const configure = (name: string) => { click(row(name).querySelector('button[aria-expanded]')) }

  return { container, mutate, saveCredential, forgetPairing, row, configure, route, settings, pairings }
}

describe('settings page', () => {
  it('shows a retired secret sidecar diagnostic without inventing a user-layer unset', async () => {
    const h = mountPage()
    act(() => { h.settings.set({ status: 'ready', value: {}, base: {}, user: {}, revision: 9, writable: true,
      diagnostic: 'apiKey is a 0.1.x setting this release does not read; its layer is redacted; remove it manually from the profile patch',
    } as ConfigFormSnapshot<SearchSettings>) })
    await flush()
    const alert = h.container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toBe(tZh('settings.invalid'))
    expect(alert?.title).toContain('apiKey')
    expect(alert?.title).toContain('profile patch')
    click(byText(h.container, 'button', tZh('reset.button')))
    click(byText(h.container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(h.mutate).not.toHaveBeenCalled()
  })

  it.each(['providerId', 'freshness', 'schemaVersion', 'allowCidrs'])('diagnoses projected-out user field %s and permits reset', async field => {
    const h = mountPage()
    const user = { version: 2, [field]: 'old' }
    act(() => { h.settings.set({ status: 'ready', value: { version: 2 }, base: {}, user, revision: 9, writable: true }) })
    await flush()
    const alert = h.container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toBe(tZh('settings.invalid'))
    expect(alert?.title).toContain(field)
    expect(h.container.querySelector('[role="switch"], input')).toBeNull()
    expect(h.mutate).not.toHaveBeenCalled()
    click(byText(h.container, 'button', tZh('reset.button')))
    click(byText(h.container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(h.mutate).toHaveBeenCalledWith(Object.keys(user).map(key => ({ op: 'unset', path: [key] })), 9)
  })

  it('does not migrate an unavailable snapshot and recovers on a valid revision', async () => {
    const h = mountPage()
    act(() => { h.settings.set({ status: 'unavailable', value: { version: 1 }, base: {}, user: { version: 1 }, revision: 9, writable: true } as unknown as ConfigFormSnapshot<SearchSettings>) })
    await flush()
    expect(h.container.textContent).toBe('')
    expect(h.mutate).not.toHaveBeenCalled()
    act(() => { h.settings.set({ status: 'ready', value: { version: 2 }, base: {}, user: { version: 2 }, revision: 10, writable: true }) })
    expect(h.container.querySelector('[role="alert"]')).toBeNull()
    expect(h.container.querySelector('[role="switch"]')).not.toBeNull()
  })

  it.each([{ version: 1 }, { version: 99 }, { version: 2, providerId: 'old' }, { version: 2, connections: { 'custom:bad': { kind: 'model' } } }])('shows invalid documents without normal editors and permits reset: %j', async user => {
    const h = mountPage({ user })
    await flush()
    const alert = h.container.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.textContent).toBe(tZh('settings.invalid'))
    expect(alert.title.length).toBeGreaterThan(0)
    expect(h.container.querySelector('[role="switch"], input')).toBeNull()
    expect(h.mutate).not.toHaveBeenCalled()
    const reset = byText(h.container, 'button', tZh('reset.button')) as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    click(reset)
    click(byText(h.container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(h.mutate).toHaveBeenCalledWith(Object.keys(user).map(key => ({ op: 'unset', path: [key] })), 8)
  })

  it('keeps invalid read-only documents visible without allowing reset or writeback', async () => {
    const h = mountPage({ user: { version: 1 }, writable: false })
    await flush()
    expect(h.container.querySelector('[role="alert"]')?.textContent).toBe(tZh('settings.invalid'))
    expect((byText(h.container, 'button', tZh('reset.button')) as HTMLButtonElement).disabled).toBe(true)
    expect(h.mutate).not.toHaveBeenCalled()
  })


  it('localizes invalid settings and keeps English diagnostics in the title only', async () => {
    const { container, mutate } = mountPage({ user: { version: 2, defaults: { freshness: 'broken' } } })
    await flush()
    const error = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toBe(tZh('settings.invalid'))
    expect(error.title).toContain('freshness')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports Host revision refusal separately from invalid settings', async () => {
    const { container, mutate, row } = mountPage()
    mutate.mockResolvedValueOnce(false)
    click(row('Exa').querySelector('[role="switch"]'))
    await flush()
    const error = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toBe(tZh('settings.refused'))
    expect(error.title).toBe('')
    expect(mutate).toHaveBeenCalledOnce()
  })

  it('supplies the catalog default name to the unset default label', () => {
    const translate = vi.fn(tZh)
    mountPage({ translate })
    expect(translate).toHaveBeenCalledWith('defaults.connectionUnset', { name: CATALOG['deepseek-messages'].label })
  })

  it('derives freshness hints from live catalog support and labels', () => {
    const oldTavily = CATALOG.tavily
    const oldExa = CATALOG.exa
    Object.assign(CATALOG, {
      tavily: { ...oldTavily, label: 'Catalog Freshness', freshness: ['api-key'] },
      exa: { ...oldExa, freshness: [] },
    })
    try {
      const translate = vi.fn(tZh)
      mountPage({ translate })
      expect(translate).toHaveBeenCalledWith('defaults.freshnessHint', {
        services: ['Firecrawl', tZh('defaults.freshnessKeyOnly', { name: 'Catalog Freshness' })].join(tZh('list.separator')),
      })
    } finally {
      Object.assign(CATALOG, { tavily: oldTavily, exa: oldExa })
    }
  })

  it('distinguishes loading and failed model memories from an empty successful result', () => {
    const { container, pairings } = mountPage()
    act(() => { pairings.set({ state: 'loading' }) })
    expect(container.textContent).toContain(tZh('pairings.loading'))
    expect(container.textContent).not.toContain(tZh('pairings.empty'))
    act(() => { pairings.set({ state: 'failed', message: 'Network detail' }) })
    const error = container.querySelector<HTMLElement>('[role="alert"]')!
    expect(error.textContent).toBe(tZh('pairings.failed'))
    expect(error.title).toBe('Network detail')
    expect(container.textContent).not.toContain(tZh('pairings.empty'))
  })

  it('renders URL rules as inputs and rejects unsafe values before committing', async () => {
    const field: FieldSpec = { name: 'baseURL', label: 'option.native.baseURL', kind: 'url', values: [], placeholder: () => undefined }
    const onCommit = vi.fn(async () => true)
    const { container } = render(<OptionsForm id="url" title="URL" hint="" fields={[field]} stored={{}} disabled={false} onCommit={onCommit} t={tZh} />)
    const input = container.querySelector<HTMLInputElement>('input')!
    expect(input).not.toBeNull()
    expect(input.type).toBe('url')
    type(input, 'https://api.example/v1?secret=1')
    blur(input)
    await flush()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(onCommit).not.toHaveBeenCalled()
    type(input, 'https://api.example/v1')
    blur(input)
    await flush()
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('baseURL', 'https://api.example/v1')
  })

  it('uses a CSS class instead of inline layout for boolean options', () => {
    const { configure, row } = mountPage()
    configure('Firecrawl')
    const toggle = row('Firecrawl').querySelector('[role="switch"][aria-label="' + tZh('option.firecrawl.safe') + '"]')!
    expect(toggle).not.toBeNull()
    expect(toggle.parentElement?.hasAttribute('style')).toBe(false)
    expect(toggle.parentElement?.className).toContain('optionBoolean')
  })

  it('restricts credential status to the injected credential union', () => {
    type Status = ComponentProps<typeof CredentialEditor>['status']
    // @ts-expect-error arbitrary credential statuses are not accepted by the editor
    const invalid: Status = 'not-a-status'
    expect(invalid).toBe('not-a-status')
  })

  it('saves a key through Credentials only and leaves settings untouched', async () => {
    const { mutate, saveCredential, configure, row } = mountPage()
    configure('Semantic Scholar')
    type(row('Semantic Scholar').querySelector('input[type="password"]'), '  secret-value  ')
    click(byText(row('Semantic Scholar'), 'button', tZh('credential.save')))
    await flush()
    expect(saveCredential).toHaveBeenCalledExactlyOnceWith('SEMANTIC_SCHOLAR_API_KEY', 'secret-value')
    expect(mutate).not.toHaveBeenCalled()
    expect(row('Semantic Scholar').textContent).toContain(tZh('credential.saved'))
    expect(row('Semantic Scholar').querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('')
  })

  it('switches a keyless service to a personal key with one sparse write', async () => {
    const { mutate, configure, row } = mountPage()
    configure('Exa')
    expect(row('Exa').textContent).toContain(tZh('services.accessHint.keyless'))
    click(byText(row('Exa'), '[role="tab"]', tZh('services.accessPersonal')))
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:exa', 'access'], value: 'api-key' }], 8)
  })

  it('saves a valid option when the field is left and keeps an invalid one with its error', async () => {
    const { mutate, configure, row } = mountPage({
      user: { version: 2, connections: { 'builtin:firecrawl': { access: 'api-key', options: { safe: true } } } },
    })
    configure('Firecrawl')
    expect(row('Firecrawl').textContent).toContain(tZh('option.firecrawl.country'))
    const country = [...row('Firecrawl').querySelectorAll('input')].find(input => input.id.endsWith('-country'))!
    expect(country.title).toBe('country')
    type(country, 'usa')
    blur(country)
    await flush()
    expect(mutate).not.toHaveBeenCalled()
    expect(row('Firecrawl').textContent).toContain(tZh('options.invalid'))
    type(country, 'us')
    blur(country)
    await flush()
    expect(mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:firecrawl', 'options', 'country'], value: 'us' }], 8)
  })

  it('hides options the keyless route rejects', () => {
    const { configure, row } = mountPage()
    configure('Exa')
    expect(row('Exa').textContent).not.toContain(tZh('option.exa.type'))
  })

  it('renders route notice when route != this', () => {
    const { container: c1 } = mountPage({ routeState: { kind: 'auto', providerId: 'search-enhanced' } })
    expect(c1.textContent).toContain(tZh('route.auto', { id: 'search-enhanced' }))

    const { container: c2 } = mountPage({ routeState: { kind: 'other', provider: 'other-p', providerId: 'search-enhanced' } })
    expect(c2.textContent).toContain(tZh('route.other', { provider: 'other-p', id: 'search-enhanced' }))

    const { container: c3 } = mountPage({ routeState: { kind: 'other', provider: 'deepseek-search-api', providerId: 'search-enhanced' } })
    expect(c3.textContent).toContain(tZh('route.deepseekApi', { id: 'search-enhanced' }))

    const { container: c4 } = mountPage({ routeState: { kind: 'unknown' } })
    expect(c4.textContent).toContain(tZh('route.unknown'))

    const { container: c5 } = mountPage({ routeState: { kind: 'this' } })
    expect(c5.querySelector('.warning')).toBeNull()
  })

  it('lists pairings and forgets a pairing on button click', async () => {
    const { container, forgetPairing } = mountPage({
      pairingsList: [
        { provider: 'deepseek', model: 'deepseek-chat', connectionId: 'builtin:exa' },
        { provider: 'openai', model: 'gpt-4o', connectionId: null },
      ],
    })
    expect(container.textContent).toContain('deepseek / deepseek-chat')
    expect(container.textContent).toContain('Exa')
    expect(container.textContent).toContain('openai / gpt-4o')
    expect(container.textContent).toContain(tZh('connection.off'))

    const clearButtons = container.querySelectorAll('button')
    const clearBtn = [...clearButtons].find(b => b.textContent?.includes('清除'))!
    expect(clearBtn).toBeDefined()
    click(clearBtn)
    await flush()
    expect(forgetPairing).toHaveBeenCalledWith('deepseek', 'deepseek-chat')
  })

  it('toggles showSelector and enables/disables connections', async () => {
    const { mutate, row } = mountPage()
    const exaRow = row('Exa')
    const exaSwitch = exaRow.querySelector('[role="switch"]')
    click(exaSwitch)
    await flush()
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['connections', 'builtin:exa', 'disabled'], value: true }], 8)
  })

  it('restores default settings upon confirmation', async () => {
    const { container, mutate } = mountPage({
      user: { version: 2, defaultConnection: 'builtin:exa', defaults: { freshness: 'realtime' } },
    })
    const restoreBtn = byText(container, 'button', tZh('reset.button'))!
    click(restoreBtn)
    await flush()
    expect(container.textContent).toContain(tZh('reset.confirm'))
    const confirmBtn = byText(container, 'button', tZh('reset.confirmButton'))!
    click(confirmBtn)
    await flush()
    expect(mutate).toHaveBeenCalledWith([
      { op: 'unset', path: ['version'] },
      { op: 'unset', path: ['defaultConnection'] },
      { op: 'unset', path: ['defaults'] },
    ], 8)
  })

  it('adds and removes a custom connection', async () => {
    const { container, mutate, row } = mountPage({
      user: {
        version: 2,
        defaultConnection: 'custom:my-search',
        connections: {
          'builtin:exa': { disabled: true },
          'custom:my-search': { kind: 'adapter', label: 'MySearch', adapter: 'exa', credentialRef: 'MY_KEY' },
        },
      },
    })
    expect(container.textContent).toContain('MySearch')
    const customRow = row('MySearch')
    click(byText(customRow, 'button', tZh('custom.remove')))
    await flush()
    expect(customRow.textContent).toContain(tZh('custom.removeConfirm', { name: 'MySearch' }))
    const confirmGroup = customRow.querySelector('[role="group"]')!
    click(byText(confirmGroup, 'button', tZh('custom.remove')))
    await flush()
    expect(mutate).toHaveBeenCalledWith([
      { op: 'unset', path: ['connections', 'custom:my-search'] },
      { op: 'unset', path: ['defaultConnection'] },
    ], 8)
  })
})
