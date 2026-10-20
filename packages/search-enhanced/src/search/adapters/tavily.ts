/** Tavily search; anonymous access is the same endpoint with an access-mode header. */
import { collect } from '../sources.ts'
import { bearer, postJson } from 'dsh-tool-web-enhanced-core/host'
import { count, rowsAt, type AdapterFor } from './types.ts'

export const tavily: AdapterFor<'tavily'> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, { ...bearer(auth), ...(auth.kind === 'keyless' ? { 'x-tavily-access-mode': 'keyless' } : {}) }, {
      ...input.options,
      query: input.query,
      ...count('max_results', input.maxResults, 20),
      include_answer: false,
      include_raw_content: false,
    })
  },
  // `published_date` is an estimated publish-or-update date, so it is not reported.
  parse: payload => collect(rowsAt(payload, 'results'), row => ({ url: row.url, title: row.title, snippet: row.content })),
  keyless: 'rest',
}
