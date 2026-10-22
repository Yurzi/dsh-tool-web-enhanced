// @vitest-environment jsdom
import { act, useSyncExternalStore, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { Pairing, Route } from 'dsh-tool-web-enhanced-core/shared'
import type { FetchSettings } from '../src/settings/types.ts'
import type { CredentialStatusMap, PairingsState } from '../src/client/injected.ts'
import { zh } from '../src/client/locales.ts'
import { SettingsPage, type SettingsPageProps } from '../src/client/settings/SettingsPage.tsx'
import { CATALOG } from '../src/catalog.ts'

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
  credentialsMap = { DEEPSEEK_API_KEY: 'missing' },
  translate = tZh,
}: MountOptions = {}) {
  const snapshot: ConfigFormSnapshot<FetchSettings> = {
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
  const mutate = vi.fn<(ops: import('@deepseek-ai/dsh-api-remotes/client').SettingsPathOpView[], revision: number) => Promise<boolean>>(async () => true)
  const saveCredential = vi.fn(async () => {})
  const forgetPairing = vi.fn(async () => {})
  const refreshPairings = vi.fn(async () => {})

  const props = {
    view: 'page' as const,
    useSettings: bindHook(settings),
    useCredentials: bindHook(credentials),
    useRoute: bindHook(route),
    usePairings: bindHook(pairings),
    readSettings: () => settings.getSnapshot(),
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
function input(h: ReturnType<typeof mountPage>, label: string): HTMLInputElement | HTMLTextAreaElement {
  const element = [...h.container.querySelectorAll('input,textarea')].find(candidate => candidate.id !== '' && h.container.querySelector('label[for="' + candidate.id + '"]')?.textContent === tZh(label))
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error('missing input: ' + label)
  return element
}

describe('fetch row settings', () => {
  it('localizes the local connection in defaults and services without changing custom labels', () => {
    const h = mountPage({ pairingsList: [{ provider: 'p', model: 'm', connectionId: 'builtin:local' }] })
    expect(h.container.textContent).not.toContain('Local HTTP')
    expect(h.container.textContent).toContain(tZh('connection.local'))
    expect(h.container.querySelector('[aria-label="' + tZh('defaults.connection') + '"]')?.textContent).toContain(tZh('connection.local'))
  })

  it('preserves custom local names in defaults, services, and model memories', () => {
    const h = mountPage({ user: { version: 2, connections: { 'builtin:local': { label: 'My network' } } }, pairingsList: [{ provider: 'p', model: 'm', connectionId: 'builtin:local' }] })
    expect(h.row('My network').textContent).toContain('My network')
    expect(h.container.textContent).not.toContain('Local HTTP')
    expect(h.container.querySelector('[aria-label="' + tZh('defaults.connection') + '"]')?.textContent).toContain('My network')
  })

  it.each(['providerId', 'freshness', 'schemaVersion', 'allowCidrs'])('diagnoses projected-out user field %s and permits reset', async field => {
    const h = mountPage()
    const user = { version: 2, [field]: 'old' }
    act(() => { h.settings.set({ status: 'ready', value: { version: 2 }, base: {}, user, revision: 9, writable: true }) })
    await flush()
    const alert = h.container.querySelector<HTMLElement>('[role="alert"]')
    expect(alert?.textContent).toBe(tZh('settings.unsupported'))
    expect(alert?.title).toContain(field)
    expect(h.container.querySelector('[role="switch"], input')).toBeNull()
    expect(h.mutate).not.toHaveBeenCalled()
    click(byText(h.container, 'button', tZh('reset.button')))
    click(byText(h.container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(h.mutate).toHaveBeenCalledWith(Object.keys(user).map(key => ({ op: 'unset', path: [key] })), 9)
  })

  it('writes showSelector sparsely without affecting the connection default', async () => {
    const h = mountPage()
    const toggle = h.container.querySelector('[role="switch"][aria-label="' + tZh('defaults.showSelector') + '"]')
    click(toggle)
    await flush()
    expect(h.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['showSelector'], value: false }], 8)
  })
  it('does not migrate an unavailable snapshot and recovers on a valid revision', async () => {
    const h = mountPage()
    act(() => { h.settings.set({ status: 'unavailable', value: { version: 1 }, base: {}, user: { version: 1 }, revision: 9, writable: true } as unknown as ConfigFormSnapshot<FetchSettings>) })
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
    expect(alert.textContent).toBe(tZh('settings.unsupported'))
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
    expect(h.container.querySelector('[role="alert"]')?.textContent).toBe(tZh('settings.unsupported'))
    expect((byText(h.container, 'button', tZh('reset.button')) as HTMLButtonElement).disabled).toBe(true)
    expect(h.mutate).not.toHaveBeenCalled()
  })


  it('saves both allowlists only after the explicit button, in one revision-fenced write', async () => {
    const h = mountPage()
    h.configure(tZh('connection.local'))
    type(input(h, 'allowlist.allowCidrs'), '198.18.0.0/15')
    type(input(h, 'allowlist.allowHostnames'), '*.docs.example.com')
    expect(h.mutate).not.toHaveBeenCalled()
    click(byText(h.container, 'button', tZh('allowlist.save')))
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: ['198.18.0.0/15'] },
      { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowHostnames'], value: ['*.docs.example.com'] },
    ], 8)
  })

  it('auto-saves a valid local limit sparsely and leaves invalid text unsaved', async () => {
    const h = mountPage()
    h.configure(tZh('connection.local'))
    const timeout = input(h, 'option.local.timeoutMs')
    type(timeout, '0')
    blur(timeout)
    await flush()
    expect(h.mutate).not.toHaveBeenCalled()
    type(timeout, '4200')
    blur(timeout)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:local', 'options', 'timeoutMs'], value: 4200 }], 8)
  })

  it('preserves an explicitly empty User-Agent rather than treating it as inherit', async () => {
    const h = mountPage()
    h.configure(tZh('connection.local'))
    const ua = input(h, 'option.local.userAgent')
    type(ua, '')
    blur(ua)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:local', 'options', 'userAgent'], value: '' }], 8)
  })

  it('requires trust and writes a custom API URL and its consent atomically', async () => {
    const h = mountPage()
    h.configure('DeepSeek Fetch API')
    expect(h.container.textContent).toContain('URL 会发送给 DeepSeek')
    const url = input(h, 'option.native.baseURL')
    type(url, 'https://proxy.example.com/v1/tools')
    blur(url)
    await flush()
    expect(h.mutate).not.toHaveBeenCalled()
    const trust = [...h.row('DeepSeek Fetch API').querySelectorAll('[role="switch"]')].find(element => element.getAttribute('aria-label') === tZh('option.native.trust'))
    click(trust)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'set', path: ['connections', 'builtin:deepseek-fetch-api', 'options', 'baseURL'], value: 'https://proxy.example.com/v1/tools' },
      { op: 'set', path: ['connections', 'builtin:deepseek-fetch-api', 'trustedEndpoint'], value: true },
    ], 8)
  })

  it('keeps keys in Credentials and the credential name in settings', async () => {
    const h = mountPage()
    h.configure('DeepSeek Fetch API')
    const ref = input(h, 'credential.reference')
    type(ref, 'FETCH_KEY')
    blur(ref)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:deepseek-fetch-api', 'credentialRef'], value: 'FETCH_KEY' }], 8)
    const key = h.container.querySelector('input[type="password"]')!
    type(key, 'secret')
    click(byText(h.container, 'button', tZh('credential.save')))
    await flush()
    expect(h.saveCredential).toHaveBeenCalledWith('DEEPSEEK_API_KEY', 'secret')
    expect(JSON.stringify(h.mutate.mock.calls)).not.toContain('secret')
  })

  it('revokes endpoint trust when the API URL is cleared', async () => {
    const h = mountPage({ user: { version: 2, connections: { 'builtin:deepseek-fetch-api': { label: 'Fetch API', trustedEndpoint: true, options: { baseURL: 'https://proxy.example.com/v1/tools' } } } } })
    h.configure('Fetch API')
    const url = input(h, 'option.native.baseURL')
    type(url, '')
    blur(url)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'unset', path: ['connections', 'builtin:deepseek-fetch-api', 'options'] },
      { op: 'unset', path: ['connections', 'builtin:deepseek-fetch-api', 'trustedEndpoint'] },
    ], 8)
  })

  it('leaves the allowlist and User-Agent to the local editors and the limits to the shared form', () => {
    const h = mountPage()
    h.configure(tZh('connection.local'))
    const local = h.row(tZh('connection.local'))
    const labels = [...local.querySelectorAll('label')].map(label => label.textContent)
    expect(labels.filter(label => label === tZh('option.local.userAgent'))).toHaveLength(1)
    expect(labels.filter(label => label === tZh('allowlist.allowCidrs'))).toHaveLength(1)
    for (const key of ['option.local.maxResponseBytes', 'option.local.maxBodyChars', 'option.local.timeoutMs', 'option.local.maxRedirects']) expect(labels).toContain(tZh(key))
    expect(local.textContent).not.toContain(tZh('credential.reference'))
  })

  it('shows every remote service from the catalog with who receives the URL and its options per route', () => {
    const h = mountPage()
    for (const name of ['Exa', 'Firecrawl', 'Tavily', 'Tinyfish']) {
      expect(h.row(name).textContent).not.toContain(tZh('services.remoteNotice', { name }))
      h.configure(name)
      expect(h.row(name).textContent).toContain(tZh('services.remoteNotice', { name }))
      h.configure(name)
    }
    h.configure('Exa')
    expect(h.row('Exa').textContent).toContain(tZh('services.note.exa'))
    expect(h.row('Exa').textContent).not.toContain(tZh('option.exa.maxAgeHours'))
    expect(h.row('Exa').textContent).toContain(tZh('options.keylessMore'))
    h.configure('Tinyfish')
    expect(input(h, 'option.tinyfish.ttl').placeholder).toBe('默认')
    expect(input(h, 'credential.reference').value).toBe('TINYFISH_API_KEY')
  })

  it('says how the local connection reaches pages, as the menu does, and keyless services need no key', () => {
    const h = mountPage()
    expect(h.row(tZh('connection.local')).textContent).toContain(tZh('access.local'))
    expect(h.row(tZh('connection.local')).textContent).not.toContain(tZh('services.keyless'))
    expect(h.row('Tavily').textContent).toContain(tZh('services.keyless'))
  })

  it('keeps the default placeholder on numeric cache options and explains special values below them', () => {
    const h = mountPage({ user: { version: 2, connections: { 'builtin:exa': { access: 'api-key' }, 'builtin:tinyfish': {} } } })
    const hintOf = (element: HTMLElement) => document.getElementById(element.getAttribute('aria-describedby')!)?.textContent
    h.configure('Exa')
    for (const key of ['option.exa.maxAgeHours', 'option.exa.livecrawlTimeout']) expect(input(h, key).placeholder).toBe('默认')
    expect(hintOf(input(h, 'option.exa.maxAgeHours'))).toBe('0 为总是实时，-1 为只用缓存')
    h.configure('Firecrawl')
    expect(input(h, 'option.firecrawl.maxAge').placeholder).toBe('默认')
    expect(hintOf(input(h, 'option.firecrawl.maxAge'))).toBe('0 为总是实时；1 天 = 86 400 000 毫秒')
    h.configure('Tinyfish')
    expect(input(h, 'option.tinyfish.ttl').placeholder).toBe('默认')
    expect(hintOf(input(h, 'option.tinyfish.ttl'))).toBe('0 为总是实时')
  })

  it('accepts a cache age of -1 for Exa on the personal-key route', async () => {
    const h = mountPage({ user: { version: 2, connections: { 'builtin:exa': { access: 'api-key' } } } })
    h.configure('Exa')
    const age = input(h, 'option.exa.maxAgeHours')
    type(age, '-1')
    blur(age)
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:exa', 'options', 'maxAgeHours'], value: -1 }], 8)
  })

  it('shows the custom connection section because the catalog has adapter entries, offering them as formats', () => {
    const h = mountPage()
    expect(h.container.textContent).toContain(tZh('custom.title'))
    expect(h.container.textContent).toContain(tZh('custom.empty'))
    click(byText(h.container, 'button', tZh('custom.addStructured')))
    const format = h.container.querySelector('[aria-label="' + tZh('editor.adapter') + '"]')
    expect(format?.textContent).toContain('Exa')
    expect(input(h, 'editor.endpoint').placeholder).toBe(CATALOG.exa.endpoint)
  })

  it('shows an unset boolean option as the service default rather than off', async () => {
    const h = mountPage()
    h.configure('Firecrawl')
    const menu = byText(h.row('Firecrawl'), 'button[aria-label="' + tZh('option.firecrawl.onlyMainContent') + '"]', '')!
    expect(menu.textContent).toContain(tZh('options.default'))
    expect(h.row('Firecrawl').querySelector('[role="switch"][aria-label="' + tZh('option.firecrawl.onlyMainContent') + '"]')).toBeNull()
    click(menu)
    click(byText(document.body, '[role="menuitem"]', tZh('options.off')))
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'set', path: ['connections', 'builtin:firecrawl', 'options', 'onlyMainContent'], value: false }], 8)
  })

  it('switches Exa back to the keyless route together with dropping its personal-key options', async () => {
    const h = mountPage({ user: { version: 2, connections: { 'builtin:exa': { access: 'api-key', options: { maxAgeHours: 24 } } } } })
    h.configure('Exa')
    click(byText(h.row('Exa'), '[role="tab"]', tZh('services.accessKeyless')))
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([
      { op: 'unset', path: ['connections', 'builtin:exa', 'access'] },
      { op: 'unset', path: ['connections', 'builtin:exa', 'options'] },
    ], 8)
  })

  it('removes the last custom connection without touching a built-in default', async () => {
    const h = mountPage({ user: { version: 2, defaultConnection: 'builtin:exa', connections: {
      'custom:team': { kind: 'adapter', adapter: 'firecrawl', label: 'Team', credentialRef: 'TEAM_KEY', endpoint: 'https://scrape.team.internal/v2/scrape', trustedEndpoint: true },
    } } })
    expect(h.row('Team').textContent).toContain(tZh('services.remoteNotice', { name: 'Firecrawl (scrape.team.internal)' }))
    click(byText(h.row('Team'), 'button', tZh('custom.remove')))
    click(byText(h.row('Team').querySelector('[role="group"]')!, 'button', tZh('custom.remove')))
    await flush()
    expect(h.mutate).toHaveBeenCalledExactlyOnceWith([{ op: 'unset', path: ['connections'] }], 8)
  })

  it('lists model memories, clears them and confirms reset without deleting credentials', async () => {
    const h = mountPage({ pairingsList: [{ provider: 'p', model: 'm', connectionId: null }], user: { version: 2, defaultConnection: 'builtin:deepseek-fetch-api' } })
    expect(h.container.textContent).toContain('p / m')
    click(byText(h.container, 'button', tZh('pairings.forget')))
    await flush()
    expect(h.forgetPairing).toHaveBeenCalledWith('p', 'm')
    click(byText(h.container, 'button', tZh('reset.button')))
    click(byText(h.container, 'button', tZh('reset.confirmButton')))
    await flush()
    expect(h.mutate).toHaveBeenCalledWith([{ op: 'unset', path: ['version'] }, { op: 'unset', path: ['defaultConnection'] }], 8)
    expect(h.saveCredential).not.toHaveBeenCalled()
  })

  it('shows a refused revision as a conflict rather than invalid settings', async () => {
    const h = mountPage()
    h.mutate.mockResolvedValueOnce(false)
    click(h.row(tZh('connection.local')).querySelector('[role="switch"]'))
    await flush()
    const alert = h.container.querySelector<HTMLElement>('[role="alert"]')!
    expect(alert.textContent).toBe(tZh('settings.refused'))
    expect(alert.title).toBe('')
  })

  it('shows route and read-only notices without allowing writes', () => {
    const h = mountPage({ writable: false, routeState: { kind: 'other', provider: 'http', providerId: 'fetch-enhanced' } })
    expect(h.container.textContent).toContain(tZh('settings.readOnly'))
    expect(h.container.textContent).toContain(tZh('route.other', { provider: 'http', id: 'fetch-enhanced' }))
    h.configure(tZh('connection.local'))
    expect(input(h, 'allowlist.allowCidrs').disabled).toBe(true)
    expect(h.mutate).not.toHaveBeenCalled()
  })
})

