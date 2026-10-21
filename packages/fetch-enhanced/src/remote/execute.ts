import { WebError, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import { adapterTarget, redactDiagnostic, runAdapter, secretMatcher, type OnDiagnostic } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG } from '../catalog.ts'
import type { AdapterConnection } from '../settings/types.ts'
import { ADAPTER_WIRES } from './adapters/index.ts'
import { fetchError, fetchErrors } from './errors.ts'
import { mcp, transport } from './http.ts'
import { fetchResult, pageFailure } from './page.ts'

export interface RemoteDeps {
  credential(ref: string): Promise<string | undefined>
  readonly onDiagnostic?: OnDiagnostic
}

export function createRemoteBackend(connection: AdapterConnection, deps: RemoteDeps): WebFetchProvider {
  const target = adapterTarget(connection, CATALOG[connection.adapter].endpoint)
  return {
    id: connection.id,
    available: () => true,
    async fetch(request, signal) {
      fetchErrors.throwIfAborted(signal)
      try {
        const outcome = await runAdapter({
          errors: fetchErrors, transport, mcp,
          credential: ref => deps.credential(ref),
          onDiagnostic: deps.onDiagnostic,
          credentialMissing: ref => 'no API key is stored for ' + ref + '; ask the user to add it in fetch connection settings (DSH Credentials) or choose another connection',
          credentialInvalid: ref => 'the API key stored for ' + ref + ' is malformed (it contains a line break or another control character); ask the user to re-enter it in fetch connection settings (DSH Credentials)',
        }, ADAPTER_WIRES[connection.adapter], target, { url: request.url, options: connection.options }, signal)
        if (outcome.kind === 'failure') throw pageFailure(connection.label, outcome.failure, outcome.detail)
        return fetchResult(outcome.page, request)
      } catch (error) {
        if (!(error instanceof WebError) && deps.onDiagnostic !== undefined) deps.onDiagnostic(redactDiagnostic(error, secretMatcher([])))
        fetchErrors.throwIfAborted(signal)
        if (error instanceof WebError) throw error
        throw fetchError('WEB_PROVIDER_ERROR', 'fetch failed; check the connection settings or choose another connection')
      }
    },
  }
}
