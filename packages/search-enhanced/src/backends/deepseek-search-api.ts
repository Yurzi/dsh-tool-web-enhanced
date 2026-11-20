/** DSH's direct Search API provider; native limits and endpoint defaults stay intact. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import {
  DEEPSEEK_DEFAULT_COUNT,
  DEEPSEEK_SEARCH_REQUESTS_PER_SECOND,
  DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekSearchApiProvider,
  type DeepSeekSearchApiOptions,
} from '@deepseek-ai/dsh-web-deepseek-api'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { DEFAULT_NATIVE_OVERRIDES, nativeAuth, nativeBackend, type NativeOverrides } from './common.ts'

function latestUserQuestion(ctx: Context): string | undefined {
  const agents = ctx.get('agents')
  const initiator = agents === undefined ? undefined : agents.currentInitiator()
  if (initiator === undefined) return undefined
  const prompt = initiator.session.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'user')
  if (prompt === undefined) return undefined
  return prompt.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

export function searchApiOptions(ctx: Context, { credentialRef, options }: NativeOverrides, auth = nativeAuth(ctx, credentialRef)): DeepSeekSearchApiOptions {
  const customBaseURL = typeof options.baseURL === 'string' ? options.baseURL : undefined
  const baseURL = customBaseURL ?? DEEPSEEK_WEB_API_BASE_URL
  return {
    auth: {
      sources: [
        {
          kind: 'account',
          baseURL,
          resolveToken: auth.resolveAccountToken,
          rejectToken: auth.rejectAccountToken,
        },
        {
          kind: 'api-key',
          baseURL,
          key: {
            ref: auth.apiKeyEnv,
            configured: auth.apiKeyConfigured,
            resolve: auth.resolveApiKey,
          },
        },
      ],
    },
    guidance: {
      subject: 'Search',
      plugin: SEARCH.rowId,
      custom: customBaseURL !== undefined,
      baseURLField: 'baseURL',
      apiKeyEnvField: 'credentialRef',
    },
    count: typeof options.count === 'number' ? options.count : DEEPSEEK_DEFAULT_COUNT,
    requestsPerSecond: typeof options.requestsPerSecond === 'number' ? options.requestsPerSecond : DEEPSEEK_SEARCH_REQUESTS_PER_SECOND,
    ...(options.sendOriginalQuestion === false ? {} : { originalQuestion: () => latestUserQuestion(ctx) }),
  }
}

export function deepseekSearchApi(ctx: Context, overrides: () => NativeOverrides = () => DEFAULT_NATIVE_OVERRIDES): WebSearchProvider {
  const readiness = new DeepSeekSearchApiProvider(() => searchApiOptions(ctx, overrides()))
  return {
    id: readiness.id,
    available: () => readiness.available(),
    search: (request, signal) => {
      const secrets = new Set<string>()
      let auth: ReturnType<typeof nativeAuth> | undefined
      const upstream = new DeepSeekSearchApiProvider(() => {
        const settings = overrides()
        auth = nativeAuth(ctx, settings.credentialRef, secrets)
        return searchApiOptions(ctx, settings, auth)
      })
      const resolverFailed = () => auth !== undefined && auth.resolverFailed()
      return nativeBackend(upstream, cause => { ctx.logger.debug('Native search failed', cause) }, secrets, resolverFailed).search(request, signal)
    },
  }
}
