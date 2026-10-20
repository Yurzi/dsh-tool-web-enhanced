import { describe, expect, it } from 'vitest'
import type { McpToolResult } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG } from '../src/catalog.ts'
import { exa } from '../src/remote/adapters/exa.ts'
import { fetchResult, MAX_BODY_CHARS } from '../src/remote/page.ts'
import type { FetchInput } from '../src/remote/types.ts'
import { expectPage } from './fixtures/page.ts'

const input: FetchInput = { url: 'http://127.0.0.1/private?q=%2F#raw', options: {} }

function responseOutcome(payload: unknown) {
  return exa.parse(payload, input)
}

function responsePage(payload: unknown) {
  return expectPage(responseOutcome(payload))
}

describe('Exa fetch REST request and page mapping', () => {
  it('posts the original URL and operator options to the contents endpoint with an API key', () => {
    const request = { ...input, options: { maxAgeHours: -1, livecrawlTimeout: 90_000 } }
    expect(exa.request(request, CATALOG.exa.endpoint, { kind: 'api-key', key: 'fixture-key' })).toEqual({
      method: 'POST', url: 'https://api.exa.ai/contents',
      headers: { 'x-api-key': 'fixture-key', 'content-type': 'application/json', accept: 'application/json' },
      body: { urls: [input.url], text: { maxCharacters: MAX_BODY_CHARS }, maxAgeHours: -1, livecrawlTimeout: 90_000 },
    })
  })

  it('maps only the readable body, ignoring unreported target status and final URL', () => {
    const page = responsePage({ results: [{ text: 'Body', title: 'Not included', url: 'https://ignored.example/final' }], statuses: [{ status: 'success' }] })
    expect(page).toEqual({ content: 'Body', target: undefined, truncated: false })
    expect(fetchResult(page, input)).toEqual({ url: input.url, statusCode: 200, body: { kind: 'text', content: 'Body' }, truncated: false })
  })

  it('reads only the first row even when the result array exceeds service batch sizes', () => {
    const payload = { results: [{ text: 'first' }, ...Array(101).fill(null)], statuses: [{ status: 'success' }, ...Array(101).fill(null)] }
    const page = responsePage(payload)
    expect(page.content).toBe('first')
  })

  it.each([MAX_BODY_CHARS - 1, MAX_BODY_CHARS, MAX_BODY_CHARS + 1])('conservatively marks %i characters at the requested limit', length => {
    const text = 'x'.repeat(length)
    const page = responsePage({ results: [{ text }] })
    expect(page.content).toBe(text)
    expect(page.truncated).toBe(length >= MAX_BODY_CHARS)
    expect(fetchResult(page, input)).toEqual({ statusCode: 200, url: input.url, body: { kind: 'text', content: text.slice(0, MAX_BODY_CHARS) }, truncated: length >= MAX_BODY_CHARS })
  })

  it.each([404, 403, 500])('maps explicit target HTTP %i to a result', httpStatusCode => {
    const page = responsePage({ results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_HTTP_' + httpStatusCode, httpStatusCode, message: 'UPSTREAM_SECRET' } }] })
    expect(fetchResult(page, input)).toEqual({ statusCode: httpStatusCode, url: input.url, body: { kind: 'text', content: '' }, truncated: false })
  })

  it.each([
    ['CRAWL_TIMEOUT', 'timeout'], ['CRAWL_LIVECRAWL_TIMEOUT', 'timeout'],
    ['CRAWL_NOT_FOUND', 'failed'], ['SOURCE_NOT_AVAILABLE', 'failed'], ['CRAWL_UNKNOWN_ERROR', 'failed'],
  ] as const)('maps %s without guessing an HTTP code', (tag, failure) => {
    expect(responseOutcome({ results: [], statuses: [{ status: 'error', error: { tag, httpStatusCode: null, message: 'UPSTREAM_SECRET' } }] })).toEqual({ kind: 'failure', failure: failure })
  })

  it.each(['404', 99, 600, 403.5])('does not accept invalid target status %s', httpStatusCode => {
    expect(responseOutcome({ results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode } }] })).toEqual({ kind: 'failure', failure: 'failed' })
  })

  it.each([
    null, [], { results: 'UPSTREAM_SECRET' },
    { results: [], statuses: [null] },
    { results: [], statuses: [{ status: 'error', error: 'UPSTREAM_SECRET' }] },
    { results: [[[[{ text: 'UPSTREAM_SECRET' }]]]] }, { results: [{ text: Array(1000).fill('UPSTREAM_SECRET') }] },
  ])('maps hostile response shapes to an invalid page outcome', payload => {
    expect(responseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })

  it('rejects a deeply nested result without recursion', () => {
    const payload: unknown = JSON.parse('{"results":[' + '['.repeat(2000) + 'null' + ']'.repeat(2000) + ']}')
    expect(responseOutcome(payload)).toEqual({ kind: 'failure', failure: 'invalid' })
  })
})

const route = exa.keyless
if (typeof route !== 'object') throw new Error('expected the Exa MCP route')
const mcpOutcome = (result: McpToolResult) => route.parse(result, input)
const mcpPage = (result: McpToolResult) => expectPage(mcpOutcome(result))
const toolText = (text: string) => ({ content: [{ type: 'text', text }] })

