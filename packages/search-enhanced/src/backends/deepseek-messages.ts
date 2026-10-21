/** DSH's Messages provider, with live operator overrides and sanitized diagnostics. */
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  type DeepSeekSearchProviderOptions,
} from '@deepseek-ai/dsh-web-search-deepseek'
import { DEFAULT_NATIVE_OVERRIDES, nativeAuth, nativeBackend, type NativeOverrides } from './common.ts'

export function messagesOptions(ctx: Context, { credentialRef, options }: NativeOverrides, auth = nativeAuth(ctx, credentialRef)): DeepSeekSearchProviderOptions {
  const environmentBase = launchEnvironmentOf(ctx).get('DEEPSEEK_SEARCH_BASE_URL')
  const defaultBase = environmentBase === undefined ? DEEPSEEK_DEFAULT_BASE_URL : environmentBase.value
  return {
    ...auth,
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : defaultBase,
    model: typeof options.model === 'string' ? options.model : DEEPSEEK_DEFAULT_MODEL,
    apiVersion: typeof options.apiVersion === 'string' ? options.apiVersion : DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: typeof options.maxTokens === 'number' ? options.maxTokens : DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: typeof options.maxUses === 'number' ? options.maxUses : DEEPSEEK_DEFAULT_MAX_USES,
    recordRequest: request => {
      const agents = ctx.get('agents')
      const initiator = agents === undefined ? undefined : agents.currentInitiator()
      if (initiator !== undefined) initiator.session.append('web/deepseek-search-llm-request', request)
    },
  }
}

export function deepseekMessages(ctx: Context, overrides: () => NativeOverrides = () => DEFAULT_NATIVE_OVERRIDES): WebSearchProvider {
  const readiness = new DeepSeekSearchProvider(() => messagesOptions(ctx, overrides()))
  return {
    id: readiness.id,
    available: () => readiness.available(),
    search: (request, signal) => {
      const secrets = new Set<string>()
      let auth: ReturnType<typeof nativeAuth> | undefined
      const upstream = new DeepSeekSearchProvider(() => {
        const settings = overrides()
        auth = nativeAuth(ctx, settings.credentialRef, secrets)
        return messagesOptions(ctx, settings, auth)
      })
      const resolverFailed = () => auth !== undefined && auth.resolverFailed()
      return nativeBackend(upstream, cause => { ctx.logger.debug('Native search failed', cause) }, secrets, resolverFailed).search(request, signal)
    },
  }
}
