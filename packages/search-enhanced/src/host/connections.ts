import type { Context } from '@deepseek-ai/cordis'
import { credentialReadiness, routeKeyConfigured, type SessionModel } from 'dsh-tool-web-enhanced-core/host'
import { modelUrl } from '../model/protocols.ts'
import { fixedRoute, sessionRoute } from '../model/route.ts'
import type { ModelRoute } from '../model/types.ts'
import { CATALOG, honorsFreshness } from '../catalog.ts'
import type { SearchConnectionView } from '../contract.ts'
import type { Connection, ResolvedSettings } from '../settings/resolve.ts'

export async function describeConnections(ctx: Context, settings: ResolvedSettings, model: SessionModel | undefined): Promise<SearchConnectionView[]> {
  return Promise.all([...settings.connections.values()].map(async (connection): Promise<SearchConnectionView> => {
    const base = baseOf(connection)
    if (connection.kind === 'model') {
      const target = connection.route.kind === 'fixed'
        ? { kind: 'route' as const, route: fixedRoute(connection.route) }
        : sessionRoute(ctx, model)
      const access = target.kind === 'route' ? target.route.auth.kind : 'api-key'
      if (connection.disabled) return { ...base, access, status: 'disabled' }
      if (target.kind === 'unsupported') return { ...base, access, status: 'unsupported', reason: target.reason }
      return { ...base, access, status: await modelReady(ctx, target.route) ? 'ready' : 'needs-credential' }
    }
    const access = connection.kind === 'native' ? 'api-key' : connection.access
    if (access === 'keyless') return { ...base, access, status: connection.disabled ? 'disabled' : 'ready' }
    if (connection.disabled) return { ...base, access, status: 'disabled' }
    const endpoint = connection.kind === 'native'
      ? typeof connection.options.baseURL === 'string' ? connection.options.baseURL : CATALOG[connection.native].endpoint
      : undefined
    return { ...base, ...await credentialReadiness(ctx, model, { endpoint, credentialRef: connection.credentialRef }) }
  }))
}

async function modelReady(ctx: Context, route: ModelRoute): Promise<boolean> {
  const { auth } = route
  if (auth.kind === 'account') {
    const account = ctx.get('deepseekAccount')
    return account !== undefined && await account.resolveToken(modelUrl(route.protocol, route.baseURL)) !== undefined
  }
  return routeKeyConfigured(ctx, auth.credentialRef, auth.source)
}

function baseOf(connection: Connection): Pick<SearchConnectionView, 'id' | 'label' | 'kind' | 'remote' | 'freshness'> {
  const { id, label, kind, remote } = connection
  return { id, label, kind, remote, freshness: connection.kind === 'adapter' && honorsFreshness(connection.adapter, connection.access) }
}
