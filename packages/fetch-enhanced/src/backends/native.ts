import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import type { NativeOverrides } from './common.ts'
import { deepseekFetchApi } from './deepseek-fetch-api.ts'

export type { NativeOverrides } from './common.ts'

export function createNativeFetchBackend(ctx: Context, overrides: () => NativeOverrides): WebFetchProvider {
  return deepseekFetchApi(ctx, overrides)
}
