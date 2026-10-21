import { describe, expect, it } from 'vitest'
import { createConnectionForm, emptyForm, formOf, suggestCredentialRef, withFormat, type ConnectionForm } from '../src/client/settings/connection-form.ts'
import { adapterKeys, builtinAccess, catalogFields, connectionChoices, connectionName, credentialRefs, keylessRejected, protocolGroups, type OptionCopyTable } from '../src/client/settings/model.ts'

const CATALOG = {
  local: {
    label: 'Local', kind: 'local', remote: false, access: { keyless: true, apiKey: false, account: false },
    options: { allow: { kind: 'list', pattern: /^.*$/u, max: 10 }, limit: { kind: 'integer', min: 0, max: 10 } },
  },
  native: {
    label: 'Native', kind: 'native', remote: true, endpoint: 'https://api.example/v1',
    access: { keyless: false, apiKey: { credentialRef: 'NATIVE_KEY' }, account: true },
    options: { baseURL: { kind: 'url' } },
  },
  reader: {
    label: 'Reader', kind: 'adapter', remote: true, endpoint: 'https://reader.example/read',
    access: { keyless: true, apiKey: { credentialRef: 'READER_KEY' }, account: false },
    options: {
      depth: { kind: 'enum', values: ['basic', 'deep', 'max'], keyless: ['basic'] },
      age: { kind: 'integer', min: -1, max: 100, keyless: false },
      mirror: { kind: 'url' },
    },
  },
} as const

const PROTOCOLS = {
  messages: { label: 'Messages', options: { maxTokens: { kind: 'integer', min: 1, max: 100 }, maxUses: { kind: 'integer', min: 1, max: 5 }, domains: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 } } },
  responses: { label: 'Responses', options: { maxTokens: { kind: 'integer', min: 1, max: 100 }, size: { kind: 'enum', values: ['low', 'high'] }, domains: { kind: 'list', pattern: /^[a-z.]+$/u, max: 2 } } },
  chat: { label: 'Chat', options: { maxTokens: { kind: 'integer', min: 1, max: 100 }, size: { kind: 'enum', values: ['low', 'high'] } } },
} as const

const copy: OptionCopyTable<string> = { options: { depth: { label: 'depth.label', placeholder: 'depth.placeholder' }, age: { label: 'age.label', hint: 'age.hint' } }, fallback: 'generic' }
const t = (key: string) => 'T:' + key

