/**
 * Native-parity backend: DSH's own DeepSeek Messages search, built from the
 * provider class `@deepseek-ai/dsh-web-search-deepseek` exports, with the
 * credential and endpoint resolution of the native `web-search-deepseek` row
 * that the profile disables. Behaviour, limits included, is DSH's own; only
 * error messages differ (see `restate`). Keep in step with that row's
 * `resolveOptions` (deepseek-harness packages/web/web-search-deepseek/src/index.ts).
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-deepseek-account'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import { WebError, type WebSearchProvider } from '@deepseek-ai/dsh-web'
import {
  DeepSeekSearchProvider,
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-web-search-deepseek'

/** Credential the native row resolves (base bundle: `apiKeyEnv: DEEPSEEK_API_KEY`). */
const API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** Auxiliary-search endpoint override, independent of the conversation route's base URL. */
const SEARCH_BASE_URL_ENV = 'DEEPSEEK_SEARCH_BASE_URL'
/** Route id of the DeepSeek account provider; its Sessions authenticate with the account token. */
const ACCOUNT_PROVIDER = 'deepseek-account'

/**
 * Model-facing text for the upstream failures. Upstream messages embed the
 * endpoint and upstream error detail, and send the user to the built-in Web
 * search page and the `web-search-deepseek` row, both of which the profile
 * retires. Codes stay as upstream raised them.
 */
const MESSAGES: Readonly<Record<string, string>> = {
  WEB_PROVIDER_CREDENTIAL_MISSING: 'DeepSeek search has no API key. Ask the user to save DEEPSEEK_API_KEY on the Models page, or to use a DeepSeek account model.',
  WEB_PROVIDER_ERROR: 'DeepSeek search failed. Do not retry in a loop; if it keeps failing, ask the user to check their DeepSeek API key or account sign-in.',
}

/**
 * @param error - what the upstream provider threw.
 * @returns the same failure with a message fit for the model.
 */
function restate(error: unknown): unknown {
  if (!(error instanceof WebError)) return error
  const message = MESSAGES[error.code]
  return message === undefined ? error : new WebError(message, error.code)
}

/**
 * @param ctx - plugin context; services are looked up per search, never cached.
 * @returns a provider that searches like the native `deepseek-official` provider.
 */
export function deepseekMessages(ctx: Context): WebSearchProvider {
  const upstream = nativeProvider(ctx)
  return {
    id: upstream.id,
    available: () => upstream.available(),
    async search(request, signal) {
      try {
        return await upstream.search(request, signal)
      } catch (error) {
        throw restate(error)
      }
    },
  }
}

function nativeProvider(ctx: Context): WebSearchProvider {
  const apiKeyEnv = credentialRef(API_KEY_ENV)
  return new DeepSeekSearchProvider(() => ({
    resolveAccountToken: async (endpoint) => {
      const provider = ctx.get('agents')?.currentInitiator()?.session.requestContext()?.provider
      if (provider !== ACCOUNT_PROVIDER) return undefined
      return await ctx.get('deepseekAccount')?.resolveToken(endpoint)
    },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value ?? DEEPSEEK_DEFAULT_BASE_URL,
    model: DEEPSEEK_DEFAULT_MODEL,
    apiVersion: DEEPSEEK_DEFAULT_API_VERSION,
    maxTokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
    maxUses: DEEPSEEK_DEFAULT_MAX_USES,
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/deepseek-search-llm-request', request)
    },
  }))
}
