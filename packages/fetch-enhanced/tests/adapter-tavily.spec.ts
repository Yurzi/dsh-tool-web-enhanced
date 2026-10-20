import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog.ts'
import { tavily } from '../src/remote/adapters/tavily.ts'
import { fetchResult, MAX_BODY_CHARS } from '../src/remote/page.ts'
import type { FetchInput } from '../src/remote/types.ts'
import { expectPage } from './fixtures/page.ts'

const KEY = 'fixture-secret-key'
const INPUT: FetchInput = { url: 'http://127.0.0.1/private/%2f?q=a%20b#fragment', options: {} }
const WIRE = tavily

function parseOutcome(payload: unknown, input = INPUT) {
  return WIRE.parse(payload, input)
}

function parsePage(payload: unknown, input = INPUT) {
  return expectPage(parseOutcome(payload, input))
}

describe('Tavily fetch request and page mapping', () => {
  it.each(['api-key', 'keyless'] as const)('sends the original URL, extraction body and %s headers', access => {
    const options = { extract_depth: 'advanced', format: 'text', timeout: 60 }
    const auth = access === 'keyless' ? { kind: 'keyless' } as const : { kind: 'api-key', key: KEY } as const
    expect(WIRE.keyless).toBe('rest')
    expect(WIRE.request({ ...INPUT, options }, CATALOG.tavily.endpoint, auth)).toEqual({
      method: 'POST', url: 'https://api.tavily.com/extract',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...access === 'api-key' ? { authorization: 'Bearer ' + KEY } : { 'x-tavily-access-mode': 'keyless' } },
      body: { urls: [INPUT.url], include_images: false, ...options },
    })
  })

  it('reads only the first row even when the result array exceeds service batch sizes', () => {
    const payload = { results: [{ raw_content: 'first' }, ...Array(101).fill(null)] }
    const page = parsePage(payload)
    expect(page.content).toBe('first')
  })

  it.each(['markdown', 'text'])('keeps %s content without guessing a target response from undocumented fields', format => {
    const payload = { results: [{ raw_content: '# Source\nbody', url: 'https://example.com/possibly-final', statusCode: 404, title: 'Ignored' }], failed_results: [] }
    const page = parsePage(payload, { ...INPUT, options: { format } })
    expect(page).toEqual({ content: '# Source\nbody', target: undefined, truncated: false })
    expect(fetchResult(page, INPUT)).toEqual({ body: { kind: 'text', content: '# Source\nbody' }, url: INPUT.url, statusCode: 200, truncated: false })
  })

  it.each([403, 404])('does not infer target %i from failed_results text or undocumented status fields', status => {
    const payload = { results: [], failed_results: [{ url: INPUT.url, status, error: 'Target returned HTTP ' + status + ' private upstream ' + KEY }] }
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'failed' })
  })

  it.each([
    { results: [{ raw_content: 'body' }], failed_results: {} },
    { results: [{ raw_content: 'body' }], failed_results: null },
    { results: { raw_content: 'body' } },
    { results: [null] }, { results: [[]] },
    [], null,
  ])('reports malformed extraction envelopes as invalid: %#', payload => {
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it.each([
    { results: [], failed_results: [] },
    { results: [{ raw_content: 'body' }], failed_results: [{ error: 'private upstream ' + KEY }] },
  ])('reports unsuccessful extraction as a failure: %#', payload => {
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'failed' })
  })

  it.each([undefined, ''])('reports missing readable raw content as empty: %j', raw_content => {
    expect(parseOutcome({ results: [{ raw_content }] })).toEqual({ kind: 'failure', failure: 'empty' })
  })

  it.each([null, { secret: KEY }, Array.from({ length: 100_000 }, () => [])])('reports non-text or empty raw_content with no traversal: %#', raw_content => {
    expect(parseOutcome({ results: [{ raw_content }] })).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it.each([MAX_BODY_CHARS, MAX_BODY_CHARS + 1, 1_000_000])('bounds %i body characters only in fetchResult', length => {
    const content = 'x'.repeat(length)
    const page = parsePage({ results: [{ raw_content: content }], failed_results: [] })
    expect(page.content).toBe(content)
    const result = fetchResult(page, INPUT)
    expect(result.body).toEqual({ kind: 'text', content: content.slice(0, MAX_BODY_CHARS) })
    expect(result.truncated).toBe(length > MAX_BODY_CHARS)
  })

  it('does not parse header-like lines or scan metadata in large raw content', () => {
    const content = '# ' + 'x'.repeat(400_000) + '\nURL: ' + KEY + '\n' + '\n'.repeat(100_000)
    const payload = { results: [{ raw_content: content, images: Array.from({ length: 100_000 }, () => []) }] }
    const result = fetchResult(parsePage(payload), INPUT)
    expect(result.body.content).toBe(content.slice(0, MAX_BODY_CHARS))
    expect(result.truncated).toBe(true)
  })

  it('does not traverse a deeply nested JSON root', () => {
    const payload: unknown = JSON.parse('['.repeat(20_000) + '0' + ']'.repeat(20_000))
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })
})
