// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSettingsParts } from '../src/client/settings/parts.tsx'
import { createDefaultsSection } from '../src/client/settings/DefaultsSection.tsx'
import { createRouteNotice } from '../src/client/settings/RouteNotice.tsx'
import { createOptionsEditor } from '../src/client/settings/OptionsEditor.tsx'
import { createSparseSettings } from '../src/client/settings/sparse.ts'
import type { OptionField } from '../src/client/settings/fields.ts'
import { createServicesSection, type ExtraEditorProps, type ServicesCopyKey } from '../src/client/settings/ServicesSection.tsx'
import { createCredentialEditor, type CredentialCopyKey } from '../src/client/settings/CredentialEditor.tsx'
import { createCustomConnectionsSection, type CustomCopyKey } from '../src/client/settings/CustomConnections.tsx'
import type { ModelCopyKey, ModelFormats } from '../src/client/settings/ConnectionEditor.tsx'
import type { SettingsCatalog } from '../src/client/settings/model.ts'
import { applyOps } from '../src/client/settings/parts.tsx'
import { effectiveDocument, useSettingsDocument } from '../src/client/settings/document.ts'
import type { SettingsDocumentSnapshot } from '../src/client/settings/secret-diagnostics.ts'
import { resolveDocument } from '../src/shared/settings.ts'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { z } from 'zod'

const t = (key: string, params: Record<string, string | number> = {}) => key + (params.name === undefined ? '' : ': ' + params.name) + (params.protocol === undefined ? '' : ': ' + params.protocol)
  + (params.item === undefined ? '' : ': ' + params.line + ' ' + params.item) + (params.other === undefined ? '' : ': ' + params.other)
const parts = createSettingsParts<string>({ classes: { section: 'consumer-section' }, keys: { refused: 'fetch.refused', invalid: 'fetch.invalid', failed: 'fetch.failed' } })
const sparse = createSparseSettings({ version: 2, fields: ['version', 'defaultConnection', 'connections'] })
afterEach(cleanup)

describe('settings skeleton with consumer copy and styles', () => {
  it('renders a capability default and its custom controls without a core dictionary', () => {
    const Defaults = createDefaultsSection({ parts, sparse, keys: { title: 'fetch.defaults', connection: 'fetch.connection', connectionHint: 'fetch.hint', connectionUnset: 'fetch.unset', connectionMissing: 'fetch.missing' } })
    const result = render(<Defaults doc={{ config: {}, layers: {}, revision: 1, editable: true }} write={async () => true} t={t}
      defaultConnection={undefined} defaultLabel="Local HTTP" choices={[{ id: 'builtin:local', label: 'Local HTTP' }]}>
      {({ disabled }) => <button disabled={disabled}>Local allowlist</button>}
    </Defaults>)
    expect(result.container.querySelector('.consumer-section')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'fetch.connection' }).textContent).toContain('fetch.unset: Local HTTP')
    expect(screen.getByRole('button', { name: 'Local allowlist' }).hasAttribute('disabled')).toBe(false)
  })

  it('warns about a default only for what this page can fix: a missing key or a disabled connection', () => {
    const Defaults = createDefaultsSection({ parts, sparse, keys: { title: 'd', connection: 'd.connection', connectionHint: 'd.hint', connectionUnset: 'd.unset', connectionMissing: 'd.missing' } })
    const view = (availability: { disabled: boolean; access: 'none' | 'api-key' | 'keyless'; credentialStatus: string | undefined }) => render(
      <Defaults doc={{ config: {}, layers: {}, revision: 1, editable: true }} write={async () => true} t={t} defaultConnection="builtin:x" defaultLabel="X"
        choices={[{ id: 'builtin:x', label: 'X' }]} defaultAvailability={{ ...availability, warning: 'warned' }} />)
    view({ disabled: false, access: 'none', credentialStatus: undefined })
    expect(screen.queryByText('warned')).toBeNull()
    cleanup()
    view({ disabled: true, access: 'none', credentialStatus: undefined })
    expect(screen.getByText('warned')).toBeDefined()
    cleanup()
    view({ disabled: false, access: 'api-key', credentialStatus: 'missing' })
    expect(screen.getByText('warned')).toBeDefined()
  })

  it('uses injected route keys and classes for a different capability', () => {
    const Notice = createRouteNotice({ classes: { warning: 'fetch-warning' }, keys: { unknown: 'fetch.unknown', auto: 'fetch.auto', other: 'fetch.other' } })
    const { rerender } = render(<Notice route={{ kind: 'unknown' }} t={t} />)
    expect(screen.getByRole('status').className).toBe('fetch-warning')
    expect(screen.getByRole('status').textContent).toBe('fetch.unknown')
    rerender(<Notice route={{ kind: 'this' }} t={t} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('commits a zero-valued numeric option through the shared editor', async () => {
    const { OptionsForm } = createOptionsEditor<string>({ classes: {}, parts, keys: { 'options.default': 'fetch.default', 'options.invalid': 'fetch.invalid', 'options.invalidLine': 'fetch.invalidLine', 'options.invalidItem': 'fetch.invalidItem', 'options.exclusive': 'fetch.exclusive', 'options.tooMany': 'fetch.tooMany', 'options.on': 'fetch.on', 'options.off': 'fetch.off' }, valueLabel: value => value })
    const field: OptionField = { name: 'maxRedirects', label: 'fetch.redirects', kind: 'integer', min: 0, max: 20, values: [], placeholder: () => undefined }
    const writes: [string, unknown][] = []
    render(<OptionsForm id="fetch-options" title="Limits" hint="" fields={[field]} stored={{ maxRedirects: 5 }} disabled={false} t={t}
      onCommit={async changes => { writes.push(...Object.entries(changes)); return true }} />)
    const input = screen.getByLabelText('fetch.redirects')
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.blur(input)
    await waitFor(() => { expect(writes).toEqual([['maxRedirects', 0]]) })
  })

  it('shows an unset boolean option as the service default, not as off, and returns it to the default', async () => {
    const { OptionsForm } = createOptionsEditor<string>({ classes: {}, parts, keys: { 'options.default': 'fetch.default', 'options.invalid': 'fetch.invalid', 'options.invalidLine': 'fetch.invalidLine', 'options.invalidItem': 'fetch.invalidItem', 'options.exclusive': 'fetch.exclusive', 'options.tooMany': 'fetch.tooMany', 'options.on': 'fetch.on', 'options.off': 'fetch.off' }, valueLabel: value => value })
    const field: OptionField = { name: 'storeInCache', label: 'fetch.cache', kind: 'boolean', values: [], placeholder: () => undefined }
    const writes: [string, unknown][] = []
    const onCommit = async (changes: Readonly<Record<string, unknown>>) => { writes.push(...Object.entries(changes)); return true }
    const choose = (label: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'fetch.cache' }))
      fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label), hidden: true }))
    }
    const { rerender } = render(<OptionsForm id="o" title="" hint="" fields={[field]} stored={{}} disabled={false} t={t} onCommit={onCommit} />)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByRole('button', { name: 'fetch.cache' }).textContent).toContain('fetch.default')
    choose('fetch.on')
    await waitFor(() => { expect(writes).toEqual([['storeInCache', true]]) })
    rerender(<OptionsForm id="o" title="" hint="" fields={[field]} stored={{ storeInCache: true }} disabled={false} t={t} onCommit={onCommit} />)
    expect(screen.getByRole('button', { name: 'fetch.cache' }).textContent).toContain('fetch.on')
    choose('fetch.off')
    await waitFor(() => { expect(writes.at(-1)).toEqual(['storeInCache', false]) })
    choose('fetch.default')
    await waitFor(() => { expect(writes.at(-1)).toEqual(['storeInCache', undefined]) })
  })
})

