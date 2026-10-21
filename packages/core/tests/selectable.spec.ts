import { describe, expect, it } from 'vitest'
import { isSelectable } from '../src/host/selectable.ts'

describe('connection selectability', () => {
  it.each(['native', 'adapter', 'local', 'model'] as const)('accepts an existing enabled %s connection', kind => {
    expect(isSelectable({ id: 'builtin:test', kind, disabled: false })).toBe(true)
    expect(isSelectable({ id: 'builtin:test', kind, disabled: true })).toBe(false)
  })
  it('rejects a missing connection', () => {
    expect(isSelectable(undefined)).toBe(false)
  })
})
