import type { Context } from '@deepseek-ai/cordis'
import { nextModel, type ExplicitCall, type ListingFacts, type Recipient } from 'dsh-tool-web-enhanced-core/host'
import type { Descriptor, ProtocolDescriptor } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, MODEL_PROTOCOLS, honorsFreshness } from '../catalog.ts'
import type { Connection } from '../settings/resolve.ts'

/**
 * What list_web_search_providers says about one connection (docs/design.md, "列出工具"):
 * its catalog use, who receives the query and whether it applies the Session's
 * freshness. Reads only settings and public model facts; no I/O, no secrets.
 */
export function searchListing(ctx: Context, connection: Connection, call: ExplicitCall): ListingFacts {
  switch (connection.kind) {
    case 'native': {
      const info: Descriptor & { readonly endpoint: string } = CATALOG[connection.native]
      const { baseURL } = connection.options
      return { use: info.use, recipient: service(info.label, typeof baseURL === 'string' ? baseURL : info.endpoint, info.endpoint), appliesFreshness: false }
    }
    case 'adapter': {
      const info: Descriptor & { readonly endpoint: string } = CATALOG[connection.adapter]
      // Keyless always goes to the catalog endpoint.
      const endpoint = connection.access === 'keyless' ? info.endpoint : connection.endpoint
      return { use: info.use, recipient: service(info.label, endpoint, info.endpoint), appliesFreshness: honorsFreshness(connection.adapter, connection.access) }
    }
    case 'model': {
      if (connection.route.kind === 'session') {
        // The same model describe() judges readiness by: the one the Session's next request uses.
        const model = nextModel(ctx, call.agent)
        return { use: CATALOG['session-model'].use, recipient: { kind: 'session-model', provider: model === undefined ? undefined : model.provider }, appliesFreshness: false }
      }
      const protocol: ProtocolDescriptor = MODEL_PROTOCOLS[connection.route.protocol]
      return { use: protocol.use, recipient: { kind: 'service', service: protocol.label, host: new URL(connection.route.endpoint).hostname }, appliesFreshness: false }
    }
  }
}

/** The catalog service; an operator endpoint that differs from the catalog's is named by its hostname. */
function service(label: string, endpoint: string, catalogEndpoint: string): Recipient {
  return { kind: 'service', service: label, host: endpoint === catalogEndpoint ? undefined : new URL(endpoint).hostname }
}
