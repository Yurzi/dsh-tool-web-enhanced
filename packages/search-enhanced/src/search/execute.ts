import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import { CATALOG, honorsFreshness, type Freshness } from '../catalog.ts'
import type { AdapterConnection } from '../settings/resolve.ts'
import { ADAPTER_WIRES, type SearchInput } from './adapters/index.ts'
import { adapterTarget, runAdapter } from 'dsh-tool-web-enhanced-core/host'
import { searchErrors, searchError, throwIfAborted, type OnDiagnostic } from './errors.ts'
import { mcp, transport } from './http.ts'
import { normalizeResult } from './sources.ts'

export type SearchTarget =
  | { readonly kind: 'adapter'; readonly connection: AdapterConnection; readonly freshness: Freshness }
  | { readonly kind: 'native'; readonly provider: WebSearchProvider }

export interface SearchDeps {
  credential(ref: string): Promise<string | undefined>
  readonly onDiagnostic?: OnDiagnostic
}

export async function executeSearch(target: SearchTarget, request: WebSearchRequest, deps: SearchDeps, signal?: AbortSignal): Promise<WebSearchResult> {
  throwIfAborted(signal)
  try {
    // Native providers own their transport and limit policies; do not wrap them in our deadline.
    if (target.kind === 'native') return normalizeResult(await target.provider.search(request, signal))
    const { connection } = target
    const input: SearchInput = {
      query: request.query,
      maxResults: request.maxResults,
      freshness: honorsFreshness(connection.adapter, connection.access) ? target.freshness : 'auto',
      options: connection.options,
    }
    const sources = await runAdapter({
      errors: searchErrors,
      transport,
      mcp,
      credential: ref => deps.credential(ref),
      onDiagnostic: deps.onDiagnostic,
      credentialMissing: ref => 'no API key is stored for ' + ref + '; ask the user to add it in search connection settings (DSH Credentials) or choose another connection',
      credentialInvalid: ref => 'the API key stored for ' + ref + ' is malformed (it contains a line break or another control character); ask the user to re-enter it in search connection settings (DSH Credentials)',
    }, ADAPTER_WIRES[connection.adapter], adapterTarget(connection, CATALOG[connection.adapter].endpoint), input, signal)
    return { sources, truncated: false }
  } catch (error) {
    if (!(error instanceof WebError) && deps.onDiagnostic !== undefined) deps.onDiagnostic(error)
    throwIfAborted(signal)
    if (error instanceof WebError) throw error
    throw searchError('WEB_PROVIDER_ERROR', 'search failed; check the connection settings or choose another connection')
  }
}

