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
  it('accepts zero and negative values a rule allows, such as a cache age of -1 meaning cache only', () => {
    const cacheAge: OptionField = { ...redirects, name: 'maxAgeHours', min: -1, max: 720 }
    for (const text of ['-1', '0', '720']) expect(isValidText(cacheAge, text), text).toBe(true)
    for (const text of ['-2', '-0', '721', '--1', '1e3']) expect(isValidText(cacheAge, text), text).toBe(false)
    expect(fieldValue(cacheAge, '-1')).toBe(-1)
  })
  it('validates URL fields with the shared endpoint rules', () => {
    const field: OptionField = { name: 'baseURL', label: 'base', kind: 'url', values: [], placeholder: () => undefined }
    expect(isValidText(field, 'https://api.example/v1')).toBe(true)
    for (const value of ['ftp://api.example', 'https://user:secret@api.example/v1', 'https://api.example?token=1', 'https://api.example#fragment']) expect(isValidText(field, value), value).toBe(false)
  })
  it('accepts large values up to a safe integer bound', () => {
    const bytes: OptionField = { ...redirects, name: 'maxAge', min: 0, max: Number.MAX_SAFE_INTEGER }
    expect(isValidText(bytes, '172800000000')).toBe(true)
    expect(isValidText(bytes, '9007199254740993')).toBe(false)
  })
})
