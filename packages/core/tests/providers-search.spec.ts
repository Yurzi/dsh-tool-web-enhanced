import { describe, expect, it } from 'vitest'
import { envelope, rowsAt } from '../src/host/providers/search.ts'

describe('search API error envelopes', () => {
  it.each([
    [{ error: '  quota exceeded  ', message: 'ignored' }, 'quota exceeded'],
    [{ error: { message: '  invalid query  ' }, message: 'ignored' }, 'invalid query'],
    [{ error: '  ', message: '  try again  ' }, 'try again'],
    [{ error: { message: '  ' }, message: '  try again  ' }, 'try again'],
    [{ success: false, message: '  unavailable  ' }, 'unavailable'],
    [{ success: false }, undefined],
    [{ error: { code: 'DENIED' }, message: 123 }, undefined],
    [{ success: false, detail: 'not a search error field' }, undefined],
  ])('extracts the first nonempty supported explanation (%#)', (payload, detail) => {
    const expected = { kind: 'failure', failure: 'api', detail }
    expect(envelope(payload)).toStrictEqual(expected)
    expect(rowsAt(payload, 'results')).toStrictEqual(expected)
  })

  it('bounds API explanation without splitting a surrogate pair', () => {
    expect(envelope({ error: 'x'.repeat(1999) + '😀trailing' })).toEqual({
      kind: 'failure', failure: 'api', detail: 'x'.repeat(1999) + '…',
    })
  })

  it('keeps invalid envelopes closed and does not treat a message as an API error', () => {
    expect(envelope(null)).toEqual({ kind: 'failure', failure: 'invalid', reason: 'not-object' })
    expect(rowsAt({ message: 'upstream prose' }, 'results')).toEqual({ kind: 'failure', failure: 'invalid', reason: 'results-array' })
    expect(envelope({ error: null, results: [] })).toEqual({ kind: 'object', value: { error: null, results: [] } })
  })
})
