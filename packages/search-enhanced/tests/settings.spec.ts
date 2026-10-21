import { readFileSync } from 'node:fs'
import { CURRENT_SETTINGS_VERSION, SETTINGS_RESET_HINT, builtinId } from 'dsh-tool-web-enhanced-core/shared'
import { describe, expect, it } from 'vitest'
import { parseAllDocuments } from 'yaml'
import { CATALOG, DEFAULT_CONNECTION, FRESHNESS, NATIVE_KEYS } from '../src/catalog.ts'
import { resolveSettings } from '../src/settings/resolve.ts'

const custom = { kind: 'adapter', label: 'Work', adapter: 'exa', credentialRef: 'WORK_EXA' } as const
const oversizedText = 'x'.repeat(2001)

function expectReset(config: unknown, field: string): void {
  expect(() => resolveSettings(config)).toThrow(field)
  expect(() => resolveSettings(config)).toThrow(SETTINGS_RESET_HINT)
}

describe('search unified settings resolution', () => {
  it('resolves the native default without materializing sparse configuration', () => {
    const config = Object.freeze({})
    const settings = resolveSettings(config)
    expect(config).toEqual({})
    expect([...settings.connections.keys()]).toEqual(Object.keys(CATALOG).map(builtinId))
    expect(settings).toMatchObject({ version: CURRENT_SETTINGS_VERSION, defaults: { freshness: 'auto' }, defaultConnection: DEFAULT_CONNECTION, showSelector: true })
    expect(settings).not.toHaveProperty('freshness')
    expect(settings.connections.get(DEFAULT_CONNECTION)).toEqual({ id: DEFAULT_CONNECTION, kind: 'native', native: 'deepseek-messages', label: 'DeepSeek Messages', disabled: false, remote: true, access: 'api-key', trustedEndpoint: false, endpoint: CATALOG['deepseek-messages'].endpoint, credentialRef: 'DEEPSEEK_API_KEY', options: {} })
    expect(settings.connections.get('builtin:exa')).toMatchObject({ kind: 'adapter', access: 'keyless', trustedEndpoint: false, credentialRef: 'EXA_API_KEY', remote: true })
    expect(settings.connections.get('builtin:semanticscholar')).toMatchObject({ access: 'api-key' })
  })

  it('applies sparse overrides, preserves insertion order, and never mutates input', () => {
    const config = {
      version: 2, defaultConnection: 'custom:proxy', defaults: { freshness: 'realtime' }, showSelector: false,
      connections: {
        'builtin:exa': { label: 'Exa (work)', access: 'api-key', credentialRef: 'WORK_EXA', options: { type: 'fast' } },
        'builtin:deepseek-messages': { credentialRef: 'WORK_DEEPSEEK', trustedEndpoint: true, options: { baseURL: 'https://gateway.test/v1', model: 'search', apiVersion: '2023-06-01', maxTokens: 100, maxUses: 2 } },
        'custom:proxy': { ...custom, endpoint: 'https://proxy.test/search', trustedEndpoint: true },
      },
    }
    const original = structuredClone(config)
    const settings = resolveSettings(config)
    expect(config).toEqual(original)
    expect(settings).toMatchObject({ version: 2, defaultConnection: 'custom:proxy', defaults: { freshness: 'realtime' }, showSelector: false })
    expect([...settings.connections.keys()]).toEqual([...Object.keys(CATALOG).map(builtinId), 'custom:proxy'])
    expect(settings.connections.get('builtin:exa')).toMatchObject({ label: 'Exa (work)', access: 'api-key', credentialRef: 'WORK_EXA', options: { type: 'fast' } })
    expect(settings.connections.get(DEFAULT_CONNECTION)).toMatchObject({ kind: 'native', access: 'api-key', trustedEndpoint: true, credentialRef: 'WORK_DEEPSEEK', options: config.connections['builtin:deepseek-messages'].options })
    expect(settings.connections.get('custom:proxy')).toMatchObject({ kind: 'adapter', access: 'api-key', trustedEndpoint: true, endpoint: 'https://proxy.test/search' })
    expect(resolveSettings().connections.get('builtin:exa')).toHaveProperty('label', 'Exa')
  })

  it.each(FRESHNESS)('reads freshness %s only from defaults', freshness => {
    expect(resolveSettings({ defaults: { freshness } }).defaults).toEqual({ freshness })
    expectReset({ freshness }, 'freshness')
  })

  it.each([true, false])('preserves showSelector %s independently of connections', showSelector => {
    expect(resolveSettings({ showSelector }).showSelector).toBe(showSelector)
  })

  it.each(NATIVE_KEYS)('requires explicit endpoint trust for %s baseURL overrides, including http', key => {
    const id = builtinId(key)
    for (const baseURL of ['https://gateway.test/v1', 'http://localhost:8000/v1']) {
      for (const trust of [{}, { trustedEndpoint: false }]) {
        expect(() => resolveSettings({ connections: { [id]: { ...trust, options: { baseURL } } } })).toThrow('connections.' + id + '.trustedEndpoint')
      }
      expect(resolveSettings({ connections: { [id]: { trustedEndpoint: true, options: { baseURL } } } }).connections.get(id)).toMatchObject({ trustedEndpoint: true, options: { baseURL } })
    }
  })

  it.each(NATIVE_KEYS)('accepts the official %s baseURL without endpoint trust', key => {
    const id = builtinId(key)
    const baseURL = CATALOG[key].endpoint
    expect(resolveSettings({ connections: { [id]: { options: { baseURL } } } }).connections.get(id)).toMatchObject({ trustedEndpoint: false, options: { baseURL } })
  })

  it('accepts custom adapters with official endpoints but requires trust for overrides', () => {
    for (const endpoint of [undefined, CATALOG.exa.endpoint]) {
      expect(resolveSettings({ connections: { 'custom:work': { ...custom, endpoint } } }).connections.get('custom:work')).toMatchObject({ kind: 'adapter', adapter: 'exa', access: 'api-key', trustedEndpoint: false, endpoint: CATALOG.exa.endpoint })
    }
    for (const endpoint of ['https://proxy.test/search', 'http://localhost:8000/search']) {
      for (const trustedEndpoint of [undefined, false]) {
        expect(() => resolveSettings({ connections: { 'custom:work': { ...custom, endpoint, trustedEndpoint } } })).toThrow('trustedEndpoint')
      }
      expect(resolveSettings({ connections: { 'custom:work': { ...custom, endpoint, trustedEndpoint: true } } }).connections.get('custom:work')).toMatchObject({ endpoint, trustedEndpoint: true })
    }
  })

  it.each(['__proto__', 'constructor', 'prototype'])('rejects unsafe record key %s at every depth', key => {
    const unsafe = Object.fromEntries([[key, {}]])
    for (const config of [unsafe, { defaults: unsafe }, { connections: unsafe }, { connections: { 'builtin:exa': unsafe } }, { connections: { 'builtin:exa': { options: unsafe } } }, { connections: { 'custom:x': { ...custom, options: unsafe } } }]) {
      expectReset(config, key)
      expect(() => resolveSettings(config)).toThrow('unsafe key')
    }
  })

  it.each([
    ['label', { connections: { 'builtin:exa': { label: 'x'.repeat(201) } } }],
    ['label', { connections: { 'custom:x': { ...custom, label: 'x'.repeat(201) } } }],
    ['defaultConnection', { defaultConnection: oversizedText }],
    ['credentialRef', { connections: { 'custom:x': { ...custom, credentialRef: oversizedText } } }],
    ['endpoint', { connections: { 'custom:x': { ...custom, endpoint: 'https://gateway.test/' + oversizedText, trustedEndpoint: true } } }],
    ['model', { connections: { 'builtin:deepseek-messages': { options: { model: oversizedText } } } }],
    ['apiVersion', { connections: { 'builtin:deepseek-messages': { options: { apiVersion: oversizedText } } } }],
  ])('bounds settings text in %s', (field, config) => {
    expect(() => resolveSettings(config)).toThrow(field)
  })

  it('accepts a label at the 200-character limit', () => {
    expect(resolveSettings({ connections: { 'custom:x': { ...custom, label: 'x'.repeat(200) } } }).connections.get('custom:x')).toHaveProperty('label', 'x'.repeat(200))
  })

  it('accepts 200 configured connections and rejects 201 before resolving them', () => {
    const connections = Object.fromEntries(Array.from({ length: 200 }, (_, index) => ['custom:c' + index, custom]))
    expect(resolveSettings({ connections }).connections.size).toBe(Object.keys(CATALOG).length + 200)
    connections['custom:overflow'] = custom
    expect(() => resolveSettings({ connections })).toThrow('200')
  })

  it.each(['structured'])('rejects retired custom kind %s rather than normalizing it', kind => {
    expect(() => resolveSettings({ connections: { 'custom:work': { ...custom, kind } } })).toThrow('kind')
  })

  it('permits existing disabled defaults without silently switching to another connection', () => {
    for (const id of ['builtin:exa', 'custom:work']) {
      const settings = resolveSettings({ defaultConnection: id, connections: { [id]: id.startsWith('custom:') ? { ...custom, disabled: true } : { disabled: true } } })
      expect(settings.defaultConnection).toBe(id)
      expect(settings.connections.get(id)?.disabled).toBe(true)
    }
  })

  it.each(['custom:missing', 'builtin:missing', 'builtin:deepseek', 'other:x'])('rejects unknown connection/default id %s with reset guidance', id => {
    expectReset({ defaultConnection: id }, id)
    if (id !== 'custom:missing') expectReset({ connections: { [id]: {} } }, id)
  })

  it.each([
    ['top-level literal key', { apiKey: 'fixture-not-real' }, 'apiKey'],
    ['unknown top-level field', { typo: true }, 'typo'],
    ['unknown defaults field', { defaults: { typo: true } }, 'typo'],
    ['literal key on a built-in', { connections: { 'builtin:exa': { apiKey: 'fixture-not-real' } } }, 'apiKey'],
    ['endpoint override on a built-in adapter', { connections: { 'builtin:exa': { endpoint: 'https://other.test' } } }, 'endpoint'],
    ['unknown custom field', { connections: { 'custom:x': { ...custom, binding: {} } } }, 'binding'],
    ['malformed custom id', { connections: { 'custom:bad name': custom } }, 'custom:bad name'],
    ['unknown native option', { connections: { 'builtin:deepseek-messages': { options: { apiKey: 'fixture-not-real' } } } }, 'apiKey'],
    ['unknown adapter option', { connections: { 'custom:x': { ...custom, options: { typo: true } } } }, 'typo'],
  ])('rejects %s with the offending field and reset guidance', (_case, config, field) => {
    expectReset(config, field)
  })

  it.each([
    ['keyless native access', { connections: { 'builtin:deepseek-search-api': { access: 'keyless' } } }, 'access'],
    ['keyless credential-only adapter', { connections: { 'builtin:semanticscholar': { access: 'keyless' } } }, 'access'],
    ['unknown access mode', { connections: { 'builtin:exa': { access: 'account' } } }, 'access'],
    ['unknown adapter', { connections: { 'custom:x': { ...custom, adapter: 'deepseek' } } }, 'adapter'],
    ['native as custom adapter', { connections: { 'custom:x': { ...custom, adapter: 'deepseek-messages' } } }, 'adapter'],
    ['invalid credential reference', { connections: { 'custom:x': { ...custom, credentialRef: 'not a ref' } } }, 'credentialRef'],
    ['invalid freshness', { defaults: { freshness: 'hourly' } }, 'freshness'],
    ['invalid selector switch', { showSelector: 'no' }, 'showSelector'],
    ['invalid native count', { connections: { 'builtin:deepseek-search-api': { options: { count: 51 } } } }, 'count'],
    ['invalid native boolean', { connections: { 'builtin:deepseek-search-api': { options: { sendOriginalQuestion: 'yes' } } } }, 'sendOriginalQuestion'],
    ['invalid native budget', { connections: { 'builtin:deepseek-messages': { options: { maxTokens: 0 } } } }, 'maxTokens'],
    ['invalid native uses', { connections: { 'builtin:deepseek-messages': { options: { maxUses: 0 } } } }, 'maxUses'],
    ['API-key-only option on keyless', { connections: { 'builtin:exa': { options: { type: 'fast' } } } }, 'needs API-key'],
    ['invalid option even when disabled', { connections: { 'builtin:firecrawl': { disabled: true, options: { safe: 'yes' } } } }, 'safe'],
  ])('rejects %s with the offending field', (_case, config, field) => {
    expect(() => resolveSettings(config)).toThrow(field)
  })

  it.each(['https://user:pass@example.test/v1', 'https://example.test/v1?key=x', 'https://example.test/v1#fragment', 'file:///tmp/search', 'relative'])('rejects unsafe endpoint shape %s on adapters and native connections', endpoint => {
    expect(() => resolveSettings({ connections: { 'custom:x': { ...custom, endpoint, trustedEndpoint: true } } })).toThrow('endpoint')
    for (const key of NATIVE_KEYS) expect(() => resolveSettings({ connections: { [builtinId(key)]: { trustedEndpoint: true, options: { baseURL: endpoint } } } })).toThrow('baseURL')
  })

  it.each([null, [], 'settings', 1])('rejects non-document input %j', document => {
    expect(() => resolveSettings(document)).toThrow('settings')
  })
})

