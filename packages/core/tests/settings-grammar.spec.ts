import { documentVersion, migrateDocument } from '../src/shared/settings.ts'
import { describe, expect, it } from 'vitest'
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