const TEST_CATALOG = {
  box: {
    label: 'Box', kind: 'local', remote: false, access: { keyless: true, apiKey: false, account: false },
    options: { agent: { kind: 'text', pattern: /^.*$/u }, limit: { kind: 'integer', min: 0, max: 9 }, hosts: { kind: 'list', pattern: /^.*$/u, max: 5 } },
  },
  session: {
    label: 'Session', kind: 'model', remote: true, access: { keyless: false, apiKey: false, account: false },
    options: { maxTokens: { kind: 'integer', min: 1, max: 100 }, domains: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 }, blocked: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 } },
    exclusive: [['domains', 'blocked']],
  },
  gate: {
    label: 'Gate', kind: 'native', remote: true, endpoint: 'https://gate.example/v1',
    access: { keyless: false, apiKey: { credentialRef: 'GATE_KEY' }, account: true },
    options: { baseURL: { kind: 'url' } },
  },
  reader: {
    label: 'Reader', kind: 'adapter', remote: true, endpoint: 'https://reader.example/read',
    access: { keyless: true, apiKey: { credentialRef: 'READER_KEY' }, account: false },
    options: { depth: { kind: 'enum', values: ['basic', 'deep'], keyless: ['basic'] }, age: { kind: 'integer', min: 0, max: 9, keyless: false }, cache: { kind: 'boolean' } },
  },
} as const
type TestKey = keyof typeof TEST_CATALOG
type TestSettings = { version?: number; defaultConnection?: string; connections?: Record<string, unknown> }

