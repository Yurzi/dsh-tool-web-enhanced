import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { upstreamText, type SearchInvalidReason, type SearchOutcome } from 'dsh-tool-web-enhanced-core/host'
import { searchError } from './errors.ts'
import { invalidResponse } from './http.ts'
import { SourceList } from './sources.ts'

/** What the search service returned, in the model-facing invalid-response message. */
const INVALID_DETAIL: Readonly<Record<SearchInvalidReason, string>> = {
  'not-object': 'a body that is not a JSON object',
  'results-array': 'no "results" array',
  'data-array': 'no "data" array',
  'data-web-array': 'no "data.web" array',
  'exa-tool': 'an unrecognized Exa tool result',
  'exa-tool-size': 'excessive Exa tool text',
  'exa-tool-lines': 'excessive Exa tool text lines',
  'tinyfish-tool': 'an unrecognized Tinyfish tool result',
}

/** Normalized sources of a provider outcome, or the search plugin's wording of its failure. */
export function searchSources(outcome: SearchOutcome): WebSearchSource[] {
  if (outcome.kind === 'rows') {
    const list = new SourceList()
    for (const row of outcome.rows) list.add(row)
    return list.sources
  }
  if (outcome.failure === 'api') {
    const detail = outcome.detail === undefined ? undefined : upstreamText(outcome.detail)
    const message = 'the search service reported an API error; retry later or choose another search connection'
    throw searchError('WEB_PROVIDER_ERROR', detail === undefined ? message : message + '\n\nThe search service responded (untrusted): ' + detail)
  }
  throw invalidResponse(INVALID_DETAIL[outcome.reason])
}
