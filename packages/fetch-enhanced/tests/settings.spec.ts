import { readFileSync } from 'node:fs'
import { CURRENT_SETTINGS_VERSION, SETTINGS_RESET_HINT } from 'dsh-tool-web-enhanced-core/shared'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { CATALOG, DEFAULT_CONNECTION, DEFAULT_LOCAL_SETTINGS } from '../src/catalog.ts'
import { resolveSettings } from '../src/settings/resolve.ts'

const local = (options: Record<string, unknown>) => ({ version: 2, connections: { 'builtin:local': { options } } })
const native = (options: Record<string, unknown>, trustedEndpoint?: boolean) => ({ version: 2, connections: { 'builtin:deepseek-fetch-api': { options, trustedEndpoint } } })

function expectReset(config: unknown, field: string): void {
  expect(() => resolveSettings(config)).toThrow(field)
  expect(() => resolveSettings(config)).toThrow(SETTINGS_RESET_HINT)
}

describe('fetch unified settings resolution', () => {
  it('resolves common defaults with remote services off without mutating input', () => {
    const document = Object.freeze({})
    const settings = resolveSettings(document)
    expect(document).toEqual({})
    expect(settings).toMatchObject({ version: CURRENT_SETTINGS_VERSION, defaultConnection: DEFAULT_CONNECTION, defaults: {}, showSelector: true })
    expect([...settings.connections.keys()]).toEqual(Object.keys(CATALOG).map(key => 'builtin:' + key))
    expect(settings.connections.get('builtin:local')).toEqual({ id: 'builtin:local', label: 'Local HTTP', kind: 'local', disabled: false, remote: false, access: 'keyless', trustedEndpoint: false, options: DEFAULT_LOCAL_SETTINGS })
    expect(settings.connections.get('builtin:deepseek-fetch-api')).toEqual({ id: 'builtin:deepseek-fetch-api', label: 'DeepSeek Fetch API', kind: 'native', native: 'deepseek-fetch-api', disabled: true, remote: true, access: 'api-key', trustedEndpoint: false, credentialRef: 'DEEPSEEK_API_KEY', endpoint: CATALOG['deepseek-fetch-api'].endpoint, options: {} })
  })

  it.each([true, false])('preserves showSelector %s with empty capability defaults', showSelector => {
    expect(resolveSettings({ showSelector, defaults: {} })).toMatchObject({ showSelector, defaults: {} })
  })

  it('applies sparse overrides and permits an existing disabled default without fallback', () => {
    const document = {
      version: 2, defaultConnection: 'builtin:local', showSelector: false, defaults: {},
      connections: { 'builtin:local': { label: ' LAN ', disabled: true }, 'builtin:deepseek-fetch-api': { credentialRef: 'MY_KEY' } },
    }
    const original = structuredClone(document)
    const settings = resolveSettings(document)
    expect(document).toEqual(original)
    expect(settings).toMatchObject({ defaultConnection: 'builtin:local', showSelector: false, defaults: {} })
    expect(settings.connections.get('builtin:local')).toMatchObject({ label: 'LAN', disabled: true })
    expect(settings.connections.get('builtin:deepseek-fetch-api')).toMatchObject({ credentialRef: 'MY_KEY' })
  })

  it('does not share default list instances between resolutions', () => {
    const first = resolveSettings().connections.get('builtin:local')!
    const second = resolveSettings().connections.get('builtin:local')!
    if (first.kind !== 'local' || second.kind !== 'local') throw new Error('expected local connections')
    expect(first.options.allowCidrs).not.toBe(second.options.allowCidrs)
    expect(first.options.allowHostnames).not.toBe(second.options.allowHostnames)
  })

  it('keeps explicit empty lists, empty headers and zero redirects', () => {
    expect(resolveSettings(local({ allowCidrs: [], allowHostnames: [], userAgent: '', maxRedirects: 0 })).connections.get('builtin:local')).toMatchObject({ options: { allowCidrs: [], allowHostnames: [], userAgent: '', maxRedirects: 0 } })
  })

  it('identifies the failing allowlist entry and its semantic reason', () => {
    expect(() => resolveSettings(local({ allowCidrs: ['10.0.0.0/8', '198.18.1.1/15'] }))).toThrow(/allowCidrs.*2.*198\.18\.0\.0\/15/u)
    expect(() => resolveSettings(local({ allowHostnames: ['example.com', 'https://example.com'] }))).toThrow(/allowHostnames.*2/u)
  })

  it.each([
    { allowCidrs: [1] }, { allowCidrs: '10.0.0.0/8' }, { allowHostnames: [null] },
    { allowCidrs: Array.from({ length: 201 }, () => '10.0.0.0/8') }, { allowHostnames: Array.from({ length: 201 }, () => 'example.com') }, { allowHostnames: ['x'.repeat(2001)] },
    { userAgent: 'bad\r\nX-Injected: 1' }, { userAgent: 'x'.repeat(2001) }, { userAgent: '你好' },
    { timeoutMs: 0 }, { timeoutMs: 2_147_483_648 }, { maxRedirects: 1.5 }, { maxRedirects: -1 }, { maxBodyChars: Number.NaN }, { maxResponseBytes: 0 }, { maxResponseBytes: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects invalid local options: %j', options => {
    expect(() => resolveSettings(local(options))).toThrow('options')
  })

  it('accepts bounded local options at their limits', () => {
    const options = { allowCidrs: Array.from({ length: 200 }, () => '10.0.0.0/8'), allowHostnames: Array.from({ length: 200 }, () => 'example.com'), userAgent: 'x'.repeat(2000), timeoutMs: 2_147_483_647, maxResponseBytes: Number.MAX_SAFE_INTEGER, maxBodyChars: 1, maxRedirects: 0 }
    expect(resolveSettings(local(options)).connections.get('builtin:local')).toMatchObject({ options })
  })

  it('requires trust for non-official native base URLs, including http', () => {
    const official = CATALOG['deepseek-fetch-api'].endpoint
    expect(resolveSettings(native({ baseURL: official })).connections.get('builtin:deepseek-fetch-api')).toMatchObject({ trustedEndpoint: false, options: { baseURL: official } })
    for (const baseURL of ['https://proxy.example/v1/tools', 'http://localhost:8000/v1/tools']) {
      for (const trust of [undefined, false]) expect(() => resolveSettings(native({ baseURL }, trust))).toThrow('trustedEndpoint')
      expect(resolveSettings(native({ baseURL }, true)).connections.get('builtin:deepseek-fetch-api')).toMatchObject({ trustedEndpoint: true, options: { baseURL } })
    }
    for (const baseURL of ['https://user:secret@example.com', 'ftp://example.com', 'https://example.com?token=secret', 'https://example.com#fragment', 'relative']) expect(() => resolveSettings(native({ baseURL }, true))).toThrow('baseURL')
  })

  it('derives adapters from catalog kind and applies access, credential and options overrides', () => {
    for (const adapter of ['exa', 'firecrawl', 'tavily', 'tinyfish']) {
      const id = 'builtin:' + adapter
      expect(resolveSettings().connections.get(id)).toMatchObject({ kind: 'adapter', adapter, remote: true })
    }
    expect(resolveSettings({ connections: { 'builtin:exa': { access: 'api-key', credentialRef: 'MY_EXA', options: { maxAgeHours: 0, livecrawlTimeout: 90_000 } } } }).connections.get('builtin:exa')).toMatchObject({ kind: 'adapter', adapter: 'exa', access: 'api-key', credentialRef: 'MY_EXA', options: { maxAgeHours: 0, livecrawlTimeout: 90_000 } })
    for (const options of [{ maxAgeHours: 0 }, { livecrawlTimeout: 1000 }]) {
      expect(() => resolveSettings({ connections: { 'builtin:exa': { access: 'keyless', options } } })).toThrow('options')
    }
    expect(() => resolveSettings({ connections: { 'builtin:tinyfish': { access: 'keyless' } } })).toThrow('access')
  })

  it('accepts custom adapter connections as defaults, always using API-key access', () => {
    const custom = { kind: 'adapter', adapter: 'firecrawl', label: ' Private scrape ', credentialRef: 'PRIVATE_KEY', options: { storeInCache: false } }
    const document = { defaultConnection: 'custom:private', connections: { 'custom:private': custom } }
    const before = structuredClone(document)
    expect(resolveSettings(document).connections.get('custom:private')).toMatchObject({ kind: 'adapter', adapter: 'firecrawl', access: 'api-key', label: 'Private scrape', credentialRef: 'PRIVATE_KEY', endpoint: CATALOG.firecrawl.endpoint, options: { storeInCache: false } })
    expect(resolveSettings(document).defaultConnection).toBe('custom:private')
    expect(document).toEqual(before)
    for (const endpoint of ['http://localhost:8000/scrape', 'https://private.example/scrape']) {
      expect(() => resolveSettings({ connections: { 'custom:private': { ...custom, endpoint } } })).toThrow('trustedEndpoint')
      expect(resolveSettings({ connections: { 'custom:private': { ...custom, endpoint, trustedEndpoint: true } } }).connections.get('custom:private')).toMatchObject({ endpoint, access: 'api-key', trustedEndpoint: true })
    }
    for (const adapter of ['local', 'deepseek-fetch-api', 'missing']) {
      expect(() => resolveSettings({ connections: { 'custom:private': { ...custom, adapter } } })).toThrow('adapter')
    }
    expect(() => resolveSettings({ connections: { 'custom:private': { ...custom, access: 'keyless' } } })).toThrow('access')
    expect(() => resolveSettings({ defaultConnection: 'custom:gone' })).toThrow('custom:gone')
    expect(() => resolveSettings({ connections: { 'custom:!': custom } })).toThrow('custom:!')
  })

  it('rejects custom model connections because fetch declares no model protocols', () => {
    const resolve = () => resolveSettings({ connections: { 'custom:model': { kind: 'model', protocol: 'anthropic-messages', model: 'search-model', label: 'Model', endpoint: 'https://model.example/v1', trustedEndpoint: true, credentialRef: 'MODEL_KEY' } } })
    expect(resolve).not.toThrow('expected one of ')
    expect(resolve).toThrow('connections.custom:model.kind')
  })

  it.each(['builtin:missing', 'builtin:session-model', 'other:x'])('rejects unknown connection/default id %s with reset guidance', id => {
    expectReset({ connections: { [id]: {} } }, id)
    expectReset({ defaultConnection: id }, id)
  })

  it.each([
    ['builtin:local', { access: 'api-key' }],
    ['builtin:local', { credentialRef: 'MY_KEY' }],
    ['builtin:deepseek-fetch-api', { access: 'keyless' }],
    ['builtin:deepseek-fetch-api', { credentialRef: 'bad ref' }],
    ['builtin:local', { label: 'x'.repeat(201) }],
    ['builtin:deepseek-fetch-api', { credentialRef: 'x'.repeat(2001) }],
  ] as const)('validates %s sparse override %j', (id, override) => {
    expect(() => resolveSettings({ connections: { [id]: override } })).toThrow('connections.' + id)
  })

  it('bounds connection count and default id text', () => {
    expect(() => resolveSettings({ connections: Object.fromEntries(Array.from({ length: 201 }, (_, i) => ['custom:' + i, {}])) })).toThrow('200')
    expect(() => resolveSettings({ defaultConnection: 'x'.repeat(201) })).toThrow('defaultConnection')
  })

  it.each([
    ['typo', { typo: true }],
    ['freshness', { defaults: { freshness: 'auto' } }],
    ['typo', { defaults: { typo: true } }],
    ['apiKey', { connections: { 'builtin:deepseek-fetch-api': { apiKey: 'fixture-not-real' } } }],
    ['endpoint', { connections: { 'builtin:deepseek-fetch-api': { endpoint: 'https://proxy.test' } } }],
    ['unknown', local({ unknown: true })],
    ['unknown', native({ unknown: true })],
  ])('rejects unknown field %s with reset guidance', (field, document) => {
    expectReset(document, field)
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous keys at every depth: %s', key => {
    const unsafe = Object.fromEntries([[key, {}]])
    for (const document of [unsafe, { defaults: unsafe }, { connections: unsafe }, { connections: { 'builtin:local': unsafe } }, local(unsafe), native(unsafe)]) {
      expectReset(document, key)
      expect(() => resolveSettings(document)).toThrow('unsafe key')
    }
  })

  it.each([null, [], 'settings', 1, { showSelector: 'no' }, { defaults: [] }])('rejects invalid document shapes: %j', document => {
    expect(() => resolveSettings(document)).toThrow('settings')
  })
})

describe('fetch settings version policy', () => {
  it('treats omitted version as version 2 of the unified grammar', () => {
    expect(resolveSettings({ version: 2, defaults: {} })).toEqual(resolveSettings())
  })

  it.each([0, -1, 1.5, '2', null, 3])('rejects invalid or future version %j', version => {
    expect(() => resolveSettings({ version })).toThrow('version')
  })

  it('rejects explicit version 1 with reset guidance', () => {
    expectReset({ version: 1 }, 'version')
  })

  it.each(['providerId', 'schemaVersion', 'allowCidrs', 'allowHostnames', 'userAgent', 'maxResponseBytes', 'maxBodyChars', 'timeoutMs', 'maxRedirects'])('rejects predecessor field %s even alongside valid current fields', field => {
    for (const version of [undefined, CURRENT_SETTINGS_VERSION]) expectReset({ version, defaults: {}, connections: {}, [field]: undefined }, field)
  })
})

describe('fetch unified settings fixtures', () => {
  it('resolves all unified YAML examples without migration, mutation or caller-array aliasing', () => {
    const documents = parseAllDocuments(readFileSync(new URL('./fixtures/unified-settings.yml', import.meta.url), 'utf8'))
    expect(documents).toHaveLength(3)
    for (const document of documents) {
      expect(document.errors).toEqual([])
      const config = document.toJS() as { connections: Record<string, { options: { allowCidrs: string[]; allowHostnames: string[] } }> }
      const original = structuredClone(config)
      const resolved = resolveSettings(config)
      expect(config).toEqual(original)
      expect(resolved).toMatchObject({ version: CURRENT_SETTINGS_VERSION, defaults: {} })
      expect(resolved.connections.has(resolved.defaultConnection)).toBe(true)
      const connection = resolved.connections.get('builtin:local')!
      if (connection.kind !== 'local') throw new Error('expected local connection')
      expect(connection.options.allowCidrs).not.toBe(config.connections['builtin:local']!.options.allowCidrs)
      expect(connection.options.allowHostnames).not.toBe(config.connections['builtin:local']!.options.allowHostnames)
    }
  })
})
