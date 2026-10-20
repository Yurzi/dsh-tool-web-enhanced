/** Semantic Scholar paper search; requires a personal API key. */
import { invalidResponse } from '../http.ts'
import { authors, collect, firstSourceUrl, isRecord, summary, text } from '../sources.ts'
import { apiKeyHeader, envelope, getJson, type AdapterFor } from './types.ts'

const FIELDS = 'title,url,abstract,tldr,authors,year,publicationDate,citationCount,openAccessPdf,externalIds'

export const semanticscholar: AdapterFor<'semanticscholar'> = {
  request(input, endpoint, auth) {
    const url = new URL(endpoint)
    url.searchParams.set('query', input.query)
    if (input.maxResults !== undefined) url.searchParams.set('limit', String(Math.min(input.maxResults, 100)))
    url.searchParams.set('fields', FIELDS)
    for (const [key, value] of Object.entries(input.options)) url.searchParams.set(key, String(value))
    return getJson(url, apiKeyHeader(auth))
  },
  parse(payload) {
    const root = envelope(payload)
    // An empty result omits `data` and reports `total: 0`.
    const rows = root.data ?? (root.total === 0 ? [] : undefined)
    if (!Array.isArray(rows)) throw invalidResponse('no "data" array')
    return collect(rows, row => {
      const pdf = isRecord(row.openAccessPdf) ? text(row.openAccessPdf.url) : undefined
      const paperId = text(row.paperId)
      const url = firstSourceUrl([row.url, pdf, paperId === undefined ? undefined : `https://www.semanticscholar.org/paper/${paperId}`])
      const tldr = isRecord(row.tldr) ? text(row.tldr.text) : undefined
      return {
        url,
        title: row.title,
        snippet: row.snippet ?? summary([
          tldr === undefined ? undefined : `[TL;DR: ${tldr}]`,
          typeof row.citationCount === 'number' ? `[Citations: ${row.citationCount}]` : undefined,
          authors(row.authors, item => item.name),
          pdf !== undefined && pdf !== url ? `[OA PDF: ${pdf}]` : undefined,
          text(row.abstract),
        ]),
        publishedAt: row.publicationDate ?? (typeof row.year === 'number' ? `${row.year}-01-01` : undefined),
      }
    })
  },
}
