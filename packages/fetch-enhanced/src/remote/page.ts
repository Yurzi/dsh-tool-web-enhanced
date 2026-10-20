import type { WebError, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { sourceUrl } from 'dsh-tool-web-enhanced-core/shared'
import { fetchError } from './errors.ts'

/** Body characters returned to tool-web, and the budget requested from services that take one; equals the native `maxBodyChars` default. */
export const MAX_BODY_CHARS = 100_000

/** The target's response as the service reports it. */
export interface ReportedTarget {
  readonly statusCode: number
  readonly url: string
}

/** What a remote service retrieved, before the plugin's own bounds. */
export interface Page {
  readonly content: string
  /** Present only when the service reports the target's status code. */
  readonly target: ReportedTarget | undefined
  /** The service reports, or its budget implies, that it cut the content. */
  readonly truncated: boolean
}

/**
 * The reported target when the service gives a plausible HTTP status; a
 * missing or unusable final URL falls back to the requested one.
 */
export function reportedTarget(statusCode: unknown, url: unknown, requested: string): ReportedTarget | undefined {
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) return undefined
  return { statusCode, url: sourceUrl(url)?.raw ?? requested }
}

/**
 * A URL the service could not read but whose HTTP status it reports (a target
 * 404 or 403): that is a fetch result, not an error, as in DSH's own fetch.
 */
export function statusPage(target: ReportedTarget): Page {
  return { content: '', target, truncated: false }
}

/** Why a service could not read a page, in the plugin's shared vocabulary. */
export type PageFailure = 'timeout' | 'too-large' | 'invalid-url' | 'empty' | 'rate-limited' | 'failed' | 'invalid'

export type PageOutcome =
  | { readonly kind: 'page'; readonly page: Page }
  | { readonly kind: 'failure'; readonly failure: PageFailure }

/** The model-facing error for a page the service could not read; never carries the service's own wording. */
export function pageFailure(label: string, failure: PageFailure): WebError {
  switch (failure) {
    case 'invalid': return fetchError('WEB_PROVIDER_ERROR', label + ' returned an invalid fetch response; choose another connection or report the incompatible response')
    case 'timeout': return fetchError('WEB_FETCH_TIMEOUT', label + ' timed out reading the page; retry later or choose another fetch connection')
    case 'too-large': return fetchError('WEB_FETCH_TOO_LARGE', 'the page is too large for ' + label + '; fetch a more specific URL')
    case 'invalid-url': return fetchError('WEB_INVALID_URL', label + ' refused the URL as invalid or not allowed; check the URL')
    case 'empty': return fetchError('WEB_PROVIDER_ERROR', label + ' found no readable content at the URL; try another URL or fetch connection')
    case 'rate-limited': return fetchError('WEB_PROVIDER_ERROR', label + ' is rate limiting anonymous requests; retry later or ask the user to add a personal API key in fetch connection settings')
    case 'failed': return fetchError('WEB_PROVIDER_ERROR', label + ' could not read the page; retry later or choose another fetch connection')
  }
}

export function fetchResult(page: Page, request: WebFetchRequest): WebFetchResult {
  const { content } = page
  const cut = content.length > MAX_BODY_CHARS
  const bounded = cut ? content.slice(0, boundary(content, MAX_BODY_CHARS)) : content
  // Compatibility mapping, as DSH's DeepSeek Fetch API provider does: 200 means
  // the service retrieved the page, not that this plugin saw the target answer 200.
  const target = page.target ?? { statusCode: 200, url: request.url }
  return { url: target.url, statusCode: target.statusCode, body: { kind: 'text', content: bounded }, truncated: page.truncated || cut }
}

/** Never split a surrogate pair at the cut. */
function boundary(content: string, limit: number): number {
  const last = content.charCodeAt(limit - 1)
  return last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit
}
