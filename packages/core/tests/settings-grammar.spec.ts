import { validateOptions, type OptionRule } from '../src/shared/connections.ts'
import { customConnectionSchema, documentVersion, migrateDocument, resolveDocument, type CustomConnection } from '../src/shared/settings.ts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { resolveModelSettings, resolveTestSettings, resolveLocalSettings } from './fixtures/settings.ts'

const hint = 'this release does not read 0.1.x settings; remove the field or use Reset on the settings page'
for (const [name, resolve, defaults] of [['custom-enabled', resolveTestSettings, { mode: 'auto' }], ['local-only', resolveLocalSettings, {}]] as const) {
  describe(name + ' shared settings document grammar', () => {
    it('uses the same resolved document fields and common connection fields', () => {
      const result = resolve({ version: 2, showSelector: false })
      expect(Object.keys(result).toSorted()).toEqual(['connections', 'defaultConnection', 'defaults', 'enhancedTools', 'showSelector', 'version'])
      expect(result).toMatchObject({ version: 2, showSelector: false, defaults })
      for (const connection of result.connections.values()) {
        expect(connection).toMatchObject({ id: expect.any(String), label: expect.any(String), disabled: false, remote: expect.any(Boolean), kind: expect.any(String), access: expect.any(String), trustedEndpoint: false, options: expect.any(Object) })
      }
    })
    it.each(['providerId', 'schemaVersion', 'freshness', 'apiKey', 'modelMode', 'typo'])('rejects old or unknown field %s by name with reset advice', field => {
      expect(() => resolve({ [field]: undefined })).toThrow(field)
      expect(() => resolve({ [field]: undefined })).toThrow(hint)
    })
    it.each(['builtin:deepseek', 'builtin:session-model', 'builtin:typo'])('rejects unknown connection %s without legacy aliases', id => {
      expect(() => resolve({ connections: { [id]: {} } })).toThrow(id)
      expect(() => resolve({ connections: { [id]: {} } })).toThrow(hint)
    })
    it.each([0, 1, 3, '2', null])('only accepts version 2, not %j', version => {
      expect(() => resolve({ version })).toThrow('version')
    })
    it('rejects unknown nested fields and defaults', () => {
      expect(() => resolve({ defaults: { typo: true } })).toThrow(hint)
      const id = resolve().defaultConnection
      expect(() => resolve({ connections: { [id]: { typo: true } } })).toThrow(hint)
      expect(() => resolve({ connections: { [id]: { options: { typo: true } } } })).toThrow(hint)
    })
  })
}

describe('custom connections', () => {
  it('are rejected as unknown connection ids, with reset advice, when the catalog has no adapter entries', () => {
    const custom = { kind: 'adapter', adapter: 'adapter', label: 'Mine', credentialRef: 'MINE_KEY' }
    expect(() => resolveLocalSettings({ connections: { 'custom:mine': custom } })).toThrow('connections.custom:mine: unknown connection id "custom:mine"; ' + hint)
    expect(() => resolveLocalSettings({ defaultConnection: 'custom:mine' })).toThrow('defaultConnection: unknown connection id "custom:mine"; ' + hint)
    expect(resolveTestSettings({ defaultConnection: 'custom:mine', connections: { 'custom:mine': custom } }).connections.get('custom:mine')).toMatchObject({ kind: 'adapter', access: 'api-key', credentialRef: 'MINE_KEY' })
  })

  it('rejects adapter kinds at kind when only protocols are declared', () => {
    const result = customConnectionSchema([], ['anthropic-messages']).safeParse({ kind: 'adapter', adapter: 'missing', label: 'Mine', credentialRef: 'MINE_KEY' })
    expect(result.success).toBe(false)
    if (result.success) throw new Error('expected an invalid connection kind')
    expect(result.error.issues.map(issue => issue.path)).toEqual([['kind']])
  })

  it('keep the interface and the schema of a persisted custom connection identical', () => {
    type Parsed = Readonly<z.output<ReturnType<typeof customConnectionSchema>>>
    expectTypeOf<Parsed>().toEqualTypeOf<CustomConnection>()
    const schema = customConnectionSchema(['adapter'], ['anthropic-messages', 'openai-responses'])
    expectTypeOf<Readonly<z.output<typeof schema>>>().toEqualTypeOf<CustomConnection<'adapter', 'anthropic-messages' | 'openai-responses'>>()
  })
})