const identity = <T extends string>(names: readonly T[]) => Object.fromEntries(names.map(name => [name, name])) as Record<T, T>
const SERVICE_KEYS = identity<ServicesCopyKey>(['credential.reference', 'credential.referenceHint', 'services.trust', 'services.trustUnsaved', 'options.invalid', 'options.default', 'services.title', 'options.hint', 'options.keylessMore', 'services.remoteNotice', 'services.off', 'services.configureLabel', 'services.configure', 'services.enable', 'services.access', 'services.accessKeyless', 'services.accessPersonal', 'services.accessHint.keyless', 'services.accessHint.apiKey', 'services.accountHint', 'services.getKey', 'options.title', 'services.keyless', 'services.account', 'services.personalKey', 'credential.set', 'credential.unset'])
const CREDENTIAL_KEYS = identity<CredentialCopyKey>(['credential.label', 'credential.set', 'credential.unset', 'credential.placeholder', 'saving', 'credential.save', 'credential.saved', 'credential.failed', 'credential.hint'])
const CUSTOM_KEYS = identity<CustomCopyKey>(['services.remoteNotice', 'custom.title', 'custom.addStructured', 'custom.empty', 'custom.kindStructured', 'credential.set', 'credential.unset', 'credential.manage', 'custom.edit', 'custom.remove', 'services.enable', 'custom.removeConfirm', 'confirm.cancel', 'editor.titleNew', 'editor.titleEdit', 'editor.id', 'editor.idHint', 'editor.idPlaceholder', 'editor.label', 'editor.adapter', 'editor.endpoint', 'editor.endpointHint', 'editor.credentialRef', 'editor.credentialRefHint', 'editor.trust', 'editor.trustUnnamed', 'editor.save', 'editor.cancel', 'editor.stale', 'editor.optionsHint', 'editor.apiKey', 'editor.apiKeyHint', 'editor.keyFailed', 'draft.id', 'draft.duplicate', 'draft.label', 'draft.trust', 'draft.credentialRef', 'draft.endpoint', 'draft.options', 'options.title', 'credential.placeholder', 'saving'])
const optionsEditor = createOptionsEditor<string>({ classes: {}, parts, keys: { 'options.default': 'options.default', 'options.invalid': 'options.invalid', 'options.invalidLine': 'options.invalidLine', 'options.invalidItem': 'options.invalidItem', 'options.exclusive': 'options.exclusive', 'options.tooMany': 'options.tooMany', 'options.on': 'options.on', 'options.off': 'options.off' }, valueLabel: value => value })
const CredentialEditor = createCredentialEditor<string>({ classes: {}, keys: CREDENTIAL_KEYS })
const optionCopy = (key: string) => ({ options: {
  agent: { label: key + '.agent' }, limit: { label: key + '.limit', hint: key + '.limit.hint' }, baseURL: { label: key + '.baseURL' },
  maxTokens: { label: key + '.maxTokens' }, domains: { label: key + '.domains' }, blocked: { label: key + '.blocked' },
}, fallback: 'option' })

function AgentEditor({ disabled }: ExtraEditorProps<TestSettings, string>) {
  return <p>agent editor{disabled ? ' (locked)' : ''}</p>
}
const Services = createServicesSection<TestSettings, TestKey, string>({
  classes: {}, keys: SERVICE_KEYS, parts, CredentialEditor, optionsEditor, sparse, catalog: TEST_CATALOG, optionCopy,
  notes: { reader: 'note.reader', session: 'note.session' },
  summaries: { box: 'summary.box', session: 'summary.session' },
  optionGroups: { session: [{ title: 'A / B', options: ['maxTokens'] }, { title: 'B', options: ['domains'] }] },
  extras: { box: { options: ['agent', 'hosts'], Editor: AgentEditor } },
})

