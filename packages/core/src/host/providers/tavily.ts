/** Tavily search and extraction protocols with anonymous access-mode headers. */
import { bearer, isRecord, postJson, type Auth, type KeylessWire } from '../adapter.ts'
import type { FetchWire } from './fetch.ts'
import { count, mapRows, rowsAt, type SearchWire } from './search.ts'

function tavilyHeaders(auth: Auth): Record<string, string> {
  return auth.kind === 'keyless' ? { 'x-tavily-access-mode': 'keyless' } : bearer(auth)
}

export const tavilySearch: KeylessWire<SearchWire> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, tavilyHeaders(auth), {
      ...input.options,
      query: input.query,
      ...count('max_results', input.maxResults, 20),
      include_answer: false,
      include_raw_content: false,
    })
  },
  // `published_date` is an estimated publish-or-update date, so it is not reported.
  parse(payload) {
    const rows = rowsAt(payload, 'results')
    if (rows.kind === 'failure') return rows
    return mapRows(rows.rows, row => ({ url: row.url, title: row.title, snippet: row.content }))
  },
  keyless: 'rest',
}

export const tavilyFetch: KeylessWire<FetchWire> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, tavilyHeaders(auth), {
      ...input.options,
      urls: [input.url],
      include_images: false,
    })
  },
  parse(payload) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    const failures = payload.failed_results
    if (failures !== undefined) {
      if (!Array.isArray(failures)) return { kind: 'failure', failure: 'invalid', detail: undefined }
      if (failures.length !== 0) {
        const first: unknown = failures[0]
        const detail = isRecord(first) && typeof first.error === 'string' ? first.error : undefined
        return { kind: 'failure', failure: 'failed', detail }
      }
    }
    const results = payload.results
    if (!Array.isArray(results)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (results.length === 0) return { kind: 'failure', failure: 'failed', detail: undefined }
    const row: unknown = results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    const content = row.raw_content
    if (content === undefined || content === '') return { kind: 'failure', failure: 'empty', detail: undefined }
    if (typeof content !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    // Tavily does not report the target status or a documented final URL.
    return { kind: 'page', page: { content, target: undefined, truncated: false } }
  },
  keyless: 'rest',
}
