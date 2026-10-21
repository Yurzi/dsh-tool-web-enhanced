import { describe, expect, it } from 'vitest'
import { applyFields, conflictOf, fieldText, fieldValue, isValidText, listProblem, type OptionField } from '../src/client/settings/fields.ts'

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
  it('edits a list one item per line, ignoring blank lines and surrounding space', () => {
    const domains: OptionField = { name: 'allowedDomains', label: 'domains', kind: 'list', values: [], pattern: /^[a-z.]+(?:\/\S+)?$/u, maxItems: 2, placeholder: () => undefined }
    expect(fieldText(['a.example', 'b.example/docs'])).toBe('a.example\nb.example/docs')
    expect(fieldValue(domains, ' a.example \n\n b.example/docs ')).toEqual(['a.example', 'b.example/docs'])
    expect(fieldValue(domains, '\n  \n')).toBeUndefined()
    expect(isValidText(domains, 'a.example\n\nb.example')).toBe(true)
    expect(listProblem(domains, 'a.example\n\nhttps://b.example')).toEqual({ kind: 'line', line: 3, item: 'https://b.example' })
    expect(isValidText(domains, 'a.example\nhttps://b.example')).toBe(false)
    expect(listProblem(domains, 'a.example\nb.example\nc.example')).toEqual({ kind: 'count', max: 2 })
    expect(applyFields([domains], { allowedDomains: '' }, { allowedDomains: ['old.example'], other: 1 })).toEqual({ other: 1 })
  })
  it('finds the exclusive option that also has a value; blank lines are no value', () => {
    const list = { kind: 'list', values: [], pattern: /^[a-z.]+$/u, placeholder: () => undefined } as const
    const allow: OptionField = { ...list, name: 'allow', label: 'allow', exclusive: ['block'] }
    const block: OptionField = { ...list, name: 'block', label: 'block', exclusive: ['allow'] }
    const fields = [allow, block]
    expect(conflictOf(allow, fields, { allow: 'a.example', block: 'b.example' })).toBe(block)
    expect(conflictOf(block, fields, { allow: 'a.example', block: 'b.example' })).toBe(allow)
    expect(conflictOf(allow, fields, { allow: 'a.example', block: '\n ' })).toBeUndefined()
    expect(conflictOf(allow, fields, { allow: 'a.example' })).toBeUndefined()
    const { exclusive: _none, ...free } = allow
    expect(conflictOf(free, fields, { allow: 'a.example', block: 'b.example' })).toBeUndefined()
  })
  it('accepts large values up to a safe integer bound', () => {
    const bytes: OptionField = { ...redirects, name: 'maxAge', min: 0, max: Number.MAX_SAFE_INTEGER }
    expect(isValidText(bytes, '172800000000')).toBe(true)
    expect(isValidText(bytes, '9007199254740993')).toBe(false)
  })
})
