import { z } from 'zod'
import { RETIRED_FIELDS } from './retired.ts'
import { resolveDocument, type AccessMode, type ResolvedDocument } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, DEFAULT_CONNECTION, FRESHNESS, MODEL_PROTOCOLS, type AdapterKey, type Freshness, type ModelProtocol } from '../catalog.ts'

interface ConnectionBase {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
  readonly remote: boolean
  readonly trustedEndpoint: boolean
  readonly options: Readonly<Record<string, unknown>>
}
export interface NativeConnection extends ConnectionBase {
  readonly kind: 'native'
  readonly access: AccessMode
  readonly credentialRef: string
  readonly native: 'deepseek-messages' | 'deepseek-search-api'
}
export interface AdapterConnection extends ConnectionBase {
  readonly kind: 'adapter'
  readonly access: AccessMode
  readonly credentialRef: string
  readonly adapter: AdapterKey
  readonly endpoint: string
}
export interface ModelConnection extends ConnectionBase {
  readonly kind: 'model'
  readonly route:
    | { readonly kind: 'session' }
    | { readonly kind: 'fixed'; readonly protocol: ModelProtocol; readonly model: string; readonly endpoint: string; readonly credentialRef: string }
}
export type Connection = NativeConnection | AdapterConnection | ModelConnection
export type ResolvedSettings = ResolvedDocument<{ readonly freshness: Freshness }, Connection>

const defaultsSchema = z.strictObject({ freshness: z.enum(FRESHNESS).default('auto') })

/** Pure sparse resolution shared by Host and browser. */
export function resolveSettings(document: unknown = {}): ResolvedSettings {
  const resolved = resolveDocument({ catalog: CATALOG, protocols: MODEL_PROTOCOLS, document, retiredFields: RETIRED_FIELDS, defaults: { schema: defaultsSchema, defaultConnection: DEFAULT_CONNECTION }, capabilityLabel: 'search' })
  const connections = new Map<string, Connection>()
  for (const [id, connection] of resolved.connections) {
    const { catalogKey, ...base } = connection
    switch (base.kind) {
      case 'local': throw new Error('search catalog cannot contain a local connection')
      case 'model':
        connections.set(id, base)
        break
      case 'native':
        connections.set(id, { ...base, kind: 'native', native: catalogKey as NativeConnection['native'] })
        break
      case 'adapter':
        connections.set(id, { ...base, kind: 'adapter', adapter: catalogKey as AdapterKey })
        break
    }
  }
  return { ...resolved, connections }
}