describe('model connection grammar', () => {
  const fixed = { kind: 'model', protocol: 'anthropic-messages', model: 'search-model', label: 'Mine', endpoint: 'https://model.example/v1', trustedEndpoint: true, credentialRef: 'MODEL_KEY' }
  const resolveFixed = (override: Record<string, unknown> = {}) => resolveModelSettings({ defaultConnection: 'custom:mine', connections: { 'custom:mine': { ...fixed, ...override } } })

  it('resolves session and fixed routes without top-level authentication or endpoint fields', () => {
    expect(resolveModelSettings().connections.get('builtin:session-model')).toEqual({ id: 'builtin:session-model', catalogKey: 'session-model', kind: 'model', label: 'Session model', disabled: false, remote: true, trustedEndpoint: false, options: {}, route: { kind: 'session' } })
    const result = resolveFixed({ options: { maxTokens: 32_000, maxUses: 10 } })
    expect(result.defaultConnection).toBe('custom:mine')
    expect(result.connections.get('custom:mine')).toEqual({ id: 'custom:mine', catalogKey: 'anthropic-messages', kind: 'model', label: 'Mine', disabled: false, remote: true, trustedEndpoint: true, options: { maxTokens: 32_000, maxUses: 10 }, route: { kind: 'fixed', protocol: 'anthropic-messages', model: 'search-model', endpoint: fixed.endpoint, credentialRef: 'MODEL_KEY' } })
  })
  it('preserves the declared protocol keys in resolved fixed routes', () => {
    const connection = resolveFixed().connections.get('custom:mine')!
    if (connection.kind !== 'model' || connection.route.kind !== 'fixed') throw new Error('expected a fixed model route')
    expectTypeOf(connection.route.protocol).toEqualTypeOf<'anthropic-messages' | 'openai-responses'>()
  })

  it('accepts only label, disabled and options overrides on the Session route', () => {
    expect(resolveModelSettings({ connections: { 'builtin:session-model': { label: 'Follow', disabled: true, options: { maxTokens: 1 } } } }).connections.get('builtin:session-model')).toMatchObject({ label: 'Follow', disabled: true, options: { maxTokens: 1 } })
    for (const field of ['access', 'credentialRef', 'trustedEndpoint']) {
      expect(() => resolveModelSettings({ connections: { 'builtin:session-model': { [field]: undefined } } })).toThrow('connections.builtin:session-model.' + field)
      expect(() => resolveModelSettings({ connections: { 'builtin:session-model': { [field]: undefined } } })).toThrow('takes its route from the Session model')
    }
    expect(() => resolveModelSettings({ connections: { 'builtin:session-model': { endpoint: fixed.endpoint } } })).toThrow(hint)
  })
  it.each([
    ['protocol', undefined], ['protocol', 'missing'], ['model', undefined], ['model', ''], ['model', 'x'.repeat(201)], ['model', 'bad\nmodel'], ['model', 'bad\u007fmodel'],
    ['endpoint', undefined], ['endpoint', 'relative'], ['endpoint', 'https://user:pass@model.example'], ['endpoint', 'https://model.example?key=x'], ['endpoint', 'https://model.example#fragment'],
    ['trustedEndpoint', undefined], ['trustedEndpoint', false], ['credentialRef', undefined], ['credentialRef', 'bad ref'],
  ])('names the invalid fixed-route field %s (%j)', (field, value) => {
    expect(() => resolveFixed({ [field]: value })).toThrow('connections.custom:mine.' + field)
  })
  it('uses protocol-specific API-key option rules', () => {
    expect(resolveFixed({ protocol: 'openai-responses', options: { maxTokens: 1 } }).connections.get('custom:mine')).toMatchObject({ options: { maxTokens: 1 } })
    for (const override of [{ protocol: 'openai-responses', options: { maxUses: 1 } }, { options: { maxUses: 11 } }, { options: { maxTokens: 0 } }, { options: { typo: true } }]) {
      expect(() => resolveFixed(override)).toThrow('connections.custom:mine.options')
      expect(() => resolveFixed(override)).toThrow(hint)
    }
  })
  it('refuses model custom connections without a protocol table', () => {
    expect(() => resolveTestSettings({ connections: { 'custom:mine': fixed } })).toThrow('connections.custom:mine.kind')
  })
})

