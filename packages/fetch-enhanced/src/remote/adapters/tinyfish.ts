import { apiKeyHeader, isRecord, postJson } from 'dsh-tool-web-enhanced-core/host'
import { reportedTarget, statusPage, type PageFailure } from '../page.ts'
import type { FetchWireFor } from '../types.ts'

export const tinyfish: FetchWireFor<'tinyfish'> = {
  request(input, endpoint, auth) {
    return postJson(endpoint, apiKeyHeader(auth), {
      ...input.options,
      urls: [input.url],
      format: 'markdown',
    })
  },
  parse(payload, input) {
    if (!isRecord(payload)) return { kind: 'failure', failure: 'invalid' }
    if (payload.errors !== undefined) {
      if (!Array.isArray(payload.errors)) return { kind: 'failure', failure: 'invalid' }
      if (payload.errors.length > 0) {
        const error: unknown = payload.errors[0]
        if (!isRecord(error)) return { kind: 'failure', failure: 'invalid' }
        const target = reportedTarget(error.status, input.url, input.url)
        if (target !== undefined) return { kind: 'page', page: statusPage(target) }
        return { kind: 'failure', failure: failure(error.error) }
      }
    }
    if (!Array.isArray(payload.results)) return { kind: 'failure', failure: 'invalid' }
    if (payload.results.length === 0) return { kind: 'failure', failure: 'empty' }
    const row: unknown = payload.results[0]
    if (!isRecord(row)) return { kind: 'failure', failure: 'invalid' }
    if (row.text === undefined || row.text === '') return { kind: 'failure', failure: 'empty' }
    if (typeof row.text !== 'string') return { kind: 'failure', failure: 'invalid' }
    // A successful fetch supplies a final URL but no target status: 200 is synthetic.
    return { kind: 'page', page: { content: row.text, target: reportedTarget(200, row.final_url, input.url), truncated: false } }
  },
}

function failure(error: unknown): PageFailure {
  switch (error) {
    case 'timeout': return 'timeout'
    case 'content_too_large': return 'too-large'
    case 'invalid_url':
    case 'invalid_redirect_url': return 'invalid-url'
    case 'empty_content': return 'empty'
    default: return 'failed'
  }
}