describe('search model settings', () => {
  const fixed = { kind: 'model', protocol: 'anthropic-messages', model: 'search-model', label: 'Fixed search', endpoint: 'https://model.example/v1', trustedEndpoint: true, credentialRef: 'MODEL_KEY' }
  const resolveFixed = (override: Record<string, unknown> = {}) => resolveSettings({ defaultConnection: 'custom:model', connections: { 'custom:model': { ...fixed, ...override } } })

  it('enables Session model by default and accepts it as the default connection', () => {
    const settings = resolveSettings({ defaultConnection: 'builtin:session-model', connections: { 'builtin:session-model': { label: 'Follow model', disabled: true, options: { maxTokens: 4096, maxUses: 5, searchContextSize: 'medium' } } } })
    expect(settings.defaultConnection).toBe('builtin:session-model')
    expect(resolveSettings().connections.get('builtin:session-model')).toEqual({ id: 'builtin:session-model', kind: 'model', label: 'Session model', disabled: false, remote: true, trustedEndpoint: false, options: {}, route: { kind: 'session' } })
    expect(settings.connections.get('builtin:session-model')).toMatchObject({ label: 'Follow model', disabled: true, options: { maxTokens: 4096, maxUses: 5, searchContextSize: 'medium' }, route: { kind: 'session' } })
  })
  it.each(['access', 'credentialRef', 'trustedEndpoint'])('refuses a Session model %s override', field => {
    expect(() => resolveSettings({ connections: { 'builtin:session-model': { [field]: undefined } } })).toThrow('connections.builtin:session-model.' + field)
    expect(() => resolveSettings({ connections: { 'builtin:session-model': { [field]: undefined } } })).toThrow('takes its route from the Session model')
  })
  it.each(['anthropic-messages', 'openai-responses', 'openai-chat-completions'])('accepts a fixed %s model and its protocol options as a default', protocol => {
    const options = protocol === 'anthropic-messages' ? { maxTokens: 32_000, maxUses: 10 } : { maxTokens: 1, searchContextSize: 'high' }
    const settings = resolveFixed({ protocol, options })
    expect(settings.defaultConnection).toBe('custom:model')
    expect(settings.connections.get('custom:model')).toEqual({ id: 'custom:model', kind: 'model', label: 'Fixed search', disabled: false, remote: true, trustedEndpoint: true, options, route: { kind: 'fixed', protocol, model: fixed.model, endpoint: fixed.endpoint, credentialRef: fixed.credentialRef } })
  })
  it.each([
    ['protocol', undefined], ['protocol', 'unknown'], ['model', undefined], ['model', ''], ['model', 'x'.repeat(201)], ['model', 'bad\nmodel'],
    ['endpoint', undefined], ['endpoint', 'relative'], ['endpoint', 'https://user:pass@model.example'], ['endpoint', 'https://model.example?key=x'],
    ['trustedEndpoint', undefined], ['trustedEndpoint', false], ['credentialRef', undefined], ['credentialRef', 'bad ref'],
  ])('rejects invalid fixed model %s (%j)', (field, value) => {
    expect(() => resolveFixed({ [field]: value })).toThrow('connections.custom:model.' + field)
  })
  it.each([
    ['anthropic-messages', { searchContextSize: 'low' }], ['openai-responses', { maxUses: 1 }], ['openai-chat-completions', { maxUses: 1 }],
    ['anthropic-messages', { maxUses: 51 }], ['anthropic-messages', { maxTokens: 128_001 }], ['openai-responses', { searchContextSize: 'huge' }],
  ])('rejects unsupported options on %s (%j)', (protocol, options) => {
    expect(() => resolveFixed({ protocol, options })).toThrow('connections.custom:model.options')
  })
  it.each([false, true])('rejects simultaneous domain policies on Messages or Session model (disabled: %s)', disabled => {
    for (const options of [{ allowedDomains: ['allowed.test'], blockedDomains: ['blocked.test'] }, { allowedDomains: [], blockedDomains: [] }]) {
      for (const [id, connection] of [
        ['builtin:session-model', { options, disabled }],
        ['custom:model', { ...fixed, options, disabled }],
      ] as const) {
        const config = { connections: { [id]: connection } }
        // The catalog declares the pair exclusive; the shared option check reports it with the other option problems.
        expect(() => resolveSettings(config)).toThrow('connections.' + id + '.options')
        expect(() => resolveSettings(config)).toThrow('options "allowedDomains" and "blockedDomains" cannot both be set')
      }
    }
  })
  it('allows Responses to combine domain policies, while either alone is valid for Messages and Session model', () => {
    const combined = { allowedDomains: ['allowed.test'], blockedDomains: ['blocked.test'] }
    expect(resolveFixed({ protocol: 'openai-responses', options: combined }).connections.get('custom:model')).toMatchObject({ options: combined })
    for (const options of [{ allowedDomains: ['allowed.test'] }, { blockedDomains: ['blocked.test'] }, { allowedDomains: [] }]) {
      expect(resolveFixed({ options }).connections.get('custom:model')).toMatchObject({ options })
      expect(resolveSettings({ connections: { 'builtin:session-model': { options } } }).connections.get('builtin:session-model')).toMatchObject({ options })
    }
  })
  it.each([
    ['anthropic-messages', { maxTokens: 128_000, maxUses: 50, anthropicTool: 'web_search_20260318', allowedCallers: 'direct', responseInclusion: 'excluded', allowedDomains: ['example.com/blog'], userCity: 'Boston', userRegion: 'Massachusetts', userCountry: 'US', userTimezone: 'America/New_York' }],
    ['openai-responses', { responsesTool: 'web_search_preview', searchContextSize: 'high', externalWebAccess: false, returnTokenBudget: 'unlimited', allowedDomains: ['example.com'], blockedDomains: ['blocked.test'], userCountry: 'GB' }],
    ['openai-chat-completions', { maxTokens: 128_000, searchContextSize: 'low', userCountry: 'GB', userTimezone: 'Europe/London' }],
  ])('accepts configurable %s tool options', (protocol, options) => {
    expect(resolveFixed({ protocol, options }).connections.get('custom:model')).toMatchObject({ options })
  })
  it('keeps Reset guidance on unknown model fields and options', () => {
    expectReset({ connections: { 'builtin:session-model': { endpoint: fixed.endpoint } } }, 'endpoint')
    expectReset({ connections: { 'builtin:session-model': { options: { typo: true } } } }, 'typo')
    expectReset({ connections: { 'custom:model': { ...fixed, adapter: 'exa' } } }, 'adapter')
  })
})

