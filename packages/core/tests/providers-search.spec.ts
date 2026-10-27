import { describe, expect, it, vi } from 'vitest'
import { envelope, rowsAt, type SearchInput } from '../src/host/providers/search.ts'
import { anysearchSearch } from '../src/host/providers/anysearch.ts'
import { bodyDetail, type FailureResponse } from '../src/host/transport.ts'

const anysearchInput: SearchInput = { query: 'current query', maxResults: 100, freshness: 'realtime', options: {} }

describe('AnySearch search wire', () => {
  it('sends only the REST JSON headers and overrides option query and count after spreading options', () => {
    expect(anysearchSearch.request({ ...anysearchInput, options: { zone: 'cn', language: 'zh-CN', query: 'ignored', max_results: 999 } }, 'https://fixture.invalid/search', { kind: 'api-key', key: 'fixture-key' })).toStrictEqual({
      method: 'POST', url: 'https://fixture.invalid/search',
      headers: { authorization: 'Bearer fixture-key', 'content-type': 'application/json', accept: 'application/json' },
      body: { zone: 'cn', language: 'zh-CN', query: 'current query', max_results: 10 },
    })
    expect(anysearchSearch.keyless).toBeUndefined()
    expect(anysearchSearch.request({ ...anysearchInput, maxResults: undefined }, 'https://fixture.invalid/search', { kind: 'api-key', key: 'fixture-key' }).body).toEqual({ query: 'current query' })
  })

  it.each([
    [null, { kind: 'failure', failure: 'invalid', reason: 'not-object' }],
    [[], { kind: 'failure', failure: 'invalid', reason: 'not-object' }],
    [{}, { kind: 'failure', failure: 'invalid', reason: 'code-number' }],
    [{ code: '0', data: { results: [] } }, { kind: 'failure', failure: 'invalid', reason: 'code-number' }],
    [{ code: 0 }, { kind: 'failure', failure: 'invalid', reason: 'data-results-array' }],
    [{ code: 0, data: { results: {} } }, { kind: 'failure', failure: 'invalid', reason: 'data-results-array' }],
    [{ code: -1, message: '  rejected query  ' }, { kind: 'failure', failure: 'api', detail: { kind: 'text', text: '  rejected query  ' } }],
    [{ code: 1, message: {} }, { kind: 'failure', failure: 'api', detail: undefined }],
    [{ code: 0, data: { results: [] } }, { kind: 'rows', rows: [] }],
  ])('parses the code and nested result envelope (%#)', (payload, expected) => {
    expect(anysearchSearch.parse(payload, anysearchInput)).toStrictEqual(expected)
  })

  it('prefers nonblank snippet and otherwise keeps content, without parsing dates or filtering candidate URLs', () => {
    expect(anysearchSearch.parse({ code: 0, data: { results: [
      { url: 'https://example.com/a', title: '', snippet: ' summary ', content: 'summary date: 2026-01-01' },
      { url: 'https://example.com/b', content: 'fallback' }, { snippet: '   ', content: 'blank fallback' }, null,
    ] } }, anysearchInput)).toStrictEqual({ kind: 'rows', rows: [
      { url: 'https://example.com/a', title: '', snippet: 'summary' },
      { url: 'https://example.com/b', title: undefined, snippet: 'fallback' },
      { url: undefined, title: undefined, snippet: 'blank fallback' },
    ] })
  })

  it.each([400, 401, 403, 415, 422, 429, 502])('leaves HTTP %i and error codes to the generic status verdict', status => {
    const explanation = bodyDetail('generic explanation')
    const explain = vi.fn(bodyDetail)
    const response: FailureResponse = { status, json: { code: -1, message: 'selected', error_code: 'invalid_extract_url' }, explanation, explain }
    if (anysearchSearch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    expect(anysearchSearch.parseFailure(response, anysearchInput)).toStrictEqual({ kind: 'status', detail: explanation })
    expect(explain).not.toHaveBeenCalled()
  })

  it('ignores the complete HTTP 402 body and explanation', () => {
    if (anysearchSearch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    const response: FailureResponse = {
      status: 402,
      get json() { throw new Error('402 body must not be inspected') },
      get explanation(): never { throw new Error('402 explanation must not be read') },
      explain() { throw new Error('402 explanation must not be selected') },
    }
    expect(anysearchSearch.parseFailure(response, anysearchInput)).toStrictEqual({ kind: 'status', detail: undefined })
  })
})

describe('search API error envelopes', () => {
  it.each([
    [{ error: '  quota exceeded  ', message: 'ignored' }, '  quota exceeded  '],
    [{ error: { message: '  invalid query  ' }, message: 'ignored' }, '  invalid query  '],
    [{ error: '  ', message: '  try again  ' }, '  try again  '],
    [{ error: { message: '  ' }, message: '  try again  ' }, '  try again  '],
    [{ success: false, message: '  unavailable  ' }, '  unavailable  '],
    [{ success: false }, undefined],
    [{ error: { code: 'DENIED' }, message: 123 }, undefined],
    [{ success: false, detail: 'not a search error field' }, undefined],
  ])('extracts the first nonempty supported explanation (%#)', (payload, detail) => {
    const expected = { kind: 'failure', failure: 'api', detail: detail === undefined ? undefined : { kind: 'text', text: detail } }
    expect(envelope(payload)).toStrictEqual(expected)
    expect(rowsAt(payload, 'results')).toStrictEqual(expected)
  })

  it('preserves the complete API explanation for display after redaction', () => {
    expect(envelope({ error: 'x'.repeat(1999) + '😀trailing' })).toEqual({
      kind: 'failure', failure: 'api', detail: { kind: 'text', text: 'x'.repeat(1999) + '😀trailing' },
    })
  })

  it('keeps invalid envelopes closed and does not treat a message as an API error', () => {
    expect(envelope(null)).toEqual({ kind: 'failure', failure: 'invalid', reason: 'not-object' })
    expect(rowsAt({ message: 'upstream prose' }, 'results')).toEqual({ kind: 'failure', failure: 'invalid', reason: 'results-array' })
    expect(envelope({ error: null, results: [] })).toEqual({ kind: 'object', value: { error: null, results: [] } })
  })
})
