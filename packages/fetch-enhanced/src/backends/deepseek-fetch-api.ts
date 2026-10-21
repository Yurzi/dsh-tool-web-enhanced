import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import {
  DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekFetchApiProvider,
  type DeepSeekFetchApiOptions,
} from '@deepseek-ai/dsh-web-deepseek-api'
import { nativeAuth, nativeBackend, type NativeOverrides } from './common.ts'

export function fetchApiOptions(ctx: Context, { credentialRef, options }: NativeOverrides, auth = nativeAuth(ctx, credentialRef)): DeepSeekFetchApiOptions {
  return {
    ...auth,
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : DEEPSEEK_WEB_API_BASE_URL,
  }
}

/** The exported DSH provider keeps its native transport, result mapping and limits. */
export function deepseekFetchApi(ctx: Context, overrides: () => NativeOverrides): WebFetchProvider {
  const readiness = new DeepSeekFetchApiProvider(() => fetchApiOptions(ctx, overrides()))
  return {
    id: readiness.id,
    available: () => readiness.available(),
    fetch: (request, signal) => {
      const secrets = new Set<string>()
      let auth: ReturnType<typeof nativeAuth> | undefined
      const upstream = new DeepSeekFetchApiProvider(() => {
        const settings = overrides()
        auth = nativeAuth(ctx, settings.credentialRef, secrets)
        return fetchApiOptions(ctx, settings, auth)
      })
      const resolverFailed = () => auth !== undefined && auth.resolverFailed()
      return nativeBackend(ctx, upstream, secrets, resolverFailed).fetch(request, signal)
    },
  }
}
