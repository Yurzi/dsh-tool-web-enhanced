/**
 * The multi-query part of `web_search`, copied from `@deepseek-ai/dsh-tool-web`
 * 0.2.1-rc.2 (packages/web/tool-web/src/search.ts: `parseSearchArgs`,
 * `runSearchQueries`, `mergeSearchResults`, `projectSource`) and
 * `@deepseek-ai/dsh-web` (packages/web/web/src/index.ts: `capSources`), which do
 * not export them. The enhanced tool bypasses `ctx.web`, so it applies the
 * seam's `capSources` itself. Keep in step with DSH on baseline upgrades;
 * tests/tools-search.spec.ts compares the result with the real tool-web.
 */
import { WEB_SEARCH_MAX_QUERIES, WEB_SEARCH_MAX_RESULTS } from '@deepseek-ai/dsh-tool-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { invalidArguments } from 'dsh-tool-web-enhanced-core/host'

/** tool-web's `parseSearchArgs`: 1–4 non-blank queries, exact duplicates collapsed after the bound check. */
export function parseQueries(queries: readonly string[]): string[] {
  if (queries.length === 0) throw invalidArguments('queries must contain at least one query')
  if (queries.length > WEB_SEARCH_MAX_QUERIES) throw invalidArguments(`queries must contain at most ${WEB_SEARCH_MAX_QUERIES} queries`)
  if (queries.some(query => query.trim().length === 0)) throw invalidArguments('each query must be a non-empty string')
  return [...new Set(queries)]
}

/** Run one search; the signal aborts it when a sibling query fails. */
export type RunQuery = (request: WebSearchRequest, signal: AbortSignal) => Promise<WebSearchResult>

/**
 * tool-web's `runSearchQueries`: one query keeps its (capped) result; several
 * run concurrently and merge. A failed search aborts its siblings, and the
 * first failure is rethrown once every search has settled.
 */
export async function searchQueries(queries: readonly string[], run: RunQuery, signal: AbortSignal): Promise<WebSearchResult> {
  const search = async (query: string, querySignal: AbortSignal) =>
    capSources(await run({ query, maxResults: WEB_SEARCH_MAX_RESULTS }, querySignal), WEB_SEARCH_MAX_RESULTS)
  const [only] = queries
  if (queries.length === 1 && only !== undefined) return search(only, signal)
  const controller = new AbortController()
  const batchSignal = AbortSignal.any([signal, controller.signal])
  let firstFailure: { error: unknown } | undefined
  const results: WebSearchResult[] = []
  const searches = queries.map(async (query, index) => {
    try {
      results[index] = await search(query, batchSignal)
    } catch (error) {
      if (firstFailure === undefined) firstFailure = { error }
      controller.abort(error)
      throw error
    }
  })
  await Promise.allSettled(searches)
  if (firstFailure !== undefined) throw firstFailure.error
  return mergeSearchResults(queries, results, WEB_SEARCH_MAX_RESULTS)
}

/** tool-web's `mergeSearchResults`: round-robin by rank, deduplicated by URL, capped; answers joined under `### <query>`. */
function mergeSearchResults(queries: readonly string[], results: readonly WebSearchResult[], maxResults: number): WebSearchResult {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  let sourceRanks = 0
  for (const result of results) {
    sourceRanks = Math.max(sourceRanks, result.sources.length)
  }
  let droppedSource = false
  merge: for (let rank = 0; rank < sourceRanks; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source !== undefined && !seen.has(source.url)) {
        seen.add(source.url)
        if (sources.length === maxResults) {
          droppedSource = true
          break merge
        }
        sources.push(source)
      }
    }
  }
  const contents = results.flatMap((result, index) => {
    if (result.content === undefined || result.content.length === 0) return []
    return [`### ${queries[index]}\n\n${result.content}`]
  })
  return {
    ...contents.length > 0 ? { content: contents.join('\n\n') } : {},
    sources,
    truncated: results.some(result => result.truncated) || droppedSource,
  }
}

/** dsh-web's `capSources`: the seam's cut of an over-returning provider. */
function capSources(result: WebSearchResult, maxResults: number): WebSearchResult {
  if (result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

/** tool-web's `projectSource`: `{ url }` plus each present optional field. */
export function projectSource(source: WebSearchSource): { url: string; title?: string; snippet?: string; publishedAt?: string } {
  return {
    url: source.url,
    ...source.title !== undefined ? { title: source.title } : {},
    ...source.snippet !== undefined ? { snippet: source.snippet } : {},
    ...source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {},
  }
}
