import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import { installCapability, resolveApiKey, type Capability, type CapabilityRuntime } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { createNativeFetchBackend } from '../backends/native.ts'
import { contract, type FetchConnectionView } from '../contract.ts'
import { createLocalBackend } from '../local/backend.ts'
import { createRemoteBackend } from '../remote/execute.ts'
import { registerAllowlistNotice } from '../prompt.ts'
import { fetchEnhanced } from '../tools/index.ts'
import type { ResolvedSettings } from '../settings/types.ts'
import { describeConnections } from './connections.ts'
import { optionsCodec, type FetchOptions } from './options.ts'
import type {} from './remote.ts'

export function fetchCapability(ctx: Context, settings: () => ResolvedSettings): Capability<ResolvedSettings, FetchOptions, FetchConnectionView, WebFetchProvider, WebFetchRequest, WebFetchResult> {
  return {
    identity: FETCH,
    tool: 'web_fetch',
    field: 'fetchProvider',
    remoteNamespace: 'fetchConnections',
    storageDomain: 'web_fetch_enhanced',
    contract, optionsCodec, settings,
    describe: (current, model) => describeConnections(ctx, current, model),
    target: connection => {
      switch (connection.kind) {
        case 'local': return createLocalBackend(() => connection.options, ctx.logger)
        case 'native': return createNativeFetchBackend(ctx, () => ({ credentialRef: connection.credentialRef, options: connection.options }))
        case 'adapter': return createRemoteBackend(connection, {
          credential: ref => resolveApiKey(ctx, ref),
          onDiagnostic: cause => { ctx.logger.debug('%s: fetch failed: %s', FETCH.rowId, cause) },
        })
      }
    },
    execute: (provider, request, call) => provider.fetch(request, call.signal),
    register: (scope, invoke) => {
      scope.web.registerFetchProvider({ id: FETCH.providerId, available: () => true, fetch: invoke })
    },
    enhanced: fetchEnhanced(ctx),
  }
}

export function installFetch(ctx: Context, settings: () => ResolvedSettings): CapabilityRuntime<FetchOptions> {
  const runtime = installCapability(ctx, fetchCapability(ctx, settings))
  registerAllowlistNotice(ctx, runtime, settings)
  return runtime
}
