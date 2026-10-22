import type { ListingFacts, Recipient } from 'dsh-tool-web-enhanced-core/host'
import type { Descriptor } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG } from '../catalog.ts'
import { allowlistNotice } from '../prompt.ts'
import type { Connection } from '../settings/types.ts'

/**
 * What list_web_fetch_providers says about one connection (docs/design.md, "列出工具"):
 * who receives the URL and, for `local`, the operator allowlist worded for
 * "this provider". Reads only settings; no I/O, no secrets.
 */
export function fetchListing(connection: Connection): ListingFacts {
  switch (connection.kind) {
    case 'local': {
      const info: Descriptor = CATALOG.local
      const notice = allowlistNotice(connection.options, 'this provider')
      return { use: info.use, recipient: { kind: 'this-machine' }, ...notice === '' ? {} : { notice } }
    }
    case 'native': {
      const info: Descriptor & { readonly endpoint: string } = CATALOG[connection.native]
      const { baseURL } = connection.options
      return { use: info.use, recipient: service(info.label, typeof baseURL === 'string' ? baseURL : info.endpoint, info.endpoint) }
    }
    case 'adapter': {
      const info: Descriptor & { readonly endpoint: string } = CATALOG[connection.adapter]
      // Keyless always goes to the catalog endpoint.
      const endpoint = connection.access === 'keyless' ? info.endpoint : connection.endpoint
      return { use: info.use, recipient: service(info.label, endpoint, info.endpoint) }
    }
  }
}

/** The catalog service; an operator endpoint that differs from the catalog's is named by its hostname. */
function service(label: string, endpoint: string, catalogEndpoint: string): Recipient {
  return { kind: 'service', service: label, host: endpoint === catalogEndpoint ? undefined : new URL(endpoint).hostname }
}
