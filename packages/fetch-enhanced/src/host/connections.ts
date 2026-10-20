import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialReadiness } from 'dsh-tool-web-enhanced-core/host'
import { CATALOG } from '../catalog.ts'
import type { FetchConnectionView } from '../contract.ts'
import type { ResolvedSettings } from '../settings/types.ts'

export async function describeConnections(ctx: Context, settings: ResolvedSettings, agent: Agent): Promise<FetchConnectionView[]> {
  return Promise.all([...settings.connections.values()].map(async (connection): Promise<FetchConnectionView> => {
    const { id, label, kind, remote, disabled } = connection
    const base = { id, label, kind, remote }
    if (connection.access === 'keyless') return { ...base, access: 'keyless', status: disabled ? 'disabled' : 'ready' }
    if (disabled) return { ...base, access: 'api-key', status: 'disabled' }
    if (kind === 'adapter') return { ...base, ...await credentialReadiness(ctx, agent, { credentialRef: connection.credentialRef }) }
    const endpoint = typeof connection.options.baseURL === 'string' ? connection.options.baseURL : CATALOG[connection.native].endpoint
    return { ...base, ...await credentialReadiness(ctx, agent, { endpoint, credentialRef: connection.credentialRef }) }
  }))
}
