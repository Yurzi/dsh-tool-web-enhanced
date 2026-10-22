// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { createCredentialEditor, type CredentialCopyKey } from '../src/client/settings/CredentialEditor.tsx'
import { effectiveDocument, useSettingsDocument } from '../src/client/settings/document.ts'
import { createEnhancedToolsSection } from '../src/client/settings/EnhancedToolsSection.tsx'
import { createOptionsEditor } from '../src/client/settings/OptionsEditor.tsx'
import { applyOps, createSettingsParts, type WriteSettings } from '../src/client/settings/parts.tsx'
import { createServicesSection, type ServicesCopyKey } from '../src/client/settings/ServicesSection.tsx'
import { createSparseSettings } from '../src/client/settings/sparse.ts'
import { remoteServicesOffSource } from '../src/client/remote-services.ts'
import { resolveDocument } from '../src/shared/settings.ts'

const t = (key: string, params: Record<string, string | number> = {}) => key + (params.name === undefined ? '' : ': ' + params.name)
const parts = createSettingsParts<string>({ classes: {}, keys: { refused: 'refused', invalid: 'invalid', failed: 'failed' } })
const sparse = createSparseSettings({ version: 2, fields: ['version', 'enhancedTools', 'connections'] })
const identity = <T extends string>(names: readonly T[]) => Object.fromEntries(names.map(name => [name, name])) as Record<T, T>
const SERVICE_KEYS = identity<ServicesCopyKey>(['credential.reference', 'credential.referenceHint', 'services.trust', 'services.trustUnsaved', 'options.invalid', 'options.default', 'services.title', 'services.optInNotice', 'options.hint', 'options.keylessMore', 'services.remoteNotice', 'services.off', 'services.configureLabel', 'services.configure', 'services.enable', 'services.access', 'services.accessKeyless', 'services.accessPersonal', 'services.accessHint.keyless', 'services.accessHint.apiKey', 'services.accountHint', 'services.getKey', 'options.title', 'services.keyless', 'services.account', 'services.personalKey', 'credential.set', 'credential.unset'])
const CREDENTIAL_KEYS = identity<CredentialCopyKey>(['credential.label', 'credential.set', 'credential.unset', 'credential.placeholder', 'saving', 'credential.save', 'credential.saved', 'credential.failed', 'credential.hint'])
const optionsEditor = createOptionsEditor<string>({ classes: {}, parts, keys: { 'options.default': 'options.default', 'options.invalid': 'options.invalid', 'options.invalidLine': 'options.invalidLine', 'options.invalidItem': 'options.invalidItem', 'options.exclusive': 'options.exclusive', 'options.tooMany': 'options.tooMany', 'options.on': 'options.on', 'options.off': 'options.off' }, valueLabel: value => value })
const CredentialEditor = createCredentialEditor<string>({ classes: {}, keys: CREDENTIAL_KEYS })

const adapter = (label: string, optIn: boolean) => ({
  label, kind: 'adapter', remote: true, optIn, endpoint: 'https://' + label.toLowerCase() + '.example/api',
  access: { keyless: true, apiKey: { credentialRef: label.toUpperCase() + '_KEY' }, account: false },
  // One option either route takes, one only the API-key route takes.
  options: { kept: { kind: 'text', pattern: /^.*$/u, maxLength: 100 }, privateOnly: { kind: 'text', pattern: /^.*$/u, maxLength: 100, keyless: false } },
}) as const
const CATALOG = { remote: adapter('Remote', true), plain: adapter('Plain', false) } as const
type Key = keyof typeof CATALOG
type Settings = { version?: number; enhancedTools?: boolean; connections?: Record<string, unknown> }

const Services = createServicesSection<Settings, Key, string>({
  classes: { note: 'note' }, keys: SERVICE_KEYS, parts, CredentialEditor, optionsEditor, sparse, catalog: CATALOG, optionCopy: () => ({ options: {}, fallback: 'option' }),
})
const EnhancedTools = createEnhancedToolsSection<string>({ classes: { settingLead: 'lead', hint: 'hint' }, parts, sparse, keys: { title: 'enhanced.title', description: 'enhanced.description', consent: 'enhanced.consent' } })

