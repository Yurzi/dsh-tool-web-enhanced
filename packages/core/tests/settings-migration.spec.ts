import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { documentVersion, migrateDocument, resolveDocument, type SettingsMigrations } from '../src/shared/settings.ts'

const catalog = { local: { kind: 'local', label: 'Local', remote: false, access: { keyless: true, apiKey: false, account: false }, options: {} } } as const
const future: SettingsMigrations = { currentVersion: 3, steps: new Map([[2, document => ({ ...document, showSelector: false })]]) }
const resolve = (document: unknown, migrations = future) => resolveDocument({ catalog, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:local' }, capabilityLabel: 'test', migrations })

describe('injected future document migrations', () => {
  it.each([{}, { version: 2 }])('always interprets omitted versions as v2, then migrates %j', document => {
    expect(documentVersion(document, 3)).toEqual({ kind: 'older', version: 2 })
    expect(migrateDocument(document, future)).toEqual({ ...document, version: 3, showSelector: false })
    expect(resolve(document)).toMatchObject({ version: 3, showSelector: false })
  })

  it('runs consecutive steps in order without mutating or aliasing input', () => {
    const document = { version: 2, defaults: { count: 0 } }
    const seen: unknown[] = []
    const migrations: SettingsMigrations = { currentVersion: 4, steps: new Map([
      [2, input => { seen.push(input.version); (input.defaults as { count: number }).count += 1; return { ...input } }],
      [3, input => { seen.push(input.version); return { ...input, showSelector: false } }],
    ]) }
    expect(migrateDocument(document, migrations)).toEqual({ version: 4, defaults: { count: 1 }, showSelector: false })
    expect(seen).toEqual([2, 3])
    expect(document).toEqual({ version: 2, defaults: { count: 0 } })
  })

  it('rejects missing steps, newer documents, and invalid migrated output', () => {
    expect(() => migrateDocument({}, { currentVersion: 4, steps: future.steps })).toThrow('no migration from version 3')
    expect(() => resolve({ version: 4 })).toThrow('newer')
    expect(() => resolve({}, { currentVersion: 3, steps: new Map([[2, input => ({ ...input, showSelector: 'bad' })]]) })).toThrow('showSelector')
  })

  it('keeps default core migrations at v2 and rejects predecessor formats', () => {
    expect(migrateDocument({})).toEqual({})
    expect(() => migrateDocument({ version: 1 })).toThrow('no migration from version 1')
    expect(() => migrateDocument({ version: 3 })).toThrow('newer')
  })
})

describe('bounded shared document validation', () => {
  it('rejects a huge array before reading its entries or cloning', () => {
    const huge = Array.from<unknown>({ length: 100_000 })
    Object.defineProperty(huge, '0', { enumerable: true, get() { throw new Error('entry must not be read') } })
    expect(() => migrateDocument({ connections: { 'builtin:local': { options: { values: huge } } } })).toThrow('at most 200')
  })

  it('rejects excessive depth before structuredClone can overflow', () => {
    const document: Record<string, unknown> = {}
    let child = document
    for (let index = 0; index < 10_000; index += 1) { const next = {}; child.child = next; child = next }
    expect(() => migrateDocument(document)).toThrow('depth')
  })

  it('bounds aggregate traversal work, object entries and text before cloning', () => {
    const branch = () => Object.fromEntries(Array.from({ length: 200 }, (_, index) => [String(index), [1, 2, 3]]))
    const document = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [String(index), branch()]))
    expect(() => migrateDocument(document)).toThrow('node budget')
    expect(() => migrateDocument({ connections: Object.fromEntries(Array.from({ length: 201 }, (_, index) => [String(index), {}])) })).toThrow('200')
    expect(() => migrateDocument({ value: 'x'.repeat(2001) })).toThrow('2000')
  })

  it('does not normalize connection identities or hardcode capability error language', () => {
    expect(() => resolve({ version: 3, defaultConnection: ' builtin:local ' })).toThrow('unknown connection id')
    expect(() => resolve({ version: 3, defaultConnection: 'custom:test' })).toThrow('defaultConnection: unknown connection id "custom:test"; this release does not read')
  })

  it('parses provided capability defaults once', () => {
    const result = resolveDocument({ catalog, document: { defaults: { value: 'input' } }, defaults: { schema: z.strictObject({ value: z.string().transform(value => value + '!') }), defaultConnection: 'builtin:local' }, capabilityLabel: 'test' })
    expect(result.defaults).toEqual({ value: 'input!' })
  })
})