describe('catalog-driven settings facts', () => {
  it('derives fields from option rules, narrowing the keyless route and skipping lists', () => {
    const keyless = catalogFields(CATALOG.reader.options, 'keyless', copy)
    expect(keyless.restricted).toBe(true)
    expect(keyless.fields.map(field => [field.name, field.kind, field.values])).toEqual([['depth', 'enum', ['basic']], ['mirror', 'url', []]])
    const keyed = catalogFields(CATALOG.reader.options, 'api-key', copy)
    expect(keyed.restricted).toBe(false)
    expect(keyed.fields.map(field => field.name)).toEqual(['depth', 'age', 'mirror'])
    expect(keyed.fields[0]!.label).toBe('depth.label')
    expect(keyed.fields[0]!.placeholder(t)).toBe('T:depth.placeholder')
    expect(keyed.fields[0]!.hint).toBeUndefined()
    expect(keyed.fields[1]).toMatchObject({ label: 'age.label', hint: 'age.hint', min: -1, max: 100 })
    expect(keyed.fields[1]!.placeholder(t)).toBeUndefined()
    expect(keyed.fields[2]).toMatchObject({ label: 'generic' })
    // A list option is a field too, edited one item per line and bounded by its rule.
    expect(catalogFields(CATALOG.local.options, 'keyless', copy).fields.map(field => [field.name, field.kind])).toEqual([['allow', 'list'], ['limit', 'integer']])
    expect(catalogFields(CATALOG.local.options, 'keyless', copy).fields[0]).toMatchObject({ maxItems: 10, pattern: CATALOG.local.options.allow.pattern })
  })

  it('reports every API-key entry and every custom connection credential once', () => {
    const config = { connections: {
      'builtin:native': { credentialRef: 'MY_NATIVE' },
      'custom:a': { kind: 'adapter', adapter: 'reader', label: 'A', credentialRef: 'READER_KEY' },
      'custom:b': { kind: 'adapter', adapter: 'reader', label: 'B', credentialRef: 'B_KEY' },
    } }
    expect(credentialRefs(CATALOG, config)).toEqual(['MY_NATIVE', 'READER_KEY', 'B_KEY'])
  })

  it('names connections in catalog order with overrides and custom labels', () => {
    const config = { connections: { 'builtin:local': { label: 'Mine' }, 'custom:a': { kind: 'adapter', adapter: 'reader', label: 'Team', credentialRef: 'K' } } }
    const label = (key: keyof typeof CATALOG) => 'catalog ' + key
    expect(connectionChoices(CATALOG, config, label)).toEqual([
      { id: 'builtin:local', label: 'Mine' }, { id: 'builtin:native', label: 'catalog native' },
      { id: 'builtin:reader', label: 'catalog reader' }, { id: 'custom:a', label: 'Team' },
    ])
    expect(connectionName(CATALOG, config, 'custom:a', label)).toBe('Team')
    expect(connectionName(CATALOG, config, 'builtin:native', label)).toBe('catalog native')
    expect(connectionName(CATALOG, config, 'custom:gone', label)).toBe('custom:gone')
    expect(adapterKeys(CATALOG)).toEqual(['reader'])
  })

  it('asks for trust when a custom connection sends its key off the catalog endpoint, also through a URL option', () => {
    const { formats, needsTrust, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = { ...emptyForm(formats[0]!), id: 'custom:team', label: 'Team', credentialRef: 'TEAM_KEY' }
    expect(needsTrust(form)).toBe(false)
    expect(needsTrust({ ...form, endpoint: 'https://reader.example/read' })).toBe(false)
    const mirrored = { ...form, options: { mirror: 'https://mirror.example/read' } }
    expect(needsTrust(mirrored)).toBe(true)
    expect(buildConnection(mirrored, false, [])).toEqual({ ok: false, error: 'trust' })
    expect(buildConnection(mirrored, true, [])).toEqual({ ok: true, id: 'custom:team', connection: {
      kind: 'adapter', adapter: 'reader', label: 'Team', credentialRef: 'TEAM_KEY', trustedEndpoint: true, options: { mirror: 'https://mirror.example/read' },
    } })
    expect(buildConnection({ ...form, options: { age: '-1' } }, false, [])).toMatchObject({ ok: true, connection: { options: { age: -1 } } })
  })

  it('suggests a credential name from the id and reports the first invalid field by code', () => {
    expect(suggestCredentialRef('custom:work-search.v2')).toBe('CUSTOM_WORK_SEARCH_V2_API_KEY')
    expect(suggestCredentialRef('custom:')).toBe('')
    const { formats, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = (patch: Partial<ConnectionForm<'reader', never>> = {}): ConnectionForm<'reader', never> => ({ ...emptyForm(formats[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', ...patch }) as ConnectionForm<'reader', never>
    expect(buildConnection(form({ label: '  Work  ' }), false, [])).toEqual({ ok: true, id: 'custom:work', connection: { kind: 'adapter', label: 'Work', adapter: 'reader', credentialRef: 'WORK_KEY' } })
    expect(buildConnection(form({ id: 'builtin:reader' }), true, [])).toEqual({ ok: false, error: 'id' })
    expect(buildConnection(form(), true, ['custom:work'])).toEqual({ ok: false, error: 'duplicate' })
    expect(buildConnection(form({ label: ' ' }), true, [])).toEqual({ ok: false, error: 'label' })
    expect(buildConnection(form({ credentialRef: '' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(form({ credentialRef: '1KEY' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(buildConnection(form({ endpoint: 'ftp://x' }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    for (const suffix of ['?token=secret', '#fragment']) expect(buildConnection(form({ endpoint: 'https://api.example/read' + suffix }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    expect(buildConnection(form({ options: { depth: 'invalid' } }), true, [])).toEqual({ ok: false, error: 'options' })
  })

  it('round-trips a saved connection through its form', () => {
    const { formats, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const original = { ...emptyForm(formats[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', endpoint: 'https://proxy.example/read', options: { depth: 'deep' } }
    const result = buildConnection(original, true, [])
    if (!result.ok) throw new Error('expected a valid form')
    expect(result.connection).toMatchObject({ endpoint: 'https://proxy.example/read', trustedEndpoint: true })
    expect(formOf('custom:work', result.connection)).toEqual(original)
  })

  it('names the destination of a form by format, endpoint and URL options only', () => {
    const { formats, destination } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = { ...emptyForm(formats[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', endpoint: 'https://a.example/read' }
    expect(destination({ ...form, label: 'Other', credentialRef: 'OTHER', options: { depth: 'deep' } })).toBe(destination(form))
    expect(destination({ ...form, endpoint: ' https://a.example/read ' })).toBe(destination(form))
    expect(destination({ ...form, endpoint: 'https://b.example/read' })).not.toBe(destination(form))
    expect(destination({ ...form, options: { mirror: 'https://m.example/read' } })).not.toBe(destination(form))
  })

  it('names the options the keyless route would reject', () => {
    expect(keylessRejected(CATALOG.reader.options, { depth: 'basic', age: 3, mirror: 'https://m.example/read' })).toEqual(['age'])
    expect(keylessRejected(CATALOG.reader.options, { depth: 'max' })).toEqual(['depth'])
    expect(keylessRejected(CATALOG.local.options, { limit: 3, allow: [] })).toEqual([])
  })

  it('has no formats without adapter entries or protocols', () => {
    const { local, native } = CATALOG
    expect(createConnectionForm({ catalog: { local, native }, optionCopy: () => copy }).formats).toEqual([])
    expect(createConnectionForm({ catalog: { local, native }, optionCopy: () => copy, protocols: { catalog: PROTOCOLS, optionCopy: () => copy } }).formats)
      .toEqual([{ kind: 'model', protocol: 'messages' }, { kind: 'model', protocol: 'responses' }, { kind: 'model', protocol: 'chat' }])
  })

  it('gives an entry without an access route of its own no access to configure', () => {
    const session = { label: 'Session', kind: 'model', remote: true, access: { keyless: false, apiKey: false, account: false }, options: {} } as const
    expect(builtinAccess(session, {})).toBe('none')
    expect(builtinAccess(CATALOG.native, {})).toBe('api-key')
    expect(builtinAccess(CATALOG.reader, {})).toBe('keyless')
    expect(credentialRefs({ session }, { connections: { 'custom:m': { kind: 'model', protocol: 'messages', model: 'm', label: 'M', credentialRef: 'M_KEY', endpoint: 'https://m.example', trustedEndpoint: true } } })).toEqual(['M_KEY'])
  })

  it('tells each field which options it may not be set with, from the catalog pairs', () => {
    const { fields } = catalogFields(PROTOCOLS.messages.options, 'api-key', copy, [['maxUses', 'domains']])
    expect(fields.map(field => [field.name, field.exclusive])).toEqual([['maxTokens', undefined], ['maxUses', ['domains']], ['domains', ['maxUses']]])
  })

  it('groups the options of several protocols by the protocols that apply them, in first-appearance order', () => {
    expect(protocolGroups(PROTOCOLS)).toEqual([
      { title: 'Messages / Responses / Chat', options: ['maxTokens'] },
      { title: 'Messages', options: ['maxUses'] },
      { title: 'Messages / Responses', options: ['domains'] },
      { title: 'Responses / Chat', options: ['size'] },
    ])
  })
})

describe('custom model connection form', () => {
  const rules = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy, protocols: { catalog: PROTOCOLS, optionCopy: protocol => ({ options: { maxTokens: { label: protocol + '.maxTokens' } }, fallback: 'generic' }) } })
  const messages = { kind: 'model', protocol: 'messages' } as const
  const form = (patch: Partial<Extract<ConnectionForm<'reader', keyof typeof PROTOCOLS>, { kind: 'model' }>> = {}): ConnectionForm<'reader', keyof typeof PROTOCOLS> =>
    ({ ...emptyForm<'reader', keyof typeof PROTOCOLS>(messages), id: 'custom:claude', label: 'Claude', credentialRef: 'CLAUDE_KEY', model: 'claude-x', endpoint: 'https://api.anthropic.example', ...patch }) as ConnectionForm<'reader', keyof typeof PROTOCOLS>

  it('lists the protocols after the adapter formats', () => {
    expect(rules.formats).toEqual([{ kind: 'adapter', adapter: 'reader' }, messages, { kind: 'model', protocol: 'responses' }, { kind: 'model', protocol: 'chat' }])
  })

  it('requires a model id, an endpoint and a credential, and always asks for trust', () => {
    expect(rules.needsTrust(form())).toBe(true)
    expect(rules.needsTrust(form({ endpoint: '' }))).toBe(true)
    expect(rules.buildConnection(form(), false, [])).toEqual({ ok: false, error: 'trust' })
    expect(rules.buildConnection(form({ model: '  ' }), true, [])).toEqual({ ok: false, error: 'model' })
    expect(rules.buildConnection(form({ model: 'a\u0007b' }), true, [])).toEqual({ ok: false, error: 'model' })
    expect(rules.buildConnection(form({ model: 'm'.repeat(201) }), true, [])).toEqual({ ok: false, error: 'model' })
    expect(rules.buildConnection(form({ endpoint: '' }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    expect(rules.buildConnection(form({ endpoint: 'https://api.example?key=1' }), true, [])).toEqual({ ok: false, error: 'endpoint' })
    expect(rules.buildConnection(form({ credentialRef: '' }), true, [])).toEqual({ ok: false, error: 'credentialRef' })
    expect(rules.buildConnection(form({ model: ' claude-x ' }), true, [])).toEqual({ ok: true, id: 'custom:claude', connection: {
      kind: 'model', protocol: 'messages', model: 'claude-x', label: 'Claude', credentialRef: 'CLAUDE_KEY', endpoint: 'https://api.anthropic.example', trustedEndpoint: true,
    } })
  })

  it('checks options by the rules of the chosen protocol, lists one item per line', () => {
    expect(rules.formFields(form()).map(field => [field.name, field.label])).toEqual([['maxTokens', 'messages.maxTokens'], ['maxUses', 'generic'], ['domains', 'generic']])
    expect(rules.formFields(form({ protocol: 'chat' })).map(field => field.name)).toEqual(['maxTokens', 'size'])
    expect(rules.buildConnection(form({ options: { maxUses: '9' } }), true, [])).toEqual({ ok: false, error: 'options' })
    expect(rules.buildConnection(form({ options: { domains: 'a.example\nb.example\nc.example' } }), true, [])).toEqual({ ok: false, error: 'options' })
    expect(rules.buildConnection(form({ options: { maxUses: '3', domains: ' a.example \n\nb.example' } }), true, [])).toMatchObject({ ok: true, connection: { options: { maxUses: 3, domains: ['a.example', 'b.example'] } } })
  })

  it('binds consent to the protocol and endpoint only', () => {
    const base = form()
    expect(rules.destination(form({ label: 'Other', model: 'other', credentialRef: 'OTHER', options: { maxUses: '2' } }))).toBe(rules.destination(base))
    expect(rules.destination(form({ protocol: 'responses' }))).not.toBe(rules.destination(base))
    expect(rules.destination(form({ endpoint: 'https://b.example' }))).not.toBe(rules.destination(base))
    expect(rules.destination(withFormat(base, { kind: 'adapter', adapter: 'reader' }))).not.toBe(rules.destination(base))
  })

  it('round-trips a saved model connection and keeps its switch through an edit', () => {
    const result = rules.buildConnection(form({ options: { domains: 'a.example' } }), true, [])
    if (!result.ok) throw new Error('expected a valid form')
    expect(formOf('custom:claude', result.connection)).toEqual(form({ options: { domains: 'a.example' } }))
    const previous = { ...result.connection, disabled: true }
    expect(rules.buildConnection(form({ label: 'Renamed' }), true, [], previous)).toMatchObject({ ok: true, connection: { label: 'Renamed', disabled: true } })
  })

  it('keeps name, id, credential and endpoint across a format change, and drops the options', () => {
    const switched = withFormat(form({ options: { maxUses: '2' } }), { kind: 'model', protocol: 'chat' })
    expect(switched).toEqual(form({ protocol: 'chat' }))
    const adapter = withFormat(switched, { kind: 'adapter', adapter: 'reader' })
    expect(adapter).toEqual({ kind: 'adapter', adapter: 'reader', id: 'custom:claude', label: 'Claude', credentialRef: 'CLAUDE_KEY', endpoint: 'https://api.anthropic.example', options: {} })
    expect(withFormat(adapter, messages)).toMatchObject({ kind: 'model', model: '' })
  })
})