const resolveTest = (document: unknown) => resolveDocument({ catalog: TEST_CATALOG, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:box' }, capabilityLabel: 'test' })

function mountServices(user: TestSettings = { version: 2 }, base: TestSettings = {}) {
  const writes: SettingsPathOpView[][] = []
  const write = async (ops: readonly SettingsPathOpView[]) => { writes.push([...ops]); return true }
  const layers = { base, user }
  render(<Services doc={{ config: effectiveDocument(layers), layers, revision: 3, editable: true }} write={write} credentials={{}} saveCredential={async () => {}} t={t} />)
  const configure = (name: string) => { fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: ' + name })) }
  /** The effective document after the writes so far, checked by the shared grammar. */
  const result = () => resolveTest(effectiveDocument({ base, user: writes.reduce<unknown>((layer, ops) => applyOps(layer, ops), user) }))
  return { writes, configure, result }
}

describe('catalog-driven services section', () => {
  it('lets a registered editor take over its options, lists included, and leaves the rest to the shared form', () => {
    const h = mountServices()
    h.configure('Box')
    expect(screen.getByText('agent editor')).toBeDefined()
    expect(screen.queryByLabelText('box.agent')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(screen.getByLabelText('box.limit')).toBeDefined()
  })

  it('summarizes an entry with its own copy when the plugin gives one, and a keyless entry otherwise as keyless', () => {
    mountServices()
    const meta = (name: string) => screen.getByText(name).nextElementSibling?.textContent
    expect(meta('Box')).toBe('summary.box')
    expect(meta('Reader')).toBe('services.keyless')
  })

  it('keeps the default placeholder for an option with a hint and shows the hint below the field', () => {
    const h = mountServices()
    h.configure('Box')
    const limit = screen.getByLabelText('box.limit')
    expect(limit.getAttribute('placeholder')).toBe('options.default')
    const hint = document.getElementById(limit.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('box.limit.hint')
  })

  it('edits the credential reference of any entry with API-key access, returning to the catalog name when cleared', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:gate': { credentialRef: 'OLD_KEY' } } })
    h.configure('Gate')
    const ref = screen.getByLabelText('credential.reference')
    fireEvent.change(ref, { target: { value: '1BAD' } })
    fireEvent.blur(ref)
    expect(screen.getByText('options.invalid')).toBeDefined()
    fireEvent.change(ref, { target: { value: 'NEW_KEY' } })
    fireEvent.blur(ref)
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:gate', 'credentialRef'], value: 'NEW_KEY' }]]) })
    fireEvent.change(ref, { target: { value: '' } })
    fireEvent.blur(ref)
    await waitFor(() => { expect(h.writes[1]).toEqual([{ op: 'unset', path: ['connections'] }]) })
  })

  it('offers no credential reference on the keyless route', () => {
    const h = mountServices()
    h.configure('Reader')
    expect(screen.queryByLabelText('credential.reference')).toBeNull()
    expect(screen.getByText('note.reader')).toBeDefined()
  })

  it('writes a non-official URL option only with trust, in one write, and revokes trust on the official value', async () => {
    const h = mountServices()
    h.configure('Gate')
    const url = screen.getByLabelText('gate.baseURL')
    fireEvent.change(url, { target: { value: 'https://proxy.example/v1' } })
    fireEvent.blur(url)
    expect(h.writes).toEqual([])
    fireEvent.click(screen.getByRole('switch', { name: 'services.trust' }))
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'set', path: ['connections', 'builtin:gate', 'options', 'baseURL'], value: 'https://proxy.example/v1' },
      { op: 'set', path: ['connections', 'builtin:gate', 'trustedEndpoint'], value: true },
    ]]) })
  })

  it('revokes trust when a trusted URL returns to the official endpoint', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:gate': { trustedEndpoint: true, options: { baseURL: 'https://proxy.example/v1' } } } })
    h.configure('Gate')
    const url = screen.getByLabelText('gate.baseURL')
    expect(screen.getByRole('switch', { name: 'services.trust' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.change(url, { target: { value: 'https://gate.example/v1' } })
    expect(screen.queryByRole('switch', { name: 'services.trust' })).toBeNull()
    fireEvent.blur(url)
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'unset', path: ['connections', 'builtin:gate', 'options'] },
      { op: 'unset', path: ['connections', 'builtin:gate', 'trustedEndpoint'] },
    ]]) })
  })

  it('does not carry the trust confirmed for one address over to another one', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:gate': { trustedEndpoint: true, options: { baseURL: 'https://a.example/v1' } } } })
    h.configure('Gate')
    const url = screen.getByLabelText('gate.baseURL')
    expect(screen.queryByText('services.trustUnsaved')).toBeNull()
    fireEvent.change(url, { target: { value: 'https://b.example/v1' } })
    expect(screen.getByRole('switch', { name: 'services.trust' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.blur(url)
    fireEvent.keyDown(url, { key: 'Enter' })
    expect(h.writes).toEqual([])
    expect(screen.getByText('services.trustUnsaved')).toBeDefined()
    fireEvent.click(screen.getByRole('switch', { name: 'services.trust' }))
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'set', path: ['connections', 'builtin:gate', 'options', 'baseURL'], value: 'https://b.example/v1' },
    ]]) })
  })

  it('revokes an active trust together with the address it covers, back to the official endpoint', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:gate': { trustedEndpoint: true, options: { baseURL: 'https://proxy.example/v1' } } } })
    h.configure('Gate')
    fireEvent.click(screen.getByRole('switch', { name: 'services.trust' }))
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'unset', path: ['connections', 'builtin:gate', 'options'] },
      { op: 'unset', path: ['connections', 'builtin:gate', 'trustedEndpoint'] },
    ]]) })
    const gate = h.result().connections.get('builtin:gate')!
    expect(gate).toMatchObject({ trustedEndpoint: false, endpoint: 'https://gate.example/v1' })
    expect(gate.options.baseURL).toBeUndefined()
  })

  it('revokes a trust inherited from the lower layer by storing the official address and no trust', async () => {
    const h = mountServices({ version: 2 }, { connections: { 'builtin:gate': { trustedEndpoint: true, options: { baseURL: 'https://proxy.example/v1' } } } })
    h.configure('Gate')
    fireEvent.click(screen.getByRole('switch', { name: 'services.trust' }))
    await waitFor(() => { expect(h.writes).toHaveLength(1) })
    const gate = h.result().connections.get('builtin:gate')!
    expect(gate.trustedEndpoint).toBe(false)
    expect(gate.options.baseURL).toBe('https://gate.example/v1')
  })

  it('drops the options the keyless route rejects in the same write that switches to it', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:reader': { access: 'api-key', options: { depth: 'deep', age: 3, cache: true } } } })
    h.configure('Reader')
    fireEvent.click(screen.getByRole('tab', { name: 'services.accessKeyless' }))
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'unset', path: ['connections', 'builtin:reader', 'access'] },
      { op: 'set', path: ['connections', 'builtin:reader', 'options'], value: { cache: true } },
    ]]) })
    expect(h.result().connections.get('builtin:reader')).toMatchObject({ access: 'keyless', options: { cache: true } })
  })

  it('keeps every option when switching to the personal key', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:reader': { options: { depth: 'basic' } } } })
    h.configure('Reader')
    fireEvent.click(screen.getByRole('tab', { name: 'services.accessPersonal' }))
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:reader', 'access'], value: 'api-key' }]]) })
  })

  it('marks both exclusive options in place and writes neither until one is cleared, then saves the held one', async () => {
    const h = mountServices({ version: 2, connections: { 'builtin:session': { options: { domains: ['a.example'] } } } })
    h.configure('Session')
    const domains = screen.getByLabelText('session.domains')
    const blocked = screen.getByLabelText('session.blocked')
    fireEvent.change(blocked, { target: { value: 'b.example' } })
    fireEvent.blur(blocked)
    for (const [field, other] of [[domains, 'session.blocked'], [blocked, 'session.domains']] as const) {
      expect(field.getAttribute('aria-invalid')).toBe('true')
      const error = document.getElementById(field.getAttribute('aria-describedby')!.split(' ')[0]!)!
      expect(error.textContent).toBe('options.exclusive: ' + other)
    }
    expect(h.writes).toEqual([])
    fireEvent.change(domains, { target: { value: '' } })
    expect(blocked.getAttribute('aria-invalid')).toBe('false')
    fireEvent.blur(domains)
    await waitFor(() => { expect(h.writes).toEqual([[
      { op: 'unset', path: ['connections'] },
      { op: 'set', path: ['connections', 'builtin:session', 'options', 'blocked'], value: ['b.example'] },
    ]]) })
  })

  it.each([{}, { maxTokens: 7 }])('atomically saves exclusive-list recovery through validated revision-fenced settings (%j)', async otherOptions => {
    let user: Record<string, unknown> = { version: 2, connections: { 'builtin:session': { options: { ...otherOptions, domains: ['a.example'] } } } }
    let revision = 3
    const writes: { operations: SettingsPathOpView[]; revision: number }[] = []
    function Page() {
      const [snapshot, setSnapshot] = useState<SettingsDocumentSnapshot<TestSettings>>({ status: 'ready', value: user, base: {}, user, revision, writable: true })
      const mutate = async (operations: SettingsPathOpView[], expectedRevision: number) => {
        if (expectedRevision !== revision) return false
        writes.push({ operations, revision: expectedRevision })
        user = applyOps(user, operations)
        revision += 1
        setSnapshot({ status: 'ready', value: user, base: {}, user, revision, writable: true })
        return true
      }
      const { view, write } = useSettingsDocument(snapshot, resolveTest, mutate)
      if (view?.kind !== 'ready') throw new Error('test settings are invalid')
      return <Services doc={{ config: view.config, layers: view.layers, revision: snapshot.revision!, editable: true }} write={write} credentials={{}} saveCredential={async () => {}} t={t} />
    }
    render(<Page />)
    fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: Session' }))
    const domains = screen.getByLabelText('session.domains')
    const blocked = screen.getByLabelText('session.blocked')
    fireEvent.change(blocked, { target: { value: 'b.example' } })
    fireEvent.blur(blocked)
    expect(writes).toEqual([])
    expect(blocked.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(domains, { target: { value: '' } })
    fireEvent.blur(domains)
    await waitFor(() => { expect(user).toEqual({ version: 2, connections: { 'builtin:session': { options: { ...otherOptions, blocked: ['b.example'] } } } }) })
    expect(writes).toHaveLength(1)
    expect(writes[0]!.revision).toBe(3)
    expect(revision).toBe(4)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(blocked.getAttribute('aria-invalid')).toBe('false')
    expect(resolveTest(user).connections.get('builtin:session')!.options).toEqual({ ...otherOptions, blocked: ['b.example'] })
  })

  it('reports a refused write at the end of an open panel, after the fields it came from', async () => {
    const layers = { user: { version: 2 } }
    render(<Services doc={{ config: effectiveDocument(layers), layers, revision: 3, editable: true }} write={async () => false} credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'services.configureLabel: Session' }))
    const tokens = screen.getByLabelText('session.maxTokens')
    fireEvent.change(tokens, { target: { value: '7' } })
    fireEvent.blur(tokens)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('fetch.refused')
    expect(tokens.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(alert.closest('[id]')?.contains(tokens)).toBe(true)
  })

  it('quotes at most 40 characters of a refused list line', () => {
    const h = mountServices()
    h.configure('Session')
    const domains = screen.getByLabelText('session.domains')
    fireEvent.change(domains, { target: { value: 'A'.repeat(45) } })
    expect(screen.getByText('options.invalidItem: 1 ' + 'A'.repeat(40) + '…')).toBeDefined()
  })

  it('renders an entry without an access route of its own as a switch and its options, described by the plugin', () => {
    const h = mountServices()
    const row = screen.getByText('Session').closest('li')!
    // Nothing to configure here: neutral, never the green "configured" dot.
    expect(row.querySelector('[data-state]')?.getAttribute('data-state')).toBe('idle')
    expect(screen.getByText('Session').nextElementSibling?.textContent).toBe('summary.session')
    expect(screen.getByRole('switch', { name: 'services.enable: Session' })).toBeDefined()
    h.configure('Session')
    expect(screen.getByText('note.session')).toBeDefined()
    // No access route, credential, key, endpoint trust or catalog recipient: the catalog gives none.
    expect(screen.queryByText(/services\.remoteNotice: Session/u)).toBeNull()
    for (const label of ['services.access', 'credential.reference', 'credential.label', 'services.trust']) expect(screen.queryByLabelText(label)).toBeNull()
    expect(row.querySelector('input[type="password"]')).toBeNull()
    expect(screen.getByRole('group', { name: 'A / B' }).textContent).toContain('session.maxTokens')
    expect(screen.getByRole('group', { name: 'B' }).querySelector('textarea')).not.toBeNull()
  })

  it('writes the options of an entry without an access route, a list as its items', async () => {
    const h = mountServices()
    h.configure('Session')
    const tokens = screen.getByLabelText('session.maxTokens')
    fireEvent.change(tokens, { target: { value: '64' } })
    fireEvent.blur(tokens)
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'builtin:session', 'options', 'maxTokens'], value: 64 }]]) })
    const domains = screen.getByLabelText('session.domains')
    fireEvent.change(domains, { target: { value: 'a.example\n\nhttps://b.example' } })
    fireEvent.blur(domains)
    const error = screen.getByText('options.invalidItem: 3 https://b.example')
    expect(domains.getAttribute('aria-invalid')).toBe('true')
    // The error is part of the field's description, before its hint.
    expect(domains.getAttribute('aria-describedby')?.split(' ')[0]).toBe(error.id)
    expect(h.writes).toHaveLength(1)
    fireEvent.change(domains, { target: { value: 'a.example\n b.example ' } })
    fireEvent.blur(domains)
    await waitFor(() => { expect(h.writes[1]).toEqual([{ op: 'set', path: ['connections', 'builtin:session', 'options', 'domains'], value: ['a.example', 'b.example'] }]) })
    expect(h.result().connections.get('builtin:session')).toMatchObject({ kind: 'model', route: { kind: 'session' }, options: { domains: ['a.example', 'b.example'] } })
  })

  it('names who receives the query once, in the panel, and keeps the row summary short', () => {
    const h = mountServices()
    expect(screen.queryByText(/services\.remoteNotice: Reader/u)).toBeNull()
    h.configure('Reader')
    expect(screen.getAllByText(/services\.remoteNotice: Reader/u)).toHaveLength(1)
  })
})

