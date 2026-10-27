/** AnySearch REST search and extract. The catalog offers personal keys only; there is no anonymous route here. */
import { bearer, isRecord, postJson, statusVerdict, type FailureVerdict } from '../adapter.ts'
import { bodyDetail, type FailureResponse } from '../transport.ts'
import type { FetchWire, PageFailure, PageOutcome } from './fetch.ts'
import { count, mapRows, text, type SearchOutcome, type SearchWire } from './search.ts'

/** Extract cuts HTML and plain text at this length without saying so. */
const EXTRACT_CHAR_LIMIT = 50_000

/** 402 means the quota is spent; its body is ignored (for anonymous callers it carries a generated account). */
function quotaVerdict(response: FailureResponse): FailureVerdict<never> | undefined {
  return response.status === 402 ? { kind: 'status', detail: undefined } : undefined
}

export const anysearchSearch: SearchWire = {
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), { ...input.options, query: input.query, ...count('max_results', input.maxResults, 10) })
  },
  parse(payload): SearchOutcome {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid', reason: 'not-object' }
    if (typeof payload.code !== 'number') return { kind: 'failure', failure: 'invalid', reason: 'code-number' }
    if (payload.code !== 0) return { kind: 'failure', failure: 'api', detail: bodyDetail(payload.message) }
    const rows = isRecord(payload.data) ? payload.data.results : undefined
    if (!Array.isArray(rows)) return { kind: 'failure', failure: 'invalid', reason: 'data-results-array' }
    // The snippet is the service's summary; content stands in only when it is missing.
    return mapRows(rows, row => ({ url: row.url, title: row.title, snippet: text(row.snippet) ?? row.content }))
  },
  parseFailure: response => quotaVerdict(response) ?? statusVerdict(response),
}

export const anysearchFetch: FetchWire = {
  // The body is strict: exactly one url, so no option is ever spread into it.
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), { url: input.url })
  },
  parse(payload): PageOutcome {
    if (!isRecord(payload) || typeof payload.code !== 'number') return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (payload.code !== 0) return { kind: 'failure', failure: extractFailure(payload.error_code) ?? 'failed', detail: bodyDetail(payload.message) }
    if (!isRecord(payload.data)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    const content = payload.data.content
    if (content === undefined || content === '') return { kind: 'failure', failure: 'empty', detail: undefined }
    if (typeof content !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    // AnySearch reports neither the target status nor a final URL.
    return { kind: 'page', page: { content, target: undefined, truncated: content.length >= EXTRACT_CHAR_LIMIT } }
  },
  parseFailure(response) {
    const quota = quotaVerdict(response)
    if (quota !== undefined) return quota
    // Only the documented extract statuses are classified; 401, 403, 429 and the rest keep the generic wording.
    if (response.status !== 400 && response.status !== 422) return statusVerdict(response)
    const body = isRecord(response.json) ? response.json : {}
    const failure = extractFailure(body.error_code) ?? (response.status === 422 ? 'failed' : undefined)
    if (failure === undefined) return statusVerdict(response)
    return { kind: 'outcome', outcome: { kind: 'failure', failure, detail: response.explain(body.message) } }
  },
}

/** invalid_extract_url is documented; the others come from AnySearch's own DSH plugin. extract_canceled stays 'failed': only our signal means aborted. */
function extractFailure(code: unknown): PageFailure | undefined {
  switch (code) {
    case 'invalid_extract_url': return 'invalid-url'
    case 'extract_target_blocked': return 'blocked'
    case 'extract_content_too_large': return 'too-large'
    case 'extract_unsupported_content': return 'unsupported'
    case 'extract_timeout': return 'timeout'
    default: return undefined
  }
}
