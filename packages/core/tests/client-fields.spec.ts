import { describe, expect, it } from 'vitest'
import { fieldValue, isValidText, type OptionField } from '../src/client/settings/fields.ts'

describe('capability-specific integer bounds', () => {
  const redirects: OptionField = { name: 'maxRedirects', kind: 'integer', label: 'redirects', values: [], min: 0, max: 20, placeholder: () => undefined }
  it('accepts zero when the descriptor allows disabling redirects', () => {
    expect(isValidText(redirects, '0')).toBe(true)
    expect(fieldValue(redirects, '0')).toBe(0)
  })
  it('retains positive-only fields and canonical bounded integer text', () => {
    expect(isValidText({ ...redirects, min: 1 }, '0')).toBe(false)
    for (const text of ['-1', '01', '1.5', '21']) expect(isValidText(redirects, text)).toBe(false)
    expect(isValidText(redirects, '')).toBe(true)
  })
})
