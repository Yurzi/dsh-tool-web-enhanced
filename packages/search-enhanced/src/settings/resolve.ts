import { z } from 'zod'
import { RETIRED_FIELDS } from './retired.ts'
import { resolveDocument, type AccessMode, type ResolvedDocument } from 'dsh-tool-web-enhanced-core/shared'
import { CATALOG, DEFAULT_CONNECTION, FRESHNESS, type AdapterKey, type Freshness } from '../catalog.ts'

interface ConnectionBase {
  readonly id: string
  readonly label: string
  readonly disabled: boolean
  readonly remote: boolean
  readonly access: AccessMode
  readonly trustedEndpoint: boolean
  readonly credentialRef: string
  readonly options: Readonly<Record<string, unknown>>
}
export interface NativeConnection extends ConnectionBase {
  readonly kind: 'native'
  readonly native: 'deepseek-messages' | 'deepseek-search-api'
}
export interface AdapterConnection extends ConnectionBase {
  readonly kind: 'adapter'
  readonly adapter: AdapterKey
  readonly endpoint: string
}
export type Connection = NativeConnection | AdapterConnection
export type ResolvedSettings = ResolvedDocument<{ readonly freshness: Freshness }, Connection>

const defaultsSchema = z.strictObject({ freshness: z.enum(FRESHNESS).default('auto') })

/** Pure sparse resolution shared by Host and browser. */
export function resolveSettings(document: unknown = {}): ResolvedSettings {
  const resolved = resolveDocument({ catalog: CATALOG, document, retiredFields: RETIRED_FIELDS, defaults: { schema: defaultsSchema, defaultConnection: DEFAULT_CONNECTION }, customAllowed: true, capabilityLabel: 'search' })
  const connections = new Map<string, Connection>()
  for (const [id, connection] of resolved.connections) {
    const { catalogKey, ...base } = connection
    if (base.kind === 'local') throw new Error('search catalog cannot contain a local connection')
    if (catalogKey === 'deepseek-messages' || catalogKey === 'deepseek-search-api') {
      connections.set(id, { ...base, kind: 'native', native: catalogKey })
    } else {
      connections.set(id, { ...base, kind: 'adapter', adapter: catalogKey as AdapterKey })
    }
  }
  return { ...resolved, connections }
}
