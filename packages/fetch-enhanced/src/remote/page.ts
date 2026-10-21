import { WebError, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import { MAX_BODY_CHARS, upstreamText, type Page, type PageFailure } from 'dsh-tool-web-enhanced-core/host'
import { fetchError } from './errors.ts'

/** The capability-owned error followed by the service's bounded explanation, if present. */
export function pageFailure(label: string, failure: PageFailure, detail: string | undefined): WebError {
  const error = pageError(label, failure)
  const explanation = detail === undefined ? undefined : upstreamText(detail)
  if (explanation === undefined) return error
  return new WebError(error.message + '\n\n' + label + ' responded (untrusted): ' + explanation, error.code)
}

function pageError(label: string, failure: PageFailure): WebError {
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
