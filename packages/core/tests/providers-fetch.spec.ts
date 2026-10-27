import { describe, expect, it, vi } from 'vitest'
import { reportedTarget, statusPage, type FetchInput, type FetchWire, type PageFailure } from '../src/host/providers/fetch.ts'
import { exaFetch } from '../src/host/providers/exa.ts'
import { firecrawlFetch } from '../src/host/providers/firecrawl.ts'
import { tavilyFetch } from '../src/host/providers/tavily.ts'
import { tinyfishFetch } from '../src/host/providers/tinyfish.ts'
import { anysearchFetch } from '../src/host/providers/anysearch.ts'
import { bodyDetail, type FailureResponse } from '../src/host/transport.ts'

const request: FetchInput = { url: 'https://example.com/a', options: {} }

describe('AnySearch extract wire', () => {
  it('sends exactly one URL despite input options, with only the REST JSON and Bearer headers', () => {
    expect(anysearchFetch.request({ ...request, options: { url: 'ignored', zone: 'cn', format: 'markdown' } }, 'https://fixture.invalid/extract', { kind: 'api-key', key: 'fixture-key' })).toStrictEqual({
      method: 'POST', url: 'https://fixture.invalid/extract',
      headers: { authorization: 'Bearer fixture-key', 'content-type': 'application/json', accept: 'application/json' },
      body: { url: request.url },
    })
    expect(anysearchFetch.keyless).toBeUndefined()
  })

  it.each([
    [null, 'invalid'], [[], 'invalid'], [{}, 'invalid'], [{ code: '0' }, 'invalid'],
    [{ code: 0 }, 'invalid'], [{ code: 0, data: [] }, 'invalid'],
    [{ code: 0, data: {} }, 'empty'], [{ code: 0, data: { content: '' } }, 'empty'],
    [{ code: 0, data: { content: null } }, 'invalid'], [{ code: 0, data: { content: 42 } }, 'invalid'],
  ])('parses invalid or empty envelopes (%#)', (payload, failure) => {
    expect(anysearchFetch.parse(payload, request)).toStrictEqual({ kind: 'failure', failure, detail: undefined })
  })

  it.each([49_999, 50_000, 50_001])('keeps %i content characters and infers the service truncation boundary', length => {
    const content = 'x'.repeat(length)
    expect(anysearchFetch.parse({ code: 0, data: { url: 'https://ignored.example/final', title: 'Not prepended', content, statusCode: 404 } }, request)).toStrictEqual({
      kind: 'page', page: { content, target: undefined, truncated: length >= 50_000 },
    })
  })

  const codes = [
    ['invalid_extract_url', 'invalid-url'], ['extract_target_blocked', 'blocked'],
    ['extract_content_too_large', 'too-large'], ['extract_unsupported_content', 'unsupported'],
    ['extract_timeout', 'timeout'], ['extract_canceled', 'failed'], ['unknown', 'failed'], [undefined, 'failed'],
  ] as const
  it.each(codes)('classifies successful error envelope %s without treating upstream cancellation as ours', (error_code, failure) => {
    expect(anysearchFetch.parse({ code: -1, error_code, message: '  service explanation  ' }, request)).toStrictEqual({
      kind: 'failure', failure, detail: { kind: 'text', text: '  service explanation  ' },
    })
  })

  it.each([400, 422])('classifies extract error codes only at HTTP %i', status => {
    if (anysearchFetch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    for (const [error_code, failure] of codes) {
      const explain = vi.fn(bodyDetail)
      const response: FailureResponse = { status, json: { code: -1, error_code, message: 'selected' }, explanation: bodyDetail('generic'), explain }
      const generic = status === 400 && ['extract_canceled', 'unknown', undefined].includes(error_code)
      expect(anysearchFetch.parseFailure(response, request)).toStrictEqual(generic
        ? { kind: 'status', detail: bodyDetail('generic') }
        : { kind: 'outcome', outcome: { kind: 'failure', failure, detail: bodyDetail('selected') } })
      if (generic) expect(explain).not.toHaveBeenCalled()
      else expect(explain).toHaveBeenCalledExactlyOnceWith('selected')
    }
  })

  it.each([400, 422])('handles missing or malformed JSON at HTTP %i', status => {
    if (anysearchFetch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    for (const json of [undefined, null, [], 'not JSON']) {
      const response: FailureResponse = { status, json, explanation: bodyDetail('generic'), explain: bodyDetail }
      expect(anysearchFetch.parseFailure(response, request)).toStrictEqual(status === 400
        ? { kind: 'status', detail: bodyDetail('generic') }
        : { kind: 'outcome', outcome: { kind: 'failure', failure: 'failed', detail: undefined } })
    }
  })

  it.each([401, 403, 415, 429, 502])('keeps generic HTTP %i wording even with a recognized extract code', status => {
    if (anysearchFetch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    const explanation = bodyDetail('generic explanation')
    const explain = vi.fn(bodyDetail)
    expect(anysearchFetch.parseFailure({ status, json: { error_code: 'invalid_extract_url', message: 'not selected' }, explanation, explain }, request)).toStrictEqual({ kind: 'status', detail: explanation })
    expect(explain).not.toHaveBeenCalled()
  })

  it('ignores the complete HTTP 402 body and explanation', () => {
    if (anysearchFetch.parseFailure === undefined) throw new Error('expected AnySearch failure classifier')
    const response: FailureResponse = {
      status: 402,
      get json() { throw new Error('402 body must not be inspected') },
      get explanation(): never { throw new Error('402 explanation must not be read') },
      explain() { throw new Error('402 explanation must not be selected') },
    }
    expect(anysearchFetch.parseFailure(response, request)).toStrictEqual({ kind: 'status', detail: undefined })
  })
})

describe('fetch provider page outcomes', () => {
  it('ignores an implausible status and an unusable final URL', () => {
    expect(reportedTarget('200', 'https://example.com/b', request.url)).toBeUndefined()
    expect(reportedTarget(1000, 'https://example.com/b', request.url)).toBeUndefined()
    expect(reportedTarget(200, 'https://user:secret@example.com/b', request.url)).toEqual({ statusCode: 200, url: request.url })
    expect(reportedTarget(200, 'file:///etc/passwd', request.url)).toEqual({ statusCode: 200, url: request.url })
  })

  it('represents a reported target status without content as an empty page', () => {
    expect(statusPage({ statusCode: 404, url: request.url })).toEqual({
      content: '', target: { statusCode: 404, url: request.url }, truncated: false,
    })
  })
})

describe('fetch provider service failure detail', () => {
  it.each([
    ['CRAWL_TIMEOUT', 'timeout'], ['CRAWL_LIVECRAWL_TIMEOUT', 'timeout'], ['SOURCE_NOT_AVAILABLE', 'failed'],
  ] as const)('preserves the Exa %s tag and optional message', (tag, failure) => {
    const parse = (error: unknown) => exaFetch.parse({ statuses: [{ status: 'error', error }] }, request)
    expect(parse({ tag, message: '  Origin refused this URL.  ' })).toStrictEqual({
      kind: 'failure', failure, detail: { kind: 'text', text: tag + ':   Origin refused this URL.  ' },
    })
    expect(parse({ tag })).toStrictEqual({ kind: 'failure', failure, detail: { kind: 'text', text: tag } })
    expect(parse({ tag, message: { private: 'not text' } })).toStrictEqual({ kind: 'failure', failure, detail: { kind: 'text', text: tag } })
  })

  it('preserves Exa message without a textual tag, but does not inspect other fields', () => {
    const parse = (error: unknown) => exaFetch.parse({ statuses: [{ status: 'error', error }] }, request)
    expect(parse({ tag: 42, message: 'Origin refused' })).toStrictEqual({ kind: 'failure', failure: 'failed', detail: { kind: 'text', text: 'Origin refused' } })
    expect(parse({ tag: {}, message: ['not text'], detail: 'not the judged field' })).toStrictEqual({ kind: 'failure', failure: 'failed', detail: undefined })
  })

  it.each(['  Service could not scrape this URL.  ', '', undefined, { message: 'not a string' }])('takes only Firecrawl failure error text: %j', error => {
    expect(firecrawlFetch.parse({ success: false, error, message: 'ignore', code: 'ignore' }, request)).toStrictEqual({
      kind: 'failure', failure: 'failed', detail: typeof error === 'string' && error.trim() !== '' ? { kind: 'text', text: error } : undefined,
    })
  })

  it.each(['  Target returned HTTP 404.  ', '', undefined, { message: 'not a string' }])('takes only the first Tavily failure error text: %j', error => {
    expect(tavilyFetch.parse({ results: [{ raw_content: 'ignored' }], failed_results: [{ error }, { error: 'ignore later failures' }], message: 'ignore' }, request)).toStrictEqual({
      kind: 'failure', failure: 'failed', detail: typeof error === 'string' && error.trim() !== '' ? { kind: 'text', text: error } : undefined,
    })
  })

  it.each([null, 'unstructured', {}])('does not reinterpret malformed Tavily first failure rows: %j', first => {
    expect(tavilyFetch.parse({ failed_results: [first, { error: 'ignore' }] }, request)).toStrictEqual({
      kind: 'failure', failure: 'failed', detail: undefined,
    })
  })

  it.each([
    [{ error: 'timeout', message: '  Timed out reading origin.  ', code: 'ORIGIN_TIMEOUT' }, 'timeout', '  Timed out reading origin.  '],
    [{ error: 'content_too_large', code: 'BODY_LIMIT' }, 'too-large', 'BODY_LIMIT'],
    [{ error: 'invalid_url' }, 'invalid-url', 'invalid_url'],
    [{ error: 'invalid_redirect_url', message: {} }, 'invalid-url', 'invalid_redirect_url'],
    [{ error: 'empty_content', message: '', code: '' }, 'empty', 'empty_content'],
    [{ error: 'bot_blocked' }, 'failed', 'bot_blocked'],
    [{ code: 'ORIGIN_FAILURE' }, 'failed', 'ORIGIN_FAILURE'],
    [{ message: 'Origin refused' }, 'failed', 'Origin refused'],
    [{ error: { message: 'not text' }, message: [], code: 42, detail: 'ignore' }, 'failed', undefined],
  ] as const)('preserves Tinyfish service text or current error code: %#', (error, failure, detail) => {
    expect(tinyfishFetch.parse({ errors: [error, { message: 'ignore later failures' }] }, request)).toStrictEqual({ kind: 'failure', failure, detail: detail === undefined ? undefined : { kind: 'text', text: detail } })
  })

  const failures: readonly [FetchWire, unknown, PageFailure][] = [
    [exaFetch, null, 'invalid'], [exaFetch, { statuses: {} }, 'invalid'],
    [exaFetch, { statuses: [null] }, 'invalid'], [exaFetch, { statuses: [{ status: 'error', error: 'not structured' }] }, 'invalid'],
    [exaFetch, { results: [] }, 'empty'], [exaFetch, { results: [null] }, 'invalid'],
    [exaFetch, { results: [{}] }, 'empty'], [exaFetch, { results: [{ text: 42 }] }, 'invalid'],
    [firecrawlFetch, null, 'invalid'], [firecrawlFetch, { success: true }, 'invalid'],
    [firecrawlFetch, { success: true, error: 'ignore', data: {} }, 'empty'],
    [firecrawlFetch, { success: true, error: 'ignore', data: { markdown: 42 } }, 'invalid'],
    [tavilyFetch, null, 'invalid'], [tavilyFetch, { failed_results: {} }, 'invalid'],
    [tavilyFetch, { results: [] }, 'failed'], [tavilyFetch, { results: [null] }, 'invalid'],
    [tavilyFetch, { results: [{}], error: 'ignore' }, 'empty'], [tavilyFetch, { results: [{ raw_content: 42 }] }, 'invalid'],
    [tinyfishFetch, null, 'invalid'], [tinyfishFetch, { errors: {} }, 'invalid'],
    [tinyfishFetch, { errors: [null] }, 'invalid'], [tinyfishFetch, { results: [] }, 'empty'],
    [tinyfishFetch, { results: [null] }, 'invalid'], [tinyfishFetch, { results: [{}], message: 'ignore' }, 'empty'],
    [tinyfishFetch, { results: [{ text: 42 }] }, 'invalid'],
  ]
  it.each(failures)('explicitly leaves unrelated or absent service detail undefined: %#', (wire, payload, failure) => {
    expect(wire.parse(payload, request)).toStrictEqual({ kind: 'failure', failure, detail: undefined })
  })

  const route = exaFetch.keyless
  if (typeof route !== 'object') throw new Error('expected the Exa MCP route')

  it('preserves Exa keyless limit text blocks without stripping them into a page', () => {
    const content = [{ type: 'text', text: '  Rate limit reached.  ' }, { type: 'image', data: 'ignore' }, { type: 'text', text: 'Please try later.' }]
    expect(route.parse({ content, _meta: { 'ai.exa/rateLimited': true } }, request)).toStrictEqual({
      kind: 'failure', failure: 'rate-limited', detail: { kind: 'text', text: '  Rate limit reached.  \n\nPlease try later.' },
    })
    expect(route.parse({ _meta: { 'ai.exa/rateLimited': true } }, request)).toStrictEqual({ kind: 'failure', failure: 'rate-limited', detail: undefined })
  })

  it.each([
    [{ content: [] }, 'empty'],
    [{ content: [{ type: 'text', text: 'No content found for this URL.' }] }, 'empty'],
    [{ content: 'not blocks' }, 'invalid'],
    [{ content: [{ type: 'text', text: {} }] }, 'invalid'],
    [{ content: Array.from({ length: 101 }, () => ({ type: 'text', text: 'x' })) }, 'invalid'],
    [{ content: [{ type: 'text', text: 'x'.repeat(512 * 1024 + 1) }] }, 'invalid'],
  ] as const)('leaves Exa keyless non-service failures without detail: %#', (result, failure) => {
    expect(route.parse(result, request)).toStrictEqual({ kind: 'failure', failure, detail: undefined })
  })
})
