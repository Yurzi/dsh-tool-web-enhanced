import { createMcpClient, createTransport, upstreamSuffix } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { searchErrors } from './errors.ts'

export type { HttpRequest, Upstream } from 'dsh-tool-web-enhanced-core/host'

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const TIMEOUT_MS = 90_000

export const transport = createTransport(searchErrors, {
  timeoutMs: TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  messages: {
    timedOut: `search timed out after ${TIMEOUT_MS / 1000} s; retry later or choose another search connection`,
    unreachable: label => label + ' could not be reached (network failure or refused redirect); retry later or choose another search connection',
    invalidResponse: detail => 'the search service returned ' + detail + '; choose another search connection or report the incompatible response',
    tooLarge: `the search response exceeds ${MAX_RESPONSE_BYTES / (1024 * 1024)} MiB; narrow the query or choose another connection`,
    brokenResponse: 'the search response broke off while it was read; retry later or choose another connection',
  },
})

export const { withDeadline, readJson, requestJson, invalidResponse } = transport

export const mcp = createMcpClient(transport, searchErrors, {
  clientInfo: { name: SEARCH.packageName, version: __PLUGIN_VERSION__ },
  messages: {
    toolFailed: (label, detail) => label + ' could not complete the search; retry later or choose another search connection' + upstreamSuffix(label, detail),
    serverError: (label, detail) => 'the MCP search server returned an error; retry later or choose another search connection' + upstreamSuffix(label, detail),
  },
})
