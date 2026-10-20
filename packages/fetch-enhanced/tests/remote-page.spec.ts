import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { fetchResult, MAX_BODY_CHARS, pageFailure, reportedTarget, statusPage, type Page } from '../src/remote/page.ts'

const request = { url: 'https://example.com/a' }
const page = (content: string, overrides: Partial<Page> = {}): Page => ({ content, target: undefined, truncated: false, ...overrides })

describe('remote page mapping', () => {
  it('reports a compatible 200 for the requested URL when the service gives no target response', () => {
    expect(fetchResult(page('# Title'), request)).toEqual({ url: request.url, statusCode: 200, body: { kind: 'text', content: '# Title' }, truncated: false })
  })

  it('keeps a reported target status and final URL, including non-2xx pages', () => {
    const target = reportedTarget(404, 'https://example.com/b', request.url)
    expect(fetchResult(page('Not found', { target }), request)).toMatchObject({ url: 'https://example.com/b', statusCode: 404 })
  })

  it('ignores an implausible status and an unusable final URL', () => {
    expect(reportedTarget('200', 'https://example.com/b', request.url)).toBeUndefined()
    expect(reportedTarget(1000, 'https://example.com/b', request.url)).toBeUndefined()
    expect(reportedTarget(200, 'https://user:secret@example.com/b', request.url)).toEqual({ statusCode: 200, url: request.url })
    expect(reportedTarget(200, 'file:///etc/passwd', request.url)).toEqual({ statusCode: 200, url: request.url })
  })

  it('caps the body itself and marks the result truncated', () => {
    const result = fetchResult(page('x'.repeat(MAX_BODY_CHARS + 1)), request)
    expect(result.body.content).toHaveLength(MAX_BODY_CHARS)
    expect(result.truncated).toBe(true)
  })

  it('does not split a surrogate pair at the cap', () => {
    const content = 'x'.repeat(MAX_BODY_CHARS - 1) + '😀tail'
    const result = fetchResult(page(content), request)
    expect(result.body.content).toBe('x'.repeat(MAX_BODY_CHARS - 1))
    expect(result.truncated).toBe(true)
  })

  it('keeps the service truncation flag and always returns text', () => {
    expect(fetchResult(page('service text', { truncated: true }), request))
      .toMatchObject({ body: { kind: 'text', content: 'service text' }, truncated: true })
  })

  it('maps a reported target status without content to an empty result, not an error', () => {
    expect(fetchResult(statusPage({ statusCode: 404, url: request.url }), request)).toEqual({ url: request.url, statusCode: 404, body: { kind: 'text', content: '' }, truncated: false })
  })

  it.each([
    ['timeout', 'WEB_FETCH_TIMEOUT'], ['too-large', 'WEB_FETCH_TOO_LARGE'], ['invalid-url', 'WEB_INVALID_URL'],
    ['empty', 'WEB_PROVIDER_ERROR'], ['rate-limited', 'WEB_PROVIDER_ERROR'], ['failed', 'WEB_PROVIDER_ERROR'], ['invalid', 'WEB_PROVIDER_ERROR'],
  ] as const)('reports a %s page failure with %s and the plugin prefix', (failure, code) => {
    const error = pageFailure('Exa', failure)
    expect(error).toBeInstanceOf(WebError)
    expect(error.code).toBe(code)
    expect(error.message).toMatch(/^dsh-web-fetch-enhanced: /u)
  })
})
