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

export function messagesOptions(ctx: Context, { credentialRef, options }: NativeOverrides): DeepSeekSearchProviderOptions {
  const environmentBase = launchEnvironmentOf(ctx).get('DEEPSEEK_SEARCH_BASE_URL')
  const defaultBase = environmentBase === undefined ? DEEPSEEK_DEFAULT_BASE_URL : environmentBase.value
  return {
    ...nativeAuth(ctx, credentialRef),
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
  return nativeBackend(new DeepSeekSearchProvider(() => messagesOptions(ctx, overrides())), cause => { ctx.logger.debug('Native search failed', cause) })
}
