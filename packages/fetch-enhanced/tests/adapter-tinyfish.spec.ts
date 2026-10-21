import { describe, expect, it } from 'vitest'
import { tinyfishFetch as tinyfish, MAX_BODY_CHARS, type FetchInput } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG } from '../src/catalog.ts'
import { fetchResult } from '../src/remote/page.ts'
import { expectPage } from './fixtures/page.ts'

const input: FetchInput = { url: 'http://127.0.0.1/private?q=%2F#raw', options: {} }

function responseOutcome(payload: unknown) {
  return tinyfish.parse(payload, input)
}

function responsePage(payload: unknown) {
  return expectPage(responseOutcome(payload))
}

describe('Tinyfish fetch REST request and page mapping', () => {
  it.each(['api-key', 'keyless'] as const)('builds the original URL and operator options with %s headers', access => {
    const request = { ...input, options: { ttl: 0, per_url_timeout_ms: 110_000 } }
    const auth = access === 'keyless' ? { kind: 'keyless' } as const : { kind: 'api-key', key: 'fixture-key' } as const
    expect(tinyfish.request(request, CATALOG.tinyfish.endpoint, auth)).toEqual({
      method: 'POST', url: 'https://api.fetch.tinyfish.ai',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(access === 'api-key' ? { 'x-api-key': 'fixture-key' } : {}) },
      body: { urls: [input.url], format: 'markdown', ttl: 0, per_url_timeout_ms: 110_000 },
    })
    expect(CATALOG.tinyfish.access.keyless).toBe(false)
    expect(tinyfish.keyless).toBeUndefined()
  })

  it('maps the reported final URL and body without adding the title', () => {
    const page = responsePage({ results: [{ text: 'Body', title: 'Not included', final_url: 'https://example.com/final' }], errors: [] })
    expect(page).toEqual({ content: 'Body', target: { statusCode: 200, url: 'https://example.com/final' }, truncated: false })
    expect(fetchResult(page, input)).toEqual({ body: { kind: 'text', content: 'Body' }, statusCode: 200, url: 'https://example.com/final', truncated: false })
  })

  it.each([undefined, 'file:///secret', 'https://user:password@example.com/', 'https://example.com/' + 'x'.repeat(8192)])('falls back for an unusable final URL', final_url => {
    const page = responsePage({ results: [{ text: 'Page', final_url }] })
    expect(fetchResult(page, input)).toMatchObject({ statusCode: 200, url: input.url })
  })

  it('reads only the first row even when the result array exceeds service batch sizes', () => {
    const payload = { results: [{ text: 'first' }, ...Array(101).fill(null)] }
    const page = responsePage(payload)
    expect(page.content).toBe('first')
  })

  it.each([MAX_BODY_CHARS - 1, MAX_BODY_CHARS, MAX_BODY_CHARS + 1])('bounds %i characters through fetchResult', length => {
    const text = 'x'.repeat(length)
    const page = responsePage({ results: [{ text }] })
    expect(page.content).toBe(text)
    expect(page.truncated).toBe(false)
    expect(fetchResult(page, input)).toEqual({ statusCode: 200, url: input.url, body: { kind: 'text', content: text.slice(0, MAX_BODY_CHARS) }, truncated: length > MAX_BODY_CHARS })
  })

  it('does not split a surrogate pair at the character limit', () => {
    const text = 'x'.repeat(MAX_BODY_CHARS - 1) + '😀end'
    const result = fetchResult(responsePage({ results: [{ text }] }), input)
    expect(result.body.content).toBe('x'.repeat(MAX_BODY_CHARS - 1))
    expect(result.truncated).toBe(true)
  })

  it.each([404, 403, 410, 500])('returns an empty target HTTP %i result', status => {
    const page = responsePage({ results: [], errors: [{ error: 'target_http_error', status, message: 'UPSTREAM_SECRET' }] })
    expect(fetchResult(page, input)).toEqual({ statusCode: status, url: input.url, body: { kind: 'text', content: '' }, truncated: false })
  })

  it.each([
    ['timeout', 'timeout'], ['content_too_large', 'too-large'], ['invalid_url', 'invalid-url'],
    ['invalid_redirect_url', 'invalid-url'], ['empty_content', 'empty'], ['bot_blocked', 'failed'],
    ['login_required', 'failed'], ['page_not_found', 'failed'], ['target_unreachable', 'failed'],
  ] as const)('maps per-URL %s and preserves its service message', (error, failure) => {
    expect(responseOutcome({ results: [], errors: [{ error, message: 'UPSTREAM_SECRET' }] })).toStrictEqual({ kind: 'failure', failure, detail: 'UPSTREAM_SECRET' })
  })

  it.each([null, '404', 0, 600, 403.5])('never guesses a target status from %s', status => {
    expect(responseOutcome({ results: [], errors: [{ error: 'page_not_found', status }] })).toStrictEqual({ kind: 'failure', failure: 'failed', detail: 'page_not_found' })
  })

  it.each([
    null, [], { results: 'UPSTREAM_SECRET' },
    { results: [], errors: 'UPSTREAM_SECRET' }, { results: [], errors: [null] },
    { results: [[[[{ text: 'UPSTREAM_SECRET' }]]]] }, { results: [{ text: Array(1000).fill('UPSTREAM_SECRET') }] },
  ])('rejects hostile shapes without recursively traversing them', payload => {
    expect(responseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it.each([{ results: [] }, { results: [{}] }, { results: [{ text: '' }] }])('maps missing readable text to empty', ({ results }) => {
    expect(responseOutcome({ results })).toEqual({ kind: 'failure', failure: 'empty' })
  })

  it('rejects a deeply nested result without recursion', () => {
    const payload: unknown = JSON.parse('{"results":[' + '['.repeat(2000) + 'null' + ']'.repeat(2000) + ']}')
    expect(responseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })
})