const MODEL_KEYS = identity<ModelCopyKey>(['model.format', 'model.id', 'model.idHint', 'model.endpointHint', 'model.note', 'draft.model'])
const PROTOCOLS = {
  messages: { label: 'Messages', options: { maxUses: { kind: 'integer', min: 1, max: 5 }, domains: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 }, blocked: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 } }, exclusive: [['domains', 'blocked']] },
  chat: { label: 'Chat', options: { size: { kind: 'enum', values: ['low', 'high'] } } },
} as const
const MODELS: ModelFormats<keyof typeof PROTOCOLS, string> = {
  catalog: PROTOCOLS, keys: MODEL_KEYS, notes: { chat: 'note.chat' },
  optionCopy: protocol => ({ options: { maxUses: { label: protocol + '.maxUses' }, domains: { label: protocol + '.domains' }, blocked: { label: protocol + '.blocked' } }, fallback: 'option' }),
}

describe('catalog-driven custom connections', () => {
  const custom = (catalog: SettingsCatalog, protocols?: typeof MODELS) => createCustomConnectionsSection<TestSettings, SettingsCatalog, string, keyof typeof PROTOCOLS>({
    classes: {}, keys: CUSTOM_KEYS, parts, CredentialEditor, optionsEditor, sparse, catalog, optionCopy: () => ({ options: {}, fallback: 'option' }), protocols, defaultConnection: 'builtin:box',
  })
  const mountCustom = (catalog: SettingsCatalog, user: TestSettings, protocols?: typeof MODELS) => {
    const Section = custom(catalog, protocols)
    const writes: SettingsPathOpView[][] = []
    const keys: [string, string][] = []
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }}
      credentials={{}} saveCredential={async (ref, value) => { keys.push([ref, value]) }} t={t} />)
    return { writes, keys }
  }
  const chooseFormat = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'editor.adapter' }))
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(name), hidden: true }))
  }
  const model = { kind: 'model', protocol: 'messages', model: 'claude-x', label: 'Claude', credentialRef: 'CLAUDE_KEY', endpoint: 'https://api.anthropic.example:8443', trustedEndpoint: true }

  it('renders nothing for a catalog without adapter entries', () => {
    const { box, gate } = TEST_CATALOG
    const Section = custom({ box, gate })
    const { container } = render(<Section doc={{ config: {}, layers: {}, revision: 1, editable: true }} write={async () => true} credentials={{}} saveCredential={async () => {}} t={t} />)
    expect(container.innerHTML).toBe('')
  })

  it('leaves a built-in default alone when the last custom connection is removed', async () => {
    const Section = custom(TEST_CATALOG)
    const user = { version: 2, defaultConnection: 'builtin:reader', connections: { 'custom:mine': { kind: 'adapter', adapter: 'reader', label: 'Mine', credentialRef: 'MINE_KEY' } } }
    const writes: SettingsPathOpView[][] = []
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }} credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'custom.remove' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'custom.remove' }).at(-1)!)
    await waitFor(() => { expect(writes).toEqual([[{ op: 'unset', path: ['connections'] }]]) })
  })

  it('says which service and which address receive the queries of a custom connection', () => {
    const Section = custom(TEST_CATALOG)
    const user = { version: 2, connections: {
      'custom:mine': { kind: 'adapter', adapter: 'reader', label: 'Mine', credentialRef: 'MINE_KEY' },
      'custom:team': { kind: 'adapter', adapter: 'reader', label: 'Team', credentialRef: 'TEAM_KEY', endpoint: 'https://reader.team.internal:8443/read', trustedEndpoint: true },
    } }
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async () => true} credentials={{}} saveCredential={async () => {}} t={t} />)
    expect(screen.getByText(/services\.remoteNotice: Reader$/u)).toBeDefined()
    expect(screen.getByText(/services\.remoteNotice: Reader \(reader\.team\.internal:8443\)$/u)).toBeDefined()
  })

  it('asks for trust again when the endpoint changes after it was confirmed', async () => {
    const Section = custom(TEST_CATALOG)
    const writes: SettingsPathOpView[][] = []
    render(<Section doc={{ config: { version: 2 }, layers: { user: { version: 2 } }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }}
      credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByText('custom.addStructured'))
    fireEvent.change(screen.getByLabelText('editor.label'), { target: { value: 'Team' } })
    fireEvent.change(screen.getByLabelText('editor.id'), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://a.example/read' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://b.example/read' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    const save = screen.getByRole('button', { name: 'editor.save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.submit(save.closest('form')!)
    expect(writes).toEqual([])
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('editor.label'), { target: { value: 'Team B' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.click(save)
    await waitFor(() => { expect(writes).toEqual([[{ op: 'set', path: ['connections', 'custom:team'], value: {
      kind: 'adapter', label: 'Team B', adapter: 'reader', credentialRef: 'CUSTOM_TEAM_API_KEY', endpoint: 'https://b.example/read', trustedEndpoint: true,
    } }]]) })
  })

  it('keeps the stored trust of a connection whose endpoint the edit does not change', async () => {
    const Section = custom(TEST_CATALOG)
    const connection = { kind: 'adapter', adapter: 'reader', label: 'Team', credentialRef: 'TEAM_KEY', endpoint: 'https://a.example/read', trustedEndpoint: true }
    const user = { version: 2, connections: { 'custom:team': connection } }
    const writes: SettingsPathOpView[][] = []
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }} credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'custom.edit' }))
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.change(screen.getByLabelText('editor.label'), { target: { value: 'Team 2' } })
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    await waitFor(() => { expect(writes).toEqual([[{ op: 'set', path: ['connections', 'custom:team'], value: { ...connection, label: 'Team 2' } }]]) })
  })

  it('withdraws the stored trust once the edit points the connection elsewhere', () => {
    const Section = custom(TEST_CATALOG)
    const user = { version: 2, connections: { 'custom:team': { kind: 'adapter', adapter: 'reader', label: 'Team', credentialRef: 'TEAM_KEY', endpoint: 'https://a.example/read', trustedEndpoint: true } } }
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async () => true} credentials={{}} saveCredential={async () => {}} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: 'custom.edit' }))
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://b.example/read' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://a.example/read' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
  })

  it('restores the catalog default when the default connection is removed', async () => {
    const Section = custom(TEST_CATALOG)
    const user = { version: 2, defaultConnection: 'custom:mine', connections: { 'custom:mine': { kind: 'adapter', adapter: 'reader', label: 'Mine', credentialRef: 'MINE_KEY' } } }
    const writes: SettingsPathOpView[][] = []
    render(<Section doc={{ config: user, layers: { user }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }} credentials={{}} saveCredential={async () => {}} t={t} />)
    expect(screen.getByText('custom.addStructured')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'custom.remove' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'custom.remove' }).at(-1)!)
    await waitFor(() => { expect(writes).toEqual([[{ op: 'unset', path: ['connections'] }, { op: 'unset', path: ['defaultConnection'] }]]) })
  })

  it('offers the plugin protocols after the adapters and saves a model connection with trust and its key', async () => {
    const h = mountCustom(TEST_CATALOG, { version: 2 }, MODELS)
    fireEvent.click(screen.getByText('custom.addStructured'))
    fireEvent.click(screen.getByRole('button', { name: 'editor.adapter' }))
    expect(screen.getAllByRole('menuitem', { hidden: true }).map(item => item.textContent)).toEqual(['Reader', 'model.format: Messages', 'model.format: Chat'])
    fireEvent.click(screen.getByRole('menuitem', { name: /model\.format: Messages/u, hidden: true }))
    expect(screen.getByText('model.note')).toBeDefined()
    expect(screen.getByText('model.endpointHint')).toBeDefined()
    expect(screen.getByLabelText('messages.maxUses')).toBeDefined()
    fireEvent.change(screen.getByLabelText('editor.label'), { target: { value: 'Claude' } })
    fireEvent.change(screen.getByLabelText('editor.id'), { target: { value: 'claude' } })
    const save = screen.getByRole('button', { name: 'editor.save' }) as HTMLButtonElement
    // Trust is always asked for: there is no catalog endpoint to compare with.
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.submit(save.closest('form')!)
    expect(screen.getByText('draft.model')).toBeDefined()
    fireEvent.change(screen.getByLabelText('model.id'), { target: { value: 'claude-x' } })
    fireEvent.submit(save.closest('form')!)
    expect(screen.getByText('draft.endpoint')).toBeDefined()
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://api.anthropic.example' } })
    // The consent given before the endpoint was named does not cover it.
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByLabelText('messages.domains'), { target: { value: 'a.example\nb.example' } })
    fireEvent.change(screen.getByLabelText('editor.apiKey'), { target: { value: 'secret' } })
    fireEvent.click(save)
    await waitFor(() => { expect(h.keys).toEqual([['CUSTOM_CLAUDE_API_KEY', 'secret']]) })
    expect(h.writes).toEqual([[{ op: 'set', path: ['connections', 'custom:claude'], value: {
      kind: 'model', protocol: 'messages', model: 'claude-x', label: 'Claude', credentialRef: 'CUSTOM_CLAUDE_API_KEY',
      endpoint: 'https://api.anthropic.example', trustedEndpoint: true, options: { domains: ['a.example', 'b.example'] },
    } }]])
  })

  it('asks for endpoint trust right after the key, and says why Save is unavailable until it is given', () => {
    mountCustom(TEST_CATALOG, { version: 2 }, MODELS)
    fireEvent.click(screen.getByText('custom.addStructured'))
    chooseFormat('model.format: Messages')
    const trust = screen.getByRole('checkbox', { name: 'editor.trustUnnamed' })
    const key = screen.getByLabelText('editor.apiKey')
    const option = screen.getByLabelText('messages.maxUses')
    expect(key.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(trust.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const save = screen.getByRole('button', { name: 'editor.save' })
    const reason = screen.getByText('draft.trust')
    expect(save.getAttribute('aria-describedby')).toBe(reason.id)
    fireEvent.click(trust)
    expect(screen.queryByText('draft.trust')).toBeNull()
    expect(save.hasAttribute('aria-describedby')).toBe(false)
  })

  it("refuses to save a model connection with both of its protocol's exclusive options, marking both", () => {
    const h = mountCustom(TEST_CATALOG, { version: 2, connections: { 'custom:claude': model } }, MODELS)
    fireEvent.click(screen.getByRole('button', { name: 'custom.edit' }))
    fireEvent.change(screen.getByLabelText('messages.domains'), { target: { value: 'a.example' } })
    fireEvent.change(screen.getByLabelText('messages.blocked'), { target: { value: 'b.example' } })
    expect(screen.getByText('options.exclusive: messages.domains')).toBeDefined()
    expect(screen.getByText('options.exclusive: messages.blocked')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    expect(screen.getByText('draft.options')).toBeDefined()
    expect(h.writes).toEqual([])
  })

  it('binds a stored model trust to its protocol and endpoint and shows the chosen protocol only', () => {
    mountCustom(TEST_CATALOG, { version: 2, connections: { 'custom:claude': model } }, MODELS)
    fireEvent.click(screen.getByRole('button', { name: 'custom.edit' }))
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    expect(screen.getByLabelText('model.id')).toHaveProperty('value', 'claude-x')
    expect(screen.queryByLabelText('chat.size')).toBeNull()
    fireEvent.change(screen.getByLabelText('model.id'), { target: { value: 'claude-y' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    chooseFormat('model.format: Chat')
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
    expect(screen.getByText('note.chat')).toBeDefined()
    expect(screen.getByLabelText('model.id')).toHaveProperty('value', 'claude-y')
    expect(screen.queryByLabelText('messages.maxUses')).toBeNull()
    chooseFormat('model.format: Messages')
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', true)
    fireEvent.change(screen.getByLabelText('editor.endpoint'), { target: { value: 'https://elsewhere.example' } })
    expect(screen.getByRole('checkbox')).toHaveProperty('checked', false)
  })

  it('says which host receives the queries of a model connection, and restores the default when it is removed', async () => {
    const h = mountCustom(TEST_CATALOG, { version: 2, defaultConnection: 'custom:claude', connections: { 'custom:claude': model } }, MODELS)
    expect(screen.getByText('model.format: Messages')).toBeDefined()
    expect(screen.getByText(/services\.remoteNotice: api\.anthropic\.example:8443$/u)).toBeDefined()
    expect(screen.getByText('claude-x')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'custom.remove' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'custom.remove' }).at(-1)!)
    await waitFor(() => { expect(h.writes).toEqual([[{ op: 'unset', path: ['connections'] }, { op: 'unset', path: ['defaultConnection'] }]]) })
  })

  it('offers only the protocols when the catalog has no adapter entries', () => {
    const { box, gate } = TEST_CATALOG
    mountCustom({ box, gate }, { version: 2 }, MODELS)
    fireEvent.click(screen.getByText('custom.addStructured'))
    expect(screen.getByRole('button', { name: 'editor.adapter' }).textContent).toContain('model.format: Messages')
    expect(screen.getByLabelText('model.id')).toBeDefined()
  })

  it('offers the catalog adapter entries as formats and saves a new connection with its key afterwards', async () => {
    const Section = custom(TEST_CATALOG)
    const writes: SettingsPathOpView[][] = []
    const keys: [string, string][] = []
    render(<Section doc={{ config: { version: 2 }, layers: { user: { version: 2 } }, revision: 4, editable: true }} write={async ops => { writes.push([...ops]); return true }}
      credentials={{}} saveCredential={async (ref, value) => { keys.push([ref, value]) }} t={t} />)
    fireEvent.click(screen.getByText('custom.addStructured'))
    expect(screen.getByRole('button', { name: 'editor.adapter' }).textContent).toContain('Reader')
    fireEvent.change(screen.getByLabelText('editor.label'), { target: { value: 'Team' } })
    fireEvent.change(screen.getByLabelText('editor.id'), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText('editor.apiKey'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }))
    await waitFor(() => { expect(keys).toEqual([['CUSTOM_TEAM_API_KEY', 'secret']]) })
    expect(writes).toEqual([[{ op: 'set', path: ['connections', 'custom:team'], value: { kind: 'adapter', label: 'Team', adapter: 'reader', credentialRef: 'CUSTOM_TEAM_API_KEY' } }]])
  })
})
