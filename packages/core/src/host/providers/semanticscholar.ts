/** Semantic Scholar paper search and scholarly candidate field mapping. */
import { apiKeyHeader, getJson, isRecord } from '../adapter.ts'
import { authors, envelope, firstSourceUrl, mapRows, summary, text, type SearchWire } from './search.ts'

const FIELDS = 'title,url,abstract,tldr,authors,year,publicationDate,citationCount,openAccessPdf,externalIds'

export const semanticscholarSearch: SearchWire = {
  request(input, endpoint, auth) {
    const query: Record<string, string> = { query: input.query }
    if (input.maxResults !== undefined) query.limit = String(Math.min(input.maxResults, 100))
    query.fields = FIELDS
    for (const [key, value] of Object.entries(input.options)) query[key] = String(value)
    return getJson(endpoint, query, apiKeyHeader(auth))
  },
  parse(payload) {
    const decoded = envelope(payload)
    if (decoded.kind === 'failure') return decoded
    const root = decoded.value
    // An empty result omits `data` and reports `total: 0`.
    const rows = root.data ?? (root.total === 0 ? [] : undefined)
    if (!Array.isArray(rows)) return { kind: 'failure', failure: 'invalid', reason: 'data-array' }
    return mapRows(rows, row => {
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
