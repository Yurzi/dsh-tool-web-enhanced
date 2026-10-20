import { createTransport } from 'dsh-tool-web-enhanced-core/host'
import { searchErrors } from './errors.ts'

export type { HttpRequest, Upstream } from 'dsh-tool-web-enhanced-core/host'

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const TIMEOUT_MS = 90_000

export const { withDeadline, send, discard, readText, readJson, requestJson, invalidResponse } = createTransport(searchErrors, {
  timeoutMs: TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  messages: {
    timedOut: 'search timed out after 90 s; retry later or choose another search connection',
    unreachable: label => label + ' could not be reached (network failure or refused redirect); retry later or choose another search connection',
    invalidResponse: detail => 'the search service returned ' + detail + '; choose another connection or report the incompatible response',
    tooLarge: 'the search response exceeds 2 MiB; narrow the query or choose another connection',
    brokenResponse: 'the search response broke off while it was read; retry later or choose another connection',
  },
})
