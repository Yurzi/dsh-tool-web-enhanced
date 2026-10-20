/** Firecrawl v2 search; anonymous access uses the same REST endpoint. */
import { invalidResponse } from '../http.ts'
import { collect, isRecord } from '../sources.ts'
import { bearer, count, envelope, postJson, type AdapterFor } from './types.ts'

const DAY_MS = 86_400_000

export const firecrawl: AdapterFor<'firecrawl'> = {
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
    const root = envelope(payload)
    const rows = isRecord(root.data) ? root.data.web : undefined
    if (root.success !== true || !Array.isArray(rows)) throw invalidResponse('no "data.web" array')
    return collect(rows, row => ({
      url: row.url,
      title: row.title,
      // A missing scrape stays missing: an old SERP description is never presented as fresh content.
      snippet: input.freshness === 'auto' ? row.description : row.markdown,
    }))
  },
  keyless: 'rest',
}