describe('search settings version policy', () => {
  it('treats an omitted version as version 2 of the unified grammar', () => {
    expect(resolveSettings({ version: 2 })).toEqual(resolveSettings({}))
  })

  it.each([0, -1, 1.5, '2', null, 3])('rejects invalid or future version %j', version => {
    expect(() => resolveSettings({ version })).toThrow('version')
  })

  it.each(['providerId', 'schemaVersion', 'freshness', 'model', 'apiKeyEnv', 'maxTokens', 'fallbackModel'])('rejects predecessor field %s even with the current version', field => {
    for (const version of [undefined, CURRENT_SETTINGS_VERSION]) expectReset({ version, [field]: undefined }, field)
  })

  it('rejects explicit version 1 with reset guidance without mutating input', () => {
    const document = Object.freeze({ version: 1 })
    expectReset(document, 'version')
    expect(document).toEqual({ version: 1 })
  })
})

describe('search unified settings fixtures', () => {
  it('resolves all unified YAML examples without migration or mutation', () => {
    const documents = parseAllDocuments(readFileSync(new URL('./fixtures/unified-settings.yml', import.meta.url), 'utf8'))
    expect(documents).toHaveLength(6)
    for (const document of documents) {
      expect(document.errors).toEqual([])
      const config: unknown = document.toJS()
      const original = structuredClone(config)
      const resolved = resolveSettings(config)
      expect(config).toEqual(original)
      expect(resolved.version).toBe(CURRENT_SETTINGS_VERSION)
      expect(resolved.connections.has(resolved.defaultConnection)).toBe(true)
      expect(resolved.defaults).toHaveProperty('freshness')
    }
  })
})