describe('Exa keyless MCP request and page mapping', () => {
  it('uses the catalog MCP URL, handshake and original URL without key headers', () => {
    expect(route).toMatchObject({ url: 'https://mcp.exa.ai/mcp', tool: 'web_fetch_exa', handshake: true })
    expect(route.headers).toBeUndefined()
    expect(route.arguments(input)).toEqual({ urls: [input.url], maxCharacters: MAX_BODY_CHARS })
  })

  it('preserves the page while stripping CRLF metadata and its blank separator', () => {
    const page = mcpPage(toolText('# Title\r\nURL: https://example.com/\r\nAuthor: Author\r\n\r\n# Page heading\r\nBody'))
    expect(page.content).toBe('# Page heading\r\nBody')
  })

  it('accepts tool text exactly at its character budget and truncates only the output', () => {
    const page = mcpPage(toolText('x'.repeat(512 * 1024)))
    expect(fetchResult(page, input).body.content).toHaveLength(MAX_BODY_CHARS)
    expect(fetchResult(page, input).truncated).toBe(true)
  })

  it.each(['\n', '\r', '\u2028'])('accepts normal pages exceeding 10 000 lines with %j separators', separator => {
    const text = 'x' + separator.repeat(10_001) + 'Body'
    const page = mcpPage(toolText(text))
    expect(page.content).toBe(text)
  })

  it.each([
    { text: '# Title\nURL: https://example.com/\nPublished: Today\nAuthor: Writer\n\nBody', body: 'Body' },
    { text: 'No metadata\n\nBody', body: 'No metadata\n\nBody' },
    { text: '# Title\nURL: https://example.com/\nBody', body: '# Title\nURL: https://example.com/\nBody' },
    { text: '# ' + 'x'.repeat(8192) + '\n\nBody', body: '# ' + 'x'.repeat(8192) + '\n\nBody' },
    { text: '# Page heading\nOrdinary paragraph\n\nNext paragraph', body: '# Page heading\nOrdinary paragraph\n\nNext paragraph' },
    { text: '# Title\nURL: https://example.com/\n\n# Body heading\nBody', body: '# Body heading\nBody' },
  ])('strips only a metadata-only prefix ending at the first bounded blank line: %#', ({ text, body }) => {
    const page = mcpPage(toolText(text))
    expect(page.content).toBe(body)
  })

  it.each([MAX_BODY_CHARS - 1, MAX_BODY_CHARS, MAX_BODY_CHARS + 1])('marks truncation from the %i-character tool body', length => {
    const page = mcpPage(toolText('# Header\nURL: https://example.com/\n\n' + 'x'.repeat(length)))
    const result = fetchResult(page, input)
    expect(result.body.content).toHaveLength(Math.min(length, MAX_BODY_CHARS))
    expect(result.truncated).toBe(length >= MAX_BODY_CHARS)
  })

  it('strips the service prefix only once and preserves metadata-looking page lines', () => {
    const body = '# Actual page heading\nURL: body text, not metadata\nPublished: body text\n\nBody'
    const prefix = '# Service title\nURL: https://service.example/ignored\nPublished: 2026-10-20\nAuthor: Writer\n\n'
    const page = mcpPage(toolText(prefix + body))
    expect(page.content).toBe(body)
    expect(fetchResult(page, input)).toEqual({ statusCode: 200, url: input.url, body: { kind: 'text', content: body }, truncated: false })
  })

  it('accepts multiple bounded text blocks', () => {
    const page = mcpPage({ content: [{ type: 'text', text: 'First body' }, { type: 'text', text: 'Second body' }] })
    expect(page.content).toBe('First body\n\nSecond body')
  })

  it('recognizes metadata rate limiting instead of returning the upstream prose', () => {
    expect(mcpOutcome({ ...toolText('UPSTREAM_SECRET'), _meta: { 'ai.exa/rateLimited': true } })).toMatchObject({ kind: 'failure', failure: 'rate-limited' })
  })

  it('recognizes no-content text as empty', () => {
    expect(mcpOutcome(toolText('No content found for the provided URL(s).'))).toMatchObject({ kind: 'failure', failure: 'empty' })
  })

  it.each([
    toolText('x'.repeat(512 * 1024 + 1)),
    { content: Array.from({ length: 101 }, () => ({ type: 'text', text: 'x' })) },
    { content: Array.from({ length: 100 }, () => ({ type: 'text', text: 'x'.repeat(6000) })) },
    { content: [[[{ type: 'text', text: 'UPSTREAM_SECRET' }]]] },
    { content: [{ type: 'text', text: { value: 'UPSTREAM_SECRET' } }] },
    { content: 'UPSTREAM_SECRET' },
  ])('rejects excessive, amplified or malformed tool content before parsing', payload => {
    expect(mcpOutcome(payload)).toMatchObject({ kind: 'failure', failure: 'invalid' })
  })

  it('preserves text with leading blank lines instead of treating them as metadata', () => {
    const page = mcpPage(toolText('\n\n# Header\nURL: https://example.com/\n\n# Body heading\nPage'))
    expect(page.content).toBe('\n\n# Header\nURL: https://example.com/\n\n# Body heading\nPage')
  })
})
