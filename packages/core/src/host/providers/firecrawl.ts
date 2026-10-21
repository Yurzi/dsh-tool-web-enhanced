/** Firecrawl search and scrape protocols, including their distinct success envelopes. */
import { bearer, isRecord, postJson, type KeylessWire } from '../adapter.ts'
import { reportedTarget, statusPage, type FetchWire } from './fetch.ts'
import { count, envelope, mapRows, type SearchWire } from './search.ts'

const DAY_MS = 86_400_000

export const firecrawlSearch: KeylessWire<SearchWire> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), {
      ...input.options,
      query: input.query,
      sources: [{ type: 'web' }],
      ...count('limit', input.maxResults, 100),
      ...(input.freshness === 'auto' ? {} : { scrapeOptions: { formats: [{ type: 'markdown' }], maxAge: input.freshness === 'fresh' ? DAY_MS : 0 } }),
    })
  },
  parse(payload, input) {
    const decoded = envelope(payload)
    if (decoded.kind === 'failure') return decoded
    const root = decoded.value
    const rows = isRecord(root.data) ? root.data.web : undefined
    if (root.success !== true || !Array.isArray(rows)) return { kind: 'failure', failure: 'invalid', reason: 'data-web-array' }
    return mapRows(rows, row => ({
      url: row.url,
      title: row.title,
      // A missing scrape stays missing: an old SERP description is never presented as fresh content.
      snippet: input.freshness === 'auto' ? row.description : row.markdown,
    }))
  },
  keyless: 'rest',
}

export const firecrawlFetch: KeylessWire<FetchWire> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), {
      ...input.options,
      url: input.url,
      formats: ['markdown'],
    })
  },
  parse(payload, input) {
    if (!isRecord(payload) || typeof payload.success !== 'boolean') return { kind: 'failure', failure: 'invalid', detail: undefined }
    if (!payload.success) return { kind: 'failure', failure: 'failed', detail: typeof payload.error === 'string' ? payload.error : undefined }
    if (!isRecord(payload.data)) return { kind: 'failure', failure: 'invalid', detail: undefined }
    const data = payload.data
    const metadata = isRecord(data.metadata) ? data.metadata : {}
    const target = reportedTarget(metadata.statusCode, metadata.url, input.url)
    const content = data.markdown
    if (content === undefined || content === '') {
      // A reported target refusal is still a fetch result, even without a body.
      if (target !== undefined && (target.statusCode < 200 || target.statusCode >= 300)) {
        return { kind: 'page', page: statusPage(target) }
      }
      return { kind: 'failure', failure: 'empty', detail: undefined }
    }
    if (typeof content !== 'string') return { kind: 'failure', failure: 'invalid', detail: undefined }
    return { kind: 'page', page: { content, target, truncated: false } }
  },
  keyless: 'rest',
}
