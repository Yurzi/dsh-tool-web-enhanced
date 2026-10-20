import { validateOptions, type OptionRule } from '../src/shared/connections.ts'
import { customConnectionSchema, documentVersion, migrateDocument, type CustomConnection } from '../src/shared/settings.ts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { resolveTestSettings, resolveLocalSettings } from './fixtures/settings.ts'

const hint = 'this release does not read 0.1.x settings; remove the field or use Reset on the settings page'
for (const [name, resolve, defaults] of [['custom-enabled', resolveTestSettings, { mode: 'auto' }], ['local-only', resolveLocalSettings, {}]] as const) {
  describe(name + ' shared settings document grammar', () => {
    it('uses the same resolved document fields and common connection fields', () => {
      const result = resolve({ version: 2, showSelector: false })
      expect(Object.keys(result).toSorted()).toEqual(['connections', 'defaultConnection', 'defaults', 'showSelector', 'version'])
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

  it('keep the interface and the schema of a persisted custom connection identical', () => {
    type Parsed = Readonly<z.output<ReturnType<typeof customConnectionSchema>>>
    expectTypeOf<Parsed>().toEqualTypeOf<CustomConnection>()
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
})
