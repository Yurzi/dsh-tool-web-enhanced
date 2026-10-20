import { bearer, isRecord, postJson } from 'dsh-tool-web-enhanced-core/host'
import type { FetchWireFor } from '../types.ts'

export const tavily: FetchWireFor<'tavily'> = {
  request(input, endpoint, auth) {
    const headers = auth.kind === 'keyless'
      ? { 'x-tavily-access-mode': 'keyless' }
      : bearer(auth)
    return postJson(endpoint, headers, {
      ...input.options,
      urls: [input.url],
      include_images: false,
    })
  },
  parse(payload) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid' }
    const failures = payload.failed_results
    if (failures !== undefined) {
      if (!Array.isArray(failures)) return { kind: 'failure', failure: 'invalid' }
      if (failures.length !== 0) return { kind: 'failure', failure: 'failed' }
    }
    const results = payload.results
    if (!Array.isArray(results)) return { kind: 'failure', failure: 'invalid' }
    if (results.length === 0) return { kind: 'failure', failure: 'failed' }
    const row: unknown = results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid' }
    const content = row.raw_content
    if (content === undefined || content === '') return { kind: 'failure', failure: 'empty' }
    if (typeof content !== 'string') return { kind: 'failure', failure: 'invalid' }
    // Tavily does not report the target status or a documented final URL.
    return { kind: 'page', page: { content, target: undefined, truncated: false } }
  },
  keyless: 'rest',
}
