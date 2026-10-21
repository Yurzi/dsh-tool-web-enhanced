/** OpenAlex works search, scholarly field mapping and bounded inverted abstracts. */
import { getJson, isRecord, type KeylessWire } from '../adapter.ts'
import { authors, firstSourceUrl, mapRows, MAX_SNIPPET_LENGTH, rowsAt, summary, text, type SearchWire } from './search.ts'

/** OpenAlex asks anonymous clients to identify themselves for the polite pool. */
const DEFAULT_MAILTO = 'dsh-web-search@users.noreply.github.com'

export const openalexSearch: KeylessWire<SearchWire> = {
  request(input, endpoint, auth) {
    const { filter, is_oa: openAccess, mailto, sort } = input.options
    const query: Record<string, string> = { search: input.query }
    if (input.maxResults !== undefined) query['per-page'] = String(Math.min(input.maxResults, 100))
    query.mailto = typeof mailto === 'string' ? mailto : DEFAULT_MAILTO
    if (auth.kind === 'api-key') query.api_key = auth.key
    const filters = [text(filter), typeof openAccess === 'boolean' ? `is_oa:${openAccess}` : undefined].filter(value => value !== undefined)
    if (filters.length > 0) query.filter = filters.join(',')
    if (typeof sort === 'string') query.sort = sort
    return getJson(endpoint, query)
  },
  parse(payload) {
    const rows = rowsAt(payload, 'results')
    if (rows.kind === 'failure') return rows
    return mapRows(rows.rows, row => {
      const openAccessUrl = isRecord(row.open_access) ? text(row.open_access.oa_url) : undefined
      const landingPage = isRecord(row.primary_location) ? text(row.primary_location.landing_page_url) : undefined
      const url = firstSourceUrl([row.url, row.doi, openAccessUrl, landingPage, row.id])
      return {
        url,
        title: row.title ?? row.display_name,
        snippet: row.snippet ?? summary([
          typeof row.cited_by_count === 'number' ? `[Citations: ${row.cited_by_count}]` : undefined,
          authors(row.authorships, item => isRecord(item.author) ? item.author.display_name : undefined),
          openAccessUrl !== undefined && openAccessUrl !== url ? `[OA PDF: ${openAccessUrl}]` : undefined,
          invertedAbstract(row.abstract_inverted_index) ?? text(row.description),
        ]),
        publishedAt: row.publication_date ?? (typeof row.publication_year === 'number' ? `${row.publication_year}-01-01` : undefined),
      }
    })
  },
  keyless: 'rest',
}

/** Rebuild abstract text from OpenAlex's `{ word: [positions] }` index. */
function invertedAbstract(index: unknown): string | undefined {
  if (!isRecord(index)) return undefined
  const words = new Map<number, string>()
  let entryCount = 0
  let positionCount = 0
  for (const word in index) {
    if (!Object.hasOwn(index, word)) continue
    // Invalid/duplicate positions and empty entries also consume the work budget.
    if (entryCount++ >= MAX_SNIPPET_LENGTH || positionCount >= MAX_SNIPPET_LENGTH) break
    const positions = index[word]
    if (word.length === 0 || !Array.isArray(positions)) continue
    for (let offset = 0; offset < positions.length && positionCount < MAX_SNIPPET_LENGTH; offset++) {
      positionCount++
      const position: unknown = positions[offset]
      if (typeof position !== 'number' || !Number.isSafeInteger(position) || position < 0 || position >= MAX_SNIPPET_LENGTH) continue
      if (!words.has(position)) words.set(position, word)
    }
  }
  if (words.size === 0) return undefined
  const parts: string[] = []
  let remaining = MAX_SNIPPET_LENGTH
  for (const [, word] of [...words].toSorted((left, right) => left[0] - right[0])) {
    const separatorLength = parts.length === 0 ? 0 : 1
    if (remaining <= separatorLength) break
    const part = word.slice(0, remaining - separatorLength)
    parts.push(part)
    remaining -= part.length + separatorLength
  }
  return parts.join(' ')
}
