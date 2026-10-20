import { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import { CATALOG, honorsFreshness, type Freshness } from '../catalog.ts'
import type { AdapterConnection } from '../settings/resolve.ts'
import { ADAPTER_WIRES, type SearchInput } from './adapters/index.ts'
import { abortable, searchError, throwIfAborted, type OnDiagnostic } from './errors.ts'
import { requestJson, withDeadline } from './http.ts'
import { callTool } from './mcp.ts'
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
    return await withDeadline(signal, async deadline => {
      const input: SearchInput = {
        query: request.query,
        maxResults: request.maxResults,
        freshness: honorsFreshness(connection.adapter, connection.access) ? target.freshness : 'auto',
        options: connection.options,
      }
      const adapter = ADAPTER_WIRES[connection.adapter]
      if (connection.access === 'keyless') {
        // Settings reject keyless access for catalog entries without it; AdapterFor binds every remaining entry to a route.
        const route = adapter.keyless!
        const upstream = { label: connection.label, access: 'keyless', onDiagnostic: deps.onDiagnostic } as const
        const sources = route === 'rest'
          ? adapter.parse(await requestJson(adapter.request(input, CATALOG[connection.adapter].endpoint, { kind: 'keyless' }), deadline, upstream), input)
          : route.parse(await callTool({ ...route, arguments: route.arguments(input) }, deadline, upstream))
        return { sources, truncated: false }
      }
      const key = await apiKey(connection.credentialRef, deps, deadline)
      const wire = adapter.request(input, connection.endpoint, { kind: 'api-key', key })
      const payload = await requestJson(wire, deadline, { label: connection.label, access: 'api-key', onDiagnostic: deps.onDiagnostic })
      return { sources: adapter.parse(payload, input), truncated: false }
    })
  } catch (error) {
    if (!(error instanceof WebError) && deps.onDiagnostic !== undefined) deps.onDiagnostic(error)
    throwIfAborted(signal)
    if (error instanceof WebError) throw error
    throw searchError('WEB_PROVIDER_ERROR', 'search failed; check the connection settings or choose another connection')
  }
}

async function apiKey(ref: string, deps: SearchDeps, signal: AbortSignal): Promise<string> {
  const resolved = await abortable(deps.credential(ref), signal)
  const key = resolved === undefined ? '' : resolved.trim()
  if (key === '') throw searchError('WEB_PROVIDER_CREDENTIAL_MISSING', 'no API key is stored for ' + ref + '; ask the user to add it in search connection settings (DSH Credentials) or choose another connection')
  return key
}
