import { describe, expect, it } from 'vitest'
import { effectiveDocument, editableSettings, settingsOperations } from '../src/client/settings/document.ts'
import { resolveTestSettings as resolveSettings } from './fixtures/settings.ts'

describe('browser settings documents', () => {
  it('stamps unversioned documents atomically on set, but never on unset or Reset', () => {
    const set = [{ op: 'set' as const, path: ['showSelector'], value: false }]
    expect(settingsOperations({ user: {} }, set, resolveSettings)).toEqual([...set, { op: 'set', path: ['version'], value: 2 }])
    expect(settingsOperations({ base: { version: 2 }, user: {} }, set, resolveSettings)).toEqual(set)
    const unset = [{ op: 'unset' as const, path: ['showSelector'] }]
    expect(settingsOperations({ user: { showSelector: false } }, unset, resolveSettings)).toEqual(unset)
    expect(settingsOperations({ user: { version: 2 } }, [{ op: 'unset', path: ['version'] }], resolveSettings)).toEqual([{ op: 'unset', path: ['version'] }])
  })

  it('merges raw layers recursively, replacing arrays and scalars without using projected value', () => {
    const snapshot = {
      value: { version: 2 },
      base: { version: 2, providerId: 'inherited', connections: { 'builtin:local': { label: 'Inherited', options: { allowCidrs: ['10.0.0.0/8'], timeoutMs: 1000 } } } },
      user: { providerId: 'old', connections: { 'builtin:local': { options: { allowCidrs: [], timeoutMs: 2000 } } } },
    }
    const before = structuredClone(snapshot)
    expect(effectiveDocument(snapshot)).toEqual({ version: 2, providerId: 'old', connections: { 'builtin:local': { label: 'Inherited', options: { allowCidrs: [], timeoutMs: 2000 } } } })
    expect(snapshot).toEqual(before)
    expect(effectiveDocument({ base: { defaults: { freshness: 'auto' } }, user: { defaults: null } })).toEqual({ defaults: null })
  })

  it('preserves dangerous and unknown inherited keys for the shared validator', () => {
    const snapshot = { base: JSON.parse('{"__proto__":{},"providerId":"old"}') as unknown, user: { version: 2 } }
    const effective = effectiveDocument(snapshot)
    expect(Object.hasOwn(effective, '__proto__')).toBe(true)
    expect(editableSettings(effective, snapshot, true, resolveSettings)).toMatchObject({ kind: 'invalid', diagnostic: expect.stringContaining('__proto__') })
  })

  it('validates the exact deep-merged candidate, preserving inherited connection fields', () => {
    const layers = { base: { connections: { 'custom:inherited': { kind: 'adapter', adapter: 'adapter', label: 'Inherited', credentialRef: 'ADAPTER_KEY' } } }, user: { version: 2 } }
    const operations = [{ op: 'set' as const, path: ['connections', 'custom:inherited', 'label'], value: 'Renamed' }]
    expect(settingsOperations(layers, operations, resolveSettings)).toEqual(operations)
    expect(layers.base.connections['custom:inherited'].label).toBe('Inherited')
  })

  it('does not hide invalid inherited fields when a sibling override is edited', () => {
    const layers = { base: { connections: { 'builtin:adapter': { unknown: true } } }, user: { version: 2 } }
    expect(() => settingsOperations(layers, [{ op: 'set', path: ['connections', 'builtin:adapter', 'label'], value: 'Renamed' }], resolveSettings)).toThrow('unknown')
  })

  it.each([{}, { version: 2 }])('accepts current valid documents without writeback: %j', raw => {
    expect(editableSettings(raw, { base: {}, user: raw }, true, resolveSettings)).toMatchObject({ kind: 'ready', needsWriteback: false, config: raw })
  })

  it.each([{ version: 1 }, { version: 3 }, { version: '2' }, { schemaVersion: 1 }, { version: 2, defaults: { mode: 'bad' } }])('never writes back invalid or unmigratable documents: %j', raw => {
    expect(editableSettings(raw, { base: {}, user: raw }, true, resolveSettings)).toMatchObject({ kind: 'invalid', needsWriteback: false })
  })
})
