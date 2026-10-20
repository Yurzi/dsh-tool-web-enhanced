import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import {
  DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekFetchApiProvider,
  type DeepSeekFetchApiOptions,
} from '@deepseek-ai/dsh-web-deepseek-api'
import { nativeAuth, nativeBackend, type NativeOverrides } from './common.ts'

export function fetchApiOptions(ctx: Context, { credentialRef, options }: NativeOverrides): DeepSeekFetchApiOptions {
  return {
    ...nativeAuth(ctx, credentialRef),
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : DEEPSEEK_WEB_API_BASE_URL,
  }
}

/** The exported DSH provider keeps its native transport, result mapping and limits. */
export function deepseekFetchApi(ctx: Context, overrides: () => NativeOverrides): WebFetchProvider {
  return nativeBackend(ctx, new DeepSeekFetchApiProvider(() => fetchApiOptions(ctx, overrides())))
}