/** The Host's resolution of the effective document. */
const resolve = (document: unknown) => resolveDocument({ catalog: CATALOG, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:plain' }, capabilityLabel: 'test' })

type Layer = boolean | undefined
const LAYERS: readonly Layer[] = [undefined, false, true]
const name = (value: Layer) => value === undefined ? 'unwritten' : String(value)
const cases = <T,>(extra: readonly T[]) => LAYERS.flatMap(base => LAYERS.flatMap(user => extra.map(more => [name(base), name(user), more, base, user] as const)))

function mount<P>(Component: (props: P) => React.ReactNode, layers: { base: Settings; user: Settings }, props: Omit<P, 'doc' | 'write' | 't'>, editable = true) {
  const writes: SettingsPathOpView[][] = []
  const write: WriteSettings = async change => { writes.push([...(typeof change === 'function' ? change(layers) : change)]); return true }
  const Any = Component as (props: Record<string, unknown>) => React.ReactNode
  render(<Any {...props} doc={{ config: effectiveDocument(layers), layers, revision: 1, editable }} write={write} t={t} />)
  const user = () => writes.reduce<unknown>((layer, ops) => applyOps(layer, ops), layers.user) as Settings
  return { writes, user, after: () => resolve(effectiveDocument({ base: layers.base, user: user() })) }
}
const services = (layers: { base: Settings; user: Settings }) => mount(Services, layers, { credentials: {}, saveCredential: async () => {} })
const overrideLayer = (id: string, disabled: Layer): Settings => disabled === undefined ? {} : { connections: { [id]: { disabled } } }

afterEach(cleanup)

describe('service switches on layered settings', () => {
  it.each(cases<Key>(['remote', 'plain']))('inherited %s, user %s, %s: shows what the Host resolves and toggles it sparsely', async (_base, _user, key, base, user) => {
    const id = 'builtin:' + key
    const layers = { base: overrideLayer(id, base), user: { version: 2, ...overrideLayer(id, user) } }
    const before = resolve(effectiveDocument(layers)).connections.get(id)!.disabled
    const h = services(layers)
    const toggle = screen.getByRole('switch', { name: 'services.enable: ' + CATALOG[key].label })
    expect(toggle.getAttribute('aria-checked')).toBe(String(!before))

    fireEvent.click(toggle)
    await waitFor(() => { expect(h.writes).toHaveLength(1) })
    const target = !before
    expect(h.after().connections.get(id)!.disabled).toBe(target)
    // The user layer keeps the field only where it differs from what the lower layer, or else the catalog, gives.
    const inherited = base ?? CATALOG[key].optIn
    const stored = (h.user().connections?.[id] as { disabled?: boolean } | undefined)?.disabled
    expect(stored).toBe(target === inherited ? undefined : target)
  })

  it('turns a remote service on by writing disabled: false and off again by removing it', async () => {
    let h = services({ base: {}, user: { version: 2 } })
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Remote' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:remote', 'disabled'], value: false }]]) })
    cleanup()
    h = services({ base: {}, user: { version: 2, connections: { 'builtin:remote': { disabled: false } } } })
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Remote' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'unset', path: ['connections'] }]]) })
  })

  it('turns off a remote service the lower layer turned on by writing disabled: true', async () => {
    const h = services({ base: { connections: { 'builtin:remote': { disabled: false } } }, user: { version: 2 } })
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Remote' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:remote', 'disabled'], value: true }]]) })
  })

  it('marks a remote service off until it is turned on', () => {
    services({ base: {}, user: { version: 2 } })
    const row = (label: string) => screen.getByText(label).closest('li')!
    expect(row('Remote').textContent).toContain('services.off')
    expect(row('Plain').textContent).not.toContain('services.off')
  })

  it('says once, above the list, that remote services are off by default', () => {
    services({ base: {}, user: { version: 2 } })
    const notice = screen.getByText('services.optInNotice')
    expect(notice.className).toBe('note')
    expect(notice.compareDocumentPosition(screen.getByRole('list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('has nothing to say about defaults for a catalog without remote services to turn on', () => {
    const Local = createServicesSection<Settings, 'plain', string>({
      classes: {}, keys: SERVICE_KEYS, parts, CredentialEditor, optionsEditor, sparse, catalog: { plain: CATALOG.plain }, optionCopy: () => ({ options: {}, fallback: 'option' }),
    })
    mount(Local, { base: {}, user: { version: 2 } }, { credentials: {}, saveCredential: async () => {} })
    expect(screen.queryByText('services.optInNotice')).toBeNull()
  })
})

describe('labels written over several lines', () => {
  it('shows a service label on one line and toggles the service without touching the label', async () => {
    const h = services({ base: {}, user: { version: 2, connections: { 'builtin:plain': { label: 'Team\nPlain' } } } })
    expect(screen.getByText('Team Plain')).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Team Plain' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:plain', 'disabled'], value: true }]]) })
  })
})

