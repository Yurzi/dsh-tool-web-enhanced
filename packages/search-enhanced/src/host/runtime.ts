import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { installCapability, resolveApiKey, type Capability } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { createNativeBackend } from '../backends/native.ts'
import { contract, type SearchConnectionView } from '../contract.ts'
import { executeSearch, type SearchTarget } from '../search/execute.ts'
import type { ResolvedSettings } from '../settings/resolve.ts'
import { createSearchSeat } from '../seat.ts'
import { describeConnections } from './connections.ts'
import { optionsCodec, type SearchOptions } from './options.ts'
import type {} from './remote.ts'

export function searchCapability(ctx: Context, settings: () => ResolvedSettings): Capability<ResolvedSettings, SearchOptions, SearchConnectionView, SearchTarget, WebSearchRequest, WebSearchResult> {
  return {
    identity: SEARCH, tool: 'web_search', field: 'searchProvider',
    remoteNamespace: 'searchConnections', storageDomain: 'web_search_enhanced', contract, optionsCodec, settings,
    describe: (current, agent) => describeConnections(ctx, current, agent),
    target: (connection, options) => connection.kind === 'adapter'
      ? { kind: 'adapter', connection, freshness: options.freshness }
      : { kind: 'native', provider: createNativeBackend(ctx, connection.native, () => ({ credentialRef: connection.credentialRef, options: connection.options })) },
    execute: (target, request, call) => executeSearch(target, request, {
      onDiagnostic: cause => ctx.logger.debug('%s: search failed: %s', SEARCH.rowId, cause),
      credential: ref => resolveApiKey(ctx, ref),
    }, call.signal),
    register: (scope, invoke) => { scope.web.registerSearchProvider(createSearchSeat(SEARCH.providerId, () => ({ id: SEARCH.providerId, available: () => true, search: invoke }))) },
  }
}

export function installSearch(ctx: Context, settings: () => ResolvedSettings): void {
  installCapability(ctx, searchCapability(ctx, settings))
}
