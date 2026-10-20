import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialReadiness } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG, honorsFreshness } from '../catalog.ts'
import type { SearchConnectionView } from '../contract.ts'
import type { Connection, ResolvedSettings } from '../settings/resolve.ts'

export async function describeConnections(ctx: Context, settings: ResolvedSettings, agent: Agent): Promise<SearchConnectionView[]> {
  return Promise.all([...settings.connections.values()].map(async (connection): Promise<SearchConnectionView> => {
    const base = baseOf(connection)
    const access = connection.kind === 'native' ? 'api-key' : connection.access
    if (access === 'keyless') return { ...base, access, status: connection.disabled ? 'disabled' : 'ready' }
    if (connection.disabled) return { ...base, access, status: 'disabled' }
    const endpoint = connection.kind === 'native'
      ? typeof connection.options.baseURL === 'string' ? connection.options.baseURL : CATALOG[connection.native].endpoint
      : undefined
    return { ...base, ...await credentialReadiness(ctx, agent, { endpoint, credentialRef: connection.credentialRef }) }
  }))
}

function baseOf(connection: Connection): Pick<SearchConnectionView, 'id' | 'label' | 'kind' | 'remote' | 'freshness'> {
  const { id, label, kind, remote } = connection
  return { id, label, kind, remote, freshness: connection.kind === 'adapter' && honorsFreshness(connection.adapter, connection.access) }
}
