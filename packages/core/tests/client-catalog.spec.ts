import { describe, expect, it } from 'vitest'
import { createConnectionForm, emptyForm, formOf, suggestCredentialRef, type ConnectionForm } from '../src/client/settings/connection-form.ts'
import { adapterKeys, catalogFields, connectionChoices, connectionName, credentialRefs, keylessRejected, type OptionCopyTable } from '../src/client/settings/model.ts'

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
    expect(catalogFields(CATALOG.local.options, 'keyless', copy).fields.map(field => field.name)).toEqual(['limit'])
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
    const { adapters, needsTrust, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = { ...emptyForm(adapters[0]!), id: 'custom:team', label: 'Team', credentialRef: 'TEAM_KEY' }
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
    const { adapters, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = (patch: Partial<ConnectionForm<'reader'>> = {}): ConnectionForm<'reader'> => ({ ...emptyForm(adapters[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', ...patch })
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
    const { adapters, buildConnection } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const original = { ...emptyForm(adapters[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', endpoint: 'https://proxy.example/read', options: { depth: 'deep' } }
    const result = buildConnection(original, true, [])
    if (!result.ok) throw new Error('expected a valid form')
    expect(result.connection).toMatchObject({ endpoint: 'https://proxy.example/read', trustedEndpoint: true })
    expect(formOf('custom:work', result.connection)).toEqual(original)
  })

  it('names the destination of a form by format, endpoint and URL options only', () => {
    const { adapters, destination } = createConnectionForm({ catalog: CATALOG, optionCopy: () => copy })
    const form = { ...emptyForm(adapters[0]!), id: 'custom:work', label: 'Work', credentialRef: 'WORK_KEY', endpoint: 'https://a.example/read' }
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

  it('has no formats without adapter entries', () => {
    const { local, native } = CATALOG
    expect(createConnectionForm({ catalog: { local, native }, optionCopy: () => copy }).adapters).toEqual([])
  })
})
