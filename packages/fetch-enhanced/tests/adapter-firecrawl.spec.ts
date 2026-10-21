import { describe, expect, it } from 'vitest'
import { firecrawlFetch as firecrawl, MAX_BODY_CHARS, type FetchInput } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG } from '../src/catalog.ts'
import { fetchResult } from '../src/remote/page.ts'
import { expectPage } from './fixtures/page.ts'

const KEY = 'fixture-secret-key'
const INPUT: FetchInput = { url: 'http://127.0.0.1/private/%2f?q=a%20b#fragment', options: {} }
const WIRE = firecrawl

function parseOutcome(payload: unknown, input = INPUT) {
  return WIRE.parse(payload, input)
}

function parsePage(payload: unknown, input = INPUT) {
  return expectPage(parseOutcome(payload, input))
}

describe('Firecrawl fetch request and page mapping', () => {
  it.each(['api-key', 'keyless'] as const)('sends the original URL, documented REST body and %s headers', access => {
    const options = { onlyMainContent: false, maxAge: 0, storeInCache: false, timeout: 1000, waitFor: 0, proxy: 'basic' }
    const auth = access === 'keyless' ? { kind: 'keyless' } as const : { kind: 'api-key', key: KEY } as const
    expect(WIRE.keyless).toBe('rest')
    expect(WIRE.request({ ...INPUT, options }, CATALOG.firecrawl.endpoint, auth)).toEqual({
      method: 'POST', url: 'https://api.firecrawl.dev/v2/scrape',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...access === 'api-key' ? { authorization: 'Bearer ' + KEY } : {} },
      body: { url: INPUT.url, formats: ['markdown'], ...options },
    })
  })

  it('maps readable markdown to a text page without inventing target metadata', () => {
    const page = parsePage({ success: true, data: { markdown: 'body' } })
    expect(page).toEqual({ content: 'body', target: undefined, truncated: false })
    expect(fetchResult(page, INPUT)).toEqual({ url: INPUT.url, statusCode: 200, body: { kind: 'text', content: 'body' }, truncated: false })
  })

  it.each([200, 201, 403, 404])('keeps target status %i and final URL without adding metadata to the body', statusCode => {
    const final = 'https://example.com/final?raw=%2f#part'
    const payload = { success: true, data: { markdown: '# Source\nText', metadata: {
      statusCode, url: final, sourceURL: INPUT.url, title: 'Not prefixed', error: 'private upstream', contentType: 'text/html',
    } } }
    const page = parsePage(payload)
    expect(page).toEqual({ content: '# Source\nText', target: { statusCode, url: final }, truncated: false })
    expect(fetchResult(page, INPUT)).toEqual({ body: { kind: 'text', content: '# Source\nText' }, url: final, statusCode, truncated: false })
  })

  it.each([403, 404])('returns an empty status page for target %i without markdown', statusCode => {
    const payload = { success: true, data: { metadata: { statusCode, url: 'https://example.com/refused', error: 'private upstream' } } }
    expect(fetchResult(parsePage(payload), INPUT)).toEqual({ url: 'https://example.com/refused', statusCode, body: { kind: 'text', content: '' }, truncated: false })
  })

  it.each(['file:///private', 'https://user:secret@example.com/a', 'https://example.com/' + 'x'.repeat(20_000)])('rejects an unusable reported final URL: %#', url => {
    const payload = { success: true, data: { markdown: 'body', metadata: { statusCode: 200, url } } }
    expect(fetchResult(parsePage(payload), INPUT).url).toBe(INPUT.url)
  })

  it.each([undefined, '404', -1, 600, 200.5])('does not invent a target status for %j', statusCode => {
    const payload = { success: true, data: { markdown: 'body', metadata: { statusCode, url: 'https://example.com/ignored' } } }
    const page = parsePage(payload)
    expect(page.target).toBeUndefined()
    expect(fetchResult(page, INPUT)).toMatchObject({ url: INPUT.url, statusCode: 200 })
  })

  it.each([
    { success: false, error: 'private upstream ' + KEY, code: 'SCRAPE_TIMEOUT', data: { metadata: { statusCode: 404 } } },
    { success: false, code: 'SCRAPE_ALL_ENGINES_FAILED' },
  ])('reports unsuccessful envelopes as a page failure: %#', payload => {
    expect(parseOutcome(payload)).toStrictEqual({ kind: 'failure', failure: 'failed', detail: 'error' in payload ? payload.error : undefined })
  })

  it.each([
    [], null, { success: 'true', data: { markdown: 'body' } },
    { success: true }, { success: true, data: [] }, { success: true, data: { markdown: null } },
    { success: true, data: { markdown: { secret: KEY } } },
    { success: true, data: { markdown: Array.from({ length: 100_000 }, () => []) } },
  ])('reports malformed markdown without traversal: %#', payload => {
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it.each([undefined, ''])('reports missing readable markdown as empty: %j', markdown => {
    expect(parseOutcome({ success: true, data: { markdown, metadata: { statusCode: 200 } } })).toEqual({ kind: 'failure', failure: 'empty' })
  })

  it.each([MAX_BODY_CHARS, MAX_BODY_CHARS + 1, 1_000_000])('bounds %i body characters only in fetchResult', length => {
    const content = 'x'.repeat(length)
    const page = parsePage({ success: true, data: { markdown: content } })
    expect(page.content).toBe(content)
    const result = fetchResult(page, INPUT)
    expect(result.body).toEqual({ kind: 'text', content: content.slice(0, MAX_BODY_CHARS) })
    expect(result.truncated).toBe(length > MAX_BODY_CHARS)
  })

  it('does not parse or strip huge metadata-like header lines from markdown', () => {
    const content = '# ' + 'x'.repeat(400_000) + '\nURL: ' + KEY + '\n' + '\n'.repeat(100_000)
    const payload = { success: true, data: { markdown: content, metadata: { title: 'x'.repeat(300_000) } } }
    const result = fetchResult(parsePage(payload), INPUT)
    expect(result.body.content).toBe(content.slice(0, MAX_BODY_CHARS))
    expect(result.truncated).toBe(true)
  })

  it('does not traverse a deeply nested JSON root', () => {
    const payload: unknown = JSON.parse('['.repeat(20_000) + '0' + ']'.repeat(20_000))
    expect(parseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })
})
