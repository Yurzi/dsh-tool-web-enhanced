import { createMcpClient, createTransport } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { fetchErrors } from './errors.ts'

export const MAX_RESPONSE_BYTES = 5_000_000
export const TIMEOUT_MS = 120_000

export const transport = createTransport(fetchErrors, {
  timeoutMs: TIMEOUT_MS,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  messages: {
    timedOut: `fetch timed out after ${TIMEOUT_MS / 1000} s; retry later or choose another fetch connection`,
    unreachable: label => label + ' could not be reached (network failure or refused redirect); retry later or choose another fetch connection',
    invalidResponse: detail => 'the fetch service returned ' + detail + '; choose another fetch connection or report the incompatible response',
    tooLarge: `the fetch response exceeds ${MAX_RESPONSE_BYTES / 1_000_000} MB; fetch a more specific URL or choose another connection`,
    brokenResponse: 'the fetch response broke off while it was read; retry later or choose another connection',
  },
})

export const mcp = createMcpClient(transport, fetchErrors, {
  clientInfo: { name: FETCH.packageName, version: __PLUGIN_VERSION__ },
  messages: {
    toolFailed: label => label + ' could not read the page; retry later or choose another fetch connection',
    serverError: 'the MCP fetch server returned an error; retry later or choose another fetch connection',
  },
})