describe('enhanced tools switch', () => {
  const enhanced = (layers: { base: Settings; user: Settings }, editable = true) => mount(EnhancedTools, layers, {}, editable)
  const layer = (value: Layer): Settings => value === undefined ? {} : { enhancedTools: value }

  it('describes what it turns on and what turning it on agrees to, beside one switch', () => {
    enhanced({ base: {}, user: { version: 2 } })
    expect(screen.getByRole('heading', { name: 'enhanced.title' })).toBeDefined()
    expect(screen.getByText('enhanced.description')).toBeDefined()
    expect(screen.getByText('enhanced.consent')).toBeDefined()
    expect(screen.getByRole('switch', { name: 'enhanced.title' }).getAttribute('aria-checked')).toBe('false')
  })

  it('reads as one group named by the section title and described by what it does and what it agrees to', () => {
    enhanced({ base: {}, user: { version: 2 } })
    const group = screen.getByRole('group', { name: 'enhanced.title', description: 'enhanced.description enhanced.consent' })
    expect(group.contains(screen.getByRole('switch', { name: 'enhanced.title' }))).toBe(true)
    // What it does leads, like another row's title; the consent reads as its hint.
    expect(screen.getByText('enhanced.description').className).toBe('lead')
    expect(screen.getByText('enhanced.consent').className).toBe('hint')
  })

  it.each(cases([null]))('inherited %s, user %s: shows what the Host resolves and toggles it sparsely', async (_base, _user, _, base, user) => {
    const layers = { base: layer(base), user: { version: 2, ...layer(user) } }
    const before = resolve(effectiveDocument(layers)).enhancedTools
    const h = enhanced(layers)
    const toggle = screen.getByRole('switch', { name: 'enhanced.title' })
    expect(toggle.getAttribute('aria-checked')).toBe(String(before))

    fireEvent.click(toggle)
    await waitFor(() => { expect(h.writes).toHaveLength(1) })
    expect(h.after().enhancedTools).toBe(!before)
    const inherited = base ?? false
    expect(h.user().enhancedTools).toBe(!before === inherited ? undefined : !before)
  })

  it('writes enhancedTools: true to turn on, removes it to turn off, and writes false over an inherited true', async () => {
    let h = enhanced({ base: {}, user: {} })
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['enhancedTools'], value: true }, { op: 'set', path: ['version'], value: 2 }]]) })
    cleanup()
    h = enhanced({ base: {}, user: { version: 2, enhancedTools: true } })
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'unset', path: ['enhancedTools'] }]]) })
    cleanup()
    h = enhanced({ base: { enhancedTools: true }, user: { version: 2 } })
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['enhancedTools'], value: false }]]) })
  })

  it('cannot be changed on a read-only page', () => {
    enhanced({ base: {}, user: { version: 2 } }, false)
    expect(screen.getByRole('switch', { name: 'enhanced.title' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('the composer menu fact about remote services', () => {
  const form = (value: Settings | undefined, user: Settings = {}, base: Settings = {}) => createSnapshotStore<ConfigFormSnapshot<Settings>>({ status: value === undefined ? 'loading' : 'ready', value, base, user, revision: 1, writable: true })

  it('holds while every opt-in service is off, by the same resolution as the Host', () => {
    expect(remoteServicesOffSource(form({}), CATALOG, resolve).getSnapshot()).toBe(true)
    // Connections that start on do not count, however many there are.
    const plainOff = { connections: { 'builtin:plain': { disabled: true } } }
    expect(remoteServicesOffSource(form(plainOff, plainOff), CATALOG, resolve).getSnapshot()).toBe(true)
  })

  it.each([
    ['the user layer', { connections: { 'builtin:remote': { disabled: false } } }, {}],
    ['the lower layer', {}, { connections: { 'builtin:remote': { disabled: false } } }],
  ])('stops holding once %s turns a remote service on', (_, user, base) => {
    expect(remoteServicesOffSource(form({}, user, base), CATALOG, resolve).getSnapshot()).toBe(false)
  })

  it('does not hold while the settings are unread or invalid, or for a catalog without opt-in services', () => {
    expect(remoteServicesOffSource(form(undefined), CATALOG, resolve).getSnapshot()).toBe(false)
    expect(remoteServicesOffSource(form({}, { connections: { 'builtin:unknown': {} } }), CATALOG, resolve).getSnapshot()).toBe(false)
    const plain = { plain: CATALOG.plain }
    const resolvePlain = (document: unknown) => resolveDocument({ catalog: plain, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:plain' }, capabilityLabel: 'test' })
    expect(remoteServicesOffSource(form({}), plain, resolvePlain).getSnapshot()).toBe(false)
  })

  it('follows the settings as they change and notifies the subscriber', () => {
    const settings = form({})
    const fact = remoteServicesOffSource(settings, CATALOG, resolve)
    let notified = 0
    const unsubscribe = fact.subscribe(() => { notified += 1 })
    expect(fact.getSnapshot()).toBe(true)
    const user = { connections: { 'builtin:remote': { disabled: false } } }
    settings.set({ status: 'ready', value: user, base: {}, user, revision: 2, writable: true })
    expect(notified).toBe(1)
    expect(fact.getSnapshot()).toBe(false)
    unsubscribe()
  })
})

describe('writes from several sections in quick succession', () => {
  function deferred() {
    let release!: () => void
    const promise = new Promise<void>(done => { release = done })
    return { promise, resolve: release }
  }

  /** A row ConfigForm as DSH's: one write on the wire at a time, fenced by revision, the mirror updated on acceptance. */
  function fakeForm(initial: Settings) {
    let snapshot: ConfigFormSnapshot<Settings> = { status: 'ready', value: initial, base: {}, user: initial, revision: 1, writable: true }
    // What the Host holds; a change made elsewhere reaches it before the page's mirror.
    const host: { user: Settings; revision: number } = { user: initial, revision: 1 }
    const listeners = new Set<() => void>()
    const arrived: { ops: SettingsPathOpView[]; revision: number; release: () => void }[] = []
    let tail: Promise<unknown> = Promise.resolve()
    const mutate = (ops: SettingsPathOpView[], revision: number): Promise<boolean> => {
      const task = tail.then(async () => {
        const gate = deferred()
        arrived.push({ ops, revision, release: gate.resolve })
        await gate.promise
        if (revision !== host.revision) return false
        host.user = applyOps(host.user, ops)
        host.revision += 1
        snapshot = { ...snapshot, value: host.user, user: host.user, revision: host.revision }
        for (const listener of listeners) listener()
        return true
      })
      tail = task.then(() => {}, () => {})
      return task
    }
    const elsewhere = (ops: SettingsPathOpView[]) => {
      host.user = applyOps(host.user, ops)
      host.revision += 1
    }
    /** A change made elsewhere that has already reached the page's mirror. */
    const arrivedElsewhere = (ops: SettingsPathOpView[]) => {
      elsewhere(ops)
      snapshot = { ...snapshot, value: host.user, user: host.user, revision: host.revision }
      for (const listener of listeners) listener()
    }
    return {
      arrived, mutate, elsewhere, arrivedElsewhere, host,
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    }
  }

  function mountPage(form: ReturnType<typeof fakeForm>) {
    function Page() {
      const snapshot = useSyncExternalStore(form.subscribe, form.getSnapshot)
      const { view, write } = useSettingsDocument(snapshot, form.getSnapshot, resolve, form.mutate)
      if (view?.kind !== 'ready') throw new Error('test settings are invalid')
      const doc = { config: view.config, layers: view.layers, revision: snapshot.revision!, editable: true }
      return <>
        <EnhancedTools doc={doc} write={write} t={t} />
        <Services doc={doc} write={write} credentials={{}} saveCredential={async () => {}} t={t} />
      </>
    }
    render(<Page />)
  }

  it('saves a switch flipped while another section is still saving on top of that write', async () => {
    const form = fakeForm({ version: 2 })
    mountPage(form)
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Remote' }))
    await waitFor(() => { expect(form.arrived).toHaveLength(1) })
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    form.arrived[0]!.release()
    await waitFor(() => { expect(form.arrived).toHaveLength(2) })
    form.arrived[1]!.release()
    await waitFor(() => { expect(form.getSnapshot().revision).toBe(3) })
    expect(form.getSnapshot().user).toEqual({ version: 2, enhancedTools: true, connections: { 'builtin:remote': { disabled: false } } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('switch', { name: 'enhanced.title' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('switch', { name: 'services.enable: Remote' }).getAttribute('aria-checked')).toBe('true')
  })

  it('still refuses a write when the settings changed elsewhere since the page read them', async () => {
    const form = fakeForm({ version: 2 })
    mountPage(form)
    form.elsewhere([{ op: 'set', path: ['enhancedTools'], value: true }])
    fireEvent.click(screen.getByRole('switch', { name: 'services.enable: Remote' }))
    await waitFor(() => { expect(form.arrived).toHaveLength(1) })
    form.arrived[0]!.release()
    expect((await screen.findByRole('alert')).textContent).toBe('refused')
    expect(form.getSnapshot().revision).toBe(1)
  })

  const apiKeyUser = (options: Record<string, string>): Settings => ({ version: 2, connections: { 'builtin:remote': { access: 'api-key', options } } })
  const remoteOverride = (user: Settings) => user.connections?.['builtin:remote']

  it('computes the options a keyless switch keeps from the layers it is given, not from the render', () => {
    const shown = apiKeyUser({ kept: 'old', privateOnly: 'drop' })
    let queued: Parameters<WriteSettings>[0] | undefined
    const write: WriteSettings = change => { queued = change; return Promise.resolve(true) }
    render(<Services doc={{ config: shown, layers: { base: {}, user: shown }, revision: 1, editable: true }} write={write} credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: Remote' }))
    fireEvent.click(screen.getByRole('tab', { name: 'services.accessKeyless' }))
    if (typeof queued !== 'function') throw new Error('the access switch did not queue a change')
    const latest = apiKeyUser({ kept: 'new', privateOnly: 'drop' })
    expect(remoteOverride(applyOps(latest, queued({ base: {}, user: latest })))).toEqual({ options: { kept: 'new' } })
  })

  it('switches to keyless without overwriting an option changed elsewhere while it waited', async () => {
    const form = fakeForm(apiKeyUser({ kept: 'old', privateOnly: 'drop' }))
    mountPage(form)
    fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: Remote' }))
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    await waitFor(() => { expect(form.arrived).toHaveLength(1) })
    fireEvent.click(screen.getByRole('tab', { name: 'services.accessKeyless' }))
    act(() => { form.arrivedElsewhere([{ op: 'set', path: ['connections', 'builtin:remote', 'options', 'kept'], value: 'new' }]) })
    // The write queued first was computed on revision 1 and is refused; the switch then runs on revision 2.
    form.arrived[0]!.release()
    await waitFor(() => { expect(form.arrived).toHaveLength(2) })
    form.arrived[1]!.release()
    await waitFor(() => { expect(form.host.revision).toBe(3) })
    expect(remoteOverride(form.host.user)).toEqual({ options: { kept: 'new' } })
  })

  it('also drops an option the keyless route rejects that was added elsewhere while the switch waited', async () => {
    const form = fakeForm(apiKeyUser({ kept: 'old' }))
    mountPage(form)
    fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: Remote' }))
    fireEvent.click(screen.getByRole('switch', { name: 'enhanced.title' }))
    await waitFor(() => { expect(form.arrived).toHaveLength(1) })
    fireEvent.click(screen.getByRole('tab', { name: 'services.accessKeyless' }))
    act(() => { form.arrivedElsewhere([{ op: 'set', path: ['connections', 'builtin:remote', 'options', 'privateOnly'], value: 'added' }]) })
    form.arrived[0]!.release()
    await waitFor(() => { expect(form.arrived).toHaveLength(2) })
    form.arrived[1]!.release()
    await waitFor(() => { expect(form.host.revision).toBe(3) })
    expect(remoteOverride(form.host.user)).toEqual({ options: { kept: 'old' } })
    expect(resolve(effectiveDocument({ base: {}, user: form.host.user })).connections.get('builtin:remote')).toMatchObject({ access: 'keyless', options: { kept: 'old' } })
  })
})
