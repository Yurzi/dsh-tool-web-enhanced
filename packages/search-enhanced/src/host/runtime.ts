import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { accountTokenFor, installCapability, requestModel, resolveApiKey, routeApiKey, type Capability } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { createNativeBackend } from '../backends/native.ts'
import { fixedRoute, sessionRoute } from '../model/route.ts'
import { executeModelSearch, type ModelSearchTarget } from '../model/execute.ts'
import { contract, type SearchConnectionView } from '../contract.ts'
import { executeSearch, type SearchTarget } from '../search/execute.ts'
import type { ResolvedSettings } from '../settings/resolve.ts'
import { createSearchSeat } from '../seat.ts'
import { describeConnections } from './connections.ts'
import { optionsCodec, type SearchOptions } from './options.ts'
import type {} from './remote.ts'

export function searchCapability(ctx: Context, settings: () => ResolvedSettings): Capability<ResolvedSettings, SearchOptions, SearchConnectionView, SearchTarget | ModelSearchTarget, WebSearchRequest, WebSearchResult> {
  return {
    identity: SEARCH, tool: 'web_search', field: 'searchProvider',
    remoteNamespace: 'searchConnections', storageDomain: 'web_search_enhanced', contract, optionsCodec, settings,
    describe: (current, agent) => describeConnections(ctx, current, agent),
    target: (connection, options, call) => {
      switch (connection.kind) {
        case 'adapter': return { kind: 'adapter', connection, freshness: options.freshness }
        case 'native': return { kind: 'native', provider: createNativeBackend(ctx, connection.native, () => ({ credentialRef: connection.credentialRef, options: connection.options })) }
        case 'model': return {
          kind: 'model', label: connection.label, options: connection.options,
          route: connection.route.kind === 'fixed'
            ? { kind: 'route', route: fixedRoute(connection.route) }
            : sessionRoute(ctx, call.agent === undefined ? undefined : requestModel(call.agent)),
        }
      }
    },
    execute: (target, request, call) => {
      const onDiagnostic = (cause: unknown) => ctx.logger.debug('%s: search failed: %s', SEARCH.rowId, cause)
      if (target.kind === 'model') return executeModelSearch(target, request, {
        onDiagnostic,
        apiKey: (ref, source) => source === 'credentials' ? resolveApiKey(ctx, ref) : routeApiKey(ctx, ref),
        accountToken: async url => {
          const resolve = accountTokenFor(ctx, call.agent)
          return resolve === undefined ? undefined : await resolve(url)
        },
      }, call.signal)
      return executeSearch(target, request, { onDiagnostic, credential: ref => resolveApiKey(ctx, ref) }, call.signal)
    },
    register: (scope, invoke) => { scope.web.registerSearchProvider(createSearchSeat(SEARCH.providerId, () => ({ id: SEARCH.providerId, available: () => true, search: invoke }))) },
  }
}

export function installSearch(ctx: Context, settings: () => ResolvedSettings): void {
  installCapability(ctx, searchCapability(ctx, settings))
}
