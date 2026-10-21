import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { LlmNativeAuth } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { isRecord, type SessionModel } from 'dsh-tool-web-enhanced-core/host'
import { TEXT_MAX_LENGTH } from 'dsh-tool-web-enhanced-core/shared'
import type { ModelProtocol } from '../catalog.ts'
import type { ModelConnection } from '../settings/resolve.ts'
import { deepseekRoute, isDeepseekProvider } from './deepseek.ts'
import { ROUTE_ENTRIES_MAX, routeCredential, routeEndpoint, routeModel } from './bounds.ts'
import type { ModelRoute, SessionRoute } from './types.ts'

export function fixedRoute(connection: Extract<ModelConnection['route'], { kind: 'fixed' }>): ModelRoute {
  return {
    dialect: 'standard', protocol: connection.protocol, model: connection.model, baseURL: connection.endpoint,
    auth: { kind: 'api-key', credentialRef: connection.credentialRef, source: 'credentials' },
  }
}

/** Public directory + one Settings generation; no credentials or network are read here. */
export function sessionRoute(ctx: Context, model: SessionModel | undefined): SessionRoute {
  if (model === undefined) return { kind: 'unsupported', reason: 'no-model' }
  // Unreadable or oversized route facts mean this plugin cannot read the route, not that it declares no protocol.
  if (!routeModel(model.model)) return { kind: 'unsupported', reason: 'unknown-route' }
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  if (llm === undefined || settings === undefined) return { kind: 'unsupported', reason: 'unknown-route' }
  const entry = llm.listConfigurableProviders().find(item => item.provider === model.provider)
  if (entry === undefined) return { kind: 'unsupported', reason: 'unknown-route' }
  const descriptor = settings.describe().find(item => item.ns === entry.settingsNs)
  if (descriptor === undefined) return { kind: 'unsupported', reason: 'unknown-route' }
  if (entry.settingsPath.length > ROUTE_ENTRIES_MAX || entry.settingsPath.some(segment => segment.length > TEXT_MAX_LENGTH)) return { kind: 'unsupported', reason: 'unknown-route' }
  let profile: unknown = descriptor.value
  for (const segment of entry.settingsPath) profile = own(profile, segment)
  if (!isRecord(profile)) return { kind: 'unsupported', reason: 'unknown-route' }
  if (isDeepseekProvider(model.provider)) {
    return deepseekRoute(model.provider, profile, launchEnvironmentOf(ctx), model.model)
  }

  // pi-ai: models replaces the catalog; modelOverrides applies to catalog models.
  // packages/llm/llm-pi-ai/src/config.ts:94–119,302–332; catalog.ts:868–891.
  const models = own(profile, 'models')
  if (models !== undefined && (!Array.isArray(models) || models.length > ROUTE_ENTRIES_MAX)) return { kind: 'unsupported', reason: 'unknown-route' }
  let listed: unknown
  if (Array.isArray(models)) {
    for (const candidate of models as unknown[]) {
      const id = own(candidate, 'id')
      if (!routeModel(id)) return { kind: 'unsupported', reason: 'unknown-route' }
      if (id === model.model) { listed = candidate; break }
    }
  }
  const overrides = own(profile, 'modelOverrides')
  if (listed === undefined && overrides !== undefined && !isRecord(overrides)) return { kind: 'unsupported', reason: 'unknown-route' }
  const item = listed === undefined ? own(overrides, model.model) : listed
  if (item !== undefined && !isRecord(item)) return { kind: 'unsupported', reason: 'unknown-route' }
  const protocol = protocolOf(own(item, 'api') ?? own(profile, 'api'))
  if (protocol === undefined) return { kind: 'unsupported', reason: 'protocol' }
  const baseURL = own(item, 'baseURL') ?? own(profile, 'baseURL') ?? entry.defaultBaseURL
  if (entry.baseURLEnv !== undefined || !routeEndpoint(baseURL)) return { kind: 'unsupported', reason: 'endpoint' }
  if (hasHeaders(own(profile, 'headers')) || hasHeaders(own(item, 'headers'))) return { kind: 'unsupported', reason: 'headers' }
  const credentialRef = credentialOf(own(profile, 'apiKeyEnv'), entry.nativeAuth)
  if (credentialRef === undefined) return { kind: 'unsupported', reason: 'credential' }
  return { kind: 'route', route: { dialect: 'standard', protocol, model: model.model, baseURL, auth: { kind: 'api-key', credentialRef, source: 'route' } } }
}

function own(value: unknown, key: string): unknown {
  return isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined
}

function hasHeaders(value: unknown): boolean {
  if (value === undefined) return false
  if (!isRecord(value)) return true
  for (const key in value) if (Object.hasOwn(value, key)) return true
  return false
}

function protocolOf(api: unknown): ModelProtocol | undefined {
  switch (api) {
    case 'anthropic-messages': return api
    case 'openai-responses': return api
    case 'openai-completions': return 'openai-chat-completions'
    default: return undefined
  }
}

function credentialOf(configured: unknown, nativeAuth: LlmNativeAuth | undefined): string | undefined {
  let ref = configured
  if (ref === undefined && nativeAuth !== undefined && !nativeAuth.oauth && nativeAuth.env.length === 1) ref = nativeAuth.env[0]
  return routeCredential(ref) ? ref : undefined
}