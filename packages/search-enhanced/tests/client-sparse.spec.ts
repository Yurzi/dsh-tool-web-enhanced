import { describe, expect, it } from 'vitest'
import { documentVersion, resetSettingsOperations, sparseSettingOperations } from '../src/client/settings/sparse.ts'

describe('sparse settings operations', () => {
  it('never writes catalog defaults or a version-only document', () => {
    expect(sparseSettingOperations({}, ['defaults', 'freshness'], 'auto', 'auto')).toEqual([])
    expect(sparseSettingOperations({}, ['showSelector'], true, true)).toEqual([])
    expect(sparseSettingOperations({}, ['defaultConnection'], undefined)).toEqual([])
    expect(resetSettingsOperations({})).toEqual([])
  })

  it('sets a difference once, stamping the schema version on the first write', () => {
    expect(sparseSettingOperations({}, ['defaults', 'freshness'], 'realtime', 'auto')).toEqual([
      { op: 'set', path: ['defaults', 'freshness'], value: 'realtime' }, { op: 'set', path: ['version'], value: 2 },
    ])
    expect(sparseSettingOperations({ user: { version: 2 } }, ['showSelector'], false, true)).toEqual([{ op: 'set', path: ['showSelector'], value: false }])
  })

  it('unsets a user value that returns to the inherited one, and keeps overrides of the composition layer', () => {
    expect(sparseSettingOperations({ user: { version: 2, showSelector: false } }, ['showSelector'], true, true)).toEqual([{ op: 'unset', path: ['showSelector'] }])
    const layers = { base: { defaults: { freshness: 'fresh' } }, user: { version: 2, defaults: { freshness: 'fresh' } } }
    expect(sparseSettingOperations(layers, ['defaults', 'freshness'], 'fresh', 'auto')).toEqual([{ op: 'unset', path: ['defaults'] }])
    expect(sparseSettingOperations(layers, ['defaults', 'freshness'], 'auto', 'auto')).toEqual([{ op: 'set', path: ['defaults', 'freshness'], value: 'auto' }])
  })

  it('removes the overrides a reverted value leaves empty, but not their siblings', () => {
    const user = { version: 2, connections: { 'builtin:tavily': { disabled: true }, 'builtin:exa': { access: 'api-key', disabled: true } } }
    expect(sparseSettingOperations({ user }, ['connections', 'builtin:tavily', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections', 'builtin:tavily'] }])
    expect(sparseSettingOperations({ user }, ['connections', 'builtin:exa', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections', 'builtin:exa', 'disabled'] }])
    const only = { version: 2, connections: { 'builtin:tavily': { disabled: true } } }
    expect(sparseSettingOperations({ user: only }, ['connections', 'builtin:tavily', 'disabled'], false, false)).toEqual([{ op: 'unset', path: ['connections'] }])
  })

  it('stores only the changed fields of an object against the inherited object', () => {
    const base = { version: 2, connections: { 'custom:one': { label: 'One', options: { location: 'old', country: 'us' } } } }
    expect(sparseSettingOperations({ base }, ['connections', 'custom:one'], { label: 'One', options: { location: 'new', country: 'us' } })).toEqual([
      { op: 'set', path: ['connections', 'custom:one'], value: { options: { location: 'new' } } },
      { op: 'set', path: ['version'], value: 2 },
    ])
    expect(sparseSettingOperations({ base: { options: { a: 1, b: 2 } } }, ['options'], { b: 2, a: 1 })).toEqual([])
  })

  it('reset unsets every actual top-level user field', () => {
    expect(resetSettingsOperations({ base: { defaults: { freshness: 'fresh' } }, user: { version: 2, defaultConnection: 'builtin:exa', connections: {}, unrelated: true } })).toEqual([
      { op: 'unset', path: ['version'] }, { op: 'unset', path: ['defaultConnection'] }, { op: 'unset', path: ['connections'] }, { op: 'unset', path: ['unrelated'] },
    ])
  })

  it('refuses ordinary edits of older/newer versions but permits explicit reset', () => {
    expect(documentVersion({ user: { version: 1 } })).toEqual({ kind: 'older', version: 1 })
    expect(documentVersion({ user: { version: 3 } })).toEqual({ kind: 'newer', version: 3 })
    for (const user of [{ version: 1 }, { version: 3 }]) {
      expect(() => sparseSettingOperations({ user }, ['defaults', 'freshness'], 'fresh')).toThrow()
      expect(resetSettingsOperations({ user })).toEqual([{ op: 'unset', path: ['version'] }])
    }
  })
})
