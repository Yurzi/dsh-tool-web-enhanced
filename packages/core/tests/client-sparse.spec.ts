import { describe, expect, it } from 'vitest'
import { createSparseSettings } from '../src/client/settings/sparse.ts'
import { SETTINGS_FIELDS } from '../src/shared/settings.ts'
const sparse = createSparseSettings({ version: 2, fields: SETTINGS_FIELDS })

describe('unified sparse document writes', () => {
  it('does not stamp version for a pure unset on an unversioned document', () => {
    expect(sparse.sparseSettingOperations({ user: { showSelector: false } }, ['showSelector'], true, true)).toEqual([{ op: 'unset', path: ['showSelector'] }])
  })

  it('never silently removes unknown fields on ordinary writes', () => {
    expect(sparse.sparseSettingOperations({ user: { version: 2, providerId: 'old' } }, ['showSelector'], false, true)).toEqual([{ op: 'set', path: ['showSelector'], value: false }])
  })
  it('stamps version for edits even when the version is inherited', () => {
    expect(sparse.sparseSettingOperations({ base: { version: 2 } }, ['showSelector'], false, true)).toEqual([
      { op: 'set', path: ['showSelector'], value: false }, { op: 'set', path: ['version'], value: 2 },
    ])
  })
  it('resets all actual user top-level keys including malformed and predecessor fields', () => {
    const user = { version: 99, providerId: 'old', schemaVersion: 1, defaults: { freshness: 'fresh' }, typo: true }
    expect(sparse.resetSettingsOperations({ base: { connections: {} }, user })).toEqual(Object.keys(user).map(key => ({ op: 'unset', path: [key] })))
  })
  it('recognizes versions without inferring predecessor fields', () => {
    expect(sparse.documentVersion({ user: { model: 'old' } })).toEqual({ kind: 'current' })
    expect(sparse.documentVersion({ user: { version: 1 } })).toEqual({ kind: 'older', version: 1 })
    expect(sparse.documentVersion({ user: { version: 3 } })).toEqual({ kind: 'newer', version: 3 })
    expect(sparse.documentVersion({ user: { version: '2' } })).toMatchObject({ kind: 'invalid' })
    for (const version of [1, 3, '2']) expect(() => sparse.sparseSettingOperations({ user: { version } }, ['showSelector'], false)).toThrow()
  })
  it('preserves explicit empty lists and zero while pruning reverted overrides', () => {
    expect(sparse.sparseSettingOperations({ user: { version: 2 }, base: { connections: { 'builtin:local': { options: { allowCidrs: ['10.0.0.0/8'] } } } } }, ['connections', 'builtin:local', 'options', 'allowCidrs'], [])).toEqual([{ op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: [] }])
    expect(sparse.sparseSettingOperations({ user: { version: 2 } }, ['connections', 'builtin:local', 'options', 'maxRedirects'], 0, 5)).toEqual([{ op: 'set', path: ['connections', 'builtin:local', 'options', 'maxRedirects'], value: 0 }])
  })
})