describe('document version identification and future upgrade pipeline', () => {
  it('recognizes omitted/current, older, newer and malformed version states', () => {
    expect(documentVersion({})).toEqual({ kind: 'current' })
    expect(documentVersion({ version: 2 })).toEqual({ kind: 'current' })
    expect(documentVersion({ version: 1 })).toEqual({ kind: 'older', version: 1 })
    expect(documentVersion({ version: 3 })).toEqual({ kind: 'newer', version: 3 })
    for (const value of [null, [], 'settings', { version: '2' }, { version: 0 }, { version: 1.2 }]) expect(documentVersion(value)).toMatchObject({ kind: 'invalid' })
  })
  it('does not mutate or alias a current document and never guesses a predecessor format', () => {
    const document = { defaults: { freshness: 'fresh' }, connections: {} }
    const migrated = migrateDocument(document)
    expect(migrated).toEqual(document)
    expect(migrated).not.toBe(document)
    expect(migrated.defaults).not.toBe(document.defaults)
    expect(() => migrateDocument({ version: 1 })).toThrow('no migration from version 1')
    expect(() => migrateDocument({ version: 3 })).toThrow('newer')
    expect(() => resolveTestSettings({ schemaVersion: 1 })).toThrow(hint)
    expect(() => resolveLocalSettings({ schemaVersion: 1 })).toThrow(hint)
  })
})

describe('option rules', () => {
  it('lets an integer option require API-key access, like the other rule kinds', () => {
    const rules: Record<string, OptionRule> = { maxAgeHours: { kind: 'integer', min: -1, max: 720, keyless: false }, timeout: { kind: 'integer', min: 1, max: 60 } }
    expect(validateOptions('Service', rules, { maxAgeHours: 24, timeout: 5 }, 'api-key')).toEqual([])
    expect(validateOptions('Service', rules, { timeout: 5 }, 'keyless')).toEqual([])
    expect(validateOptions('Service', rules, { maxAgeHours: 24 }, 'keyless')).toEqual(['Service option "maxAgeHours" = 24 needs API-key access'])
    expect(validateOptions('Service', rules, { maxAgeHours: 721 }, 'api-key')).toEqual(['Service option "maxAgeHours" has an invalid value'])
  })

  it('refuses options a descriptor declares exclusive when both are set, even empty', () => {
    const rules: Record<string, OptionRule> = { allow: { kind: 'list', pattern: /^[a-z.]+$/u, max: 5 }, block: { kind: 'list', pattern: /^[a-z.]+$/u, max: 5 }, size: { kind: 'integer', min: 1, max: 9 } }
    const exclusive = [['allow', 'block']] as const
    expect(validateOptions('Service', rules, { allow: ['a.example'], size: 2 }, 'api-key', exclusive)).toEqual([])
    expect(validateOptions('Service', rules, { allow: ['a.example'], block: ['b.example'] }, 'api-key')).toEqual([])
    expect(validateOptions('Service', rules, { allow: [], block: [] }, 'api-key', exclusive)).toEqual(['Service options "allow" and "block" cannot both be set'])
    expect(validateOptions('Service', rules, { allow: ['a.example'], block: ['b.example'], size: 99 }, 'api-key', exclusive))
      .toEqual(['Service option "size" has an invalid value', 'Service options "allow" and "block" cannot both be set'])
  })

  it('checks exclusive options of catalog entries and of custom model protocols in the document', () => {
    const list = { kind: 'list', pattern: /^[a-z.]+$/u, max: 5 } as const
    const options = { allow: list, block: list }
    const catalog = { follow: { label: 'Follow', kind: 'model', remote: true, optIn: false, access: { keyless: false, apiKey: false, account: false }, options, exclusive: [['allow', 'block']] } } as const
    const protocols = { strict: { label: 'Strict', options, exclusive: [['allow', 'block']] }, loose: { label: 'Loose', options } } as const
    const resolve = (connections: Record<string, unknown>) => resolveDocument({ catalog, protocols, document: { connections }, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:follow' }, capabilityLabel: 'test' })
    const both = { allow: ['a.example'], block: ['b.example'] }
    const fixed = (protocol: string) => ({ kind: 'model', protocol, model: 'm', label: 'M', endpoint: 'https://m.example', trustedEndpoint: true, credentialRef: 'M_KEY', options: both })
    for (const [id, connection] of [['builtin:follow', { options: both, disabled: true }], ['custom:strict', fixed('strict')]] as const) {
      expect(() => resolve({ [id]: connection })).toThrow('connections.' + id + '.options')
      expect(() => resolve({ [id]: connection })).toThrow('options "allow" and "block" cannot both be set')
    }
    expect(resolve({ 'custom:loose': fixed('loose') }).connections.get('custom:loose')).toMatchObject({ options: both })
  })
})
