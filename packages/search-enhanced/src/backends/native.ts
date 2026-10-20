import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { NativeOverrides } from './common.ts'
import { deepseekMessages } from './deepseek-messages.ts'
import { deepseekSearchApi } from './deepseek-search-api.ts'

export type { NativeOverrides } from './common.ts'

export function createNativeBackend(ctx: Context, key: 'deepseek-messages' | 'deepseek-search-api', overrides: () => NativeOverrides): WebSearchProvider {
  return key === 'deepseek-messages' ? deepseekMessages(ctx, overrides) : deepseekSearchApi(ctx, overrides)
}