describe('remote services off by default and the Enhanced tools switch', () => {
  const headings = (container: HTMLElement) => [...container.querySelectorAll('h4')].map(heading => heading.textContent)
  const enabled = (row: HTMLElement) => row.querySelector('[role="switch"]')!.getAttribute('aria-checked')

  it('places Enhanced tools right after the defaults and before the services', () => {
    const { container } = mountPage()
    const order = headings(container)
    expect(order.indexOf(tZh('enhanced.title'))).toBe(order.indexOf(tZh('defaults.title')) + 1)
    expect(order.indexOf(tZh('services.title'))).toBe(order.indexOf(tZh('enhanced.title')) + 1)
    const section = [...container.querySelectorAll('h4')].find(heading => heading.textContent === tZh('enhanced.title'))!.closest('section')!
    expect(section.textContent).toContain(tZh('enhanced.consent'))
    expect(section.textContent).toContain(tZh('enhanced.description'))
    expect(section.querySelector('[role="switch"]')!.getAttribute('aria-label')).toBe(tZh('enhanced.title'))
  })

  it('turns the enhanced tools on with one sparse write', async () => {
    const { container, mutate } = mountPage()
    const toggle = container.querySelector('[role="switch"][aria-label="' + tZh('enhanced.title') + '"]')
    expect(toggle!.getAttribute('aria-checked')).toBe('false')
    click(toggle)
    await flush()
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['enhancedTools'], value: true }], 8)
  })

  it('shows remote services off until turned on, says so above the list, and turns one on with disabled: false', async () => {
    const { container, mutate, row } = mountPage()
    const services = [...container.querySelectorAll('h4')].find(heading => heading.textContent === tZh('services.title'))!.closest('section')!
    expect(services.querySelector('p')!.textContent).toBe(tZh('services.optInNotice'))
    expect(enabled(row('Exa'))).toBe('false')
    expect(row('Exa').textContent).toContain(tZh('services.off'))
    expect(enabled(row(tZh('connection.local')))).toBe('true')
    click(row('Exa').querySelector('[role="switch"]'))
    await flush()
    expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['connections', 'builtin:exa', 'disabled'], value: false }], 8)
  })
})
