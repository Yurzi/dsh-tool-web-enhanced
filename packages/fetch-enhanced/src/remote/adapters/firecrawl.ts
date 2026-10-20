import { bearer, isRecord, postJson } from 'dsh-tool-web-enhanced-core/host'
import { reportedTarget, statusPage } from '../page.ts'
import type { FetchWireFor } from '../types.ts'

export const firecrawl: FetchWireFor<'firecrawl'> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, bearer(auth), {
      ...input.options,
      url: input.url,
      formats: ['markdown'],
    })
  },
  parse(payload, input) {
    if (!isRecord(payload) || typeof payload.success !== 'boolean') return { kind: 'failure', failure: 'invalid' }
    if (!payload.success) return { kind: 'failure', failure: 'failed' }
    if (!isRecord(payload.data)) return { kind: 'failure', failure: 'invalid' }
    const data = payload.data
    const metadata = isRecord(data.metadata) ? data.metadata : {}
    const target = reportedTarget(metadata.statusCode, metadata.url, input.url)
    const content = data.markdown
    if (content === undefined || content === '') {
      // A reported target refusal is still a fetch result, even without a body.
      if (target !== undefined && (target.statusCode < 200 || target.statusCode >= 300)) {
        return { kind: 'page', page: statusPage(target) }
      }
      return { kind: 'failure', failure: 'empty' }
    }
    if (typeof content !== 'string') return { kind: 'failure', failure: 'invalid' }
    return { kind: 'page', page: { content, target, truncated: false } }
  },
  keyless: 'rest',
}
