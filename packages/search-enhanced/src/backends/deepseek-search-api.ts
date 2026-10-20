/** DSH's direct Search API provider; native limits and endpoint defaults stay intact. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import {
  DEEPSEEK_DEFAULT_COUNT,
  DEEPSEEK_WEB_API_BASE_URL,
  DeepSeekSearchApiProvider,
  type DeepSeekSearchApiOptions,
} from '@deepseek-ai/dsh-web-deepseek-api'
import { DEFAULT_NATIVE_OVERRIDES, nativeAuth, nativeBackend, type NativeOverrides } from './common.ts'

function latestUserQuestion(ctx: Context): string | undefined {
  const agents = ctx.get('agents')
  const initiator = agents === undefined ? undefined : agents.currentInitiator()
  if (initiator === undefined) return undefined
  const prompt = initiator.session.deriveMessages().findLast(message => message.role === 'user' && message.source.kind === 'user')
  if (prompt === undefined) return undefined
  return prompt.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

export function searchApiOptions(ctx: Context, { credentialRef, options }: NativeOverrides): DeepSeekSearchApiOptions {
  return {
    ...nativeAuth(ctx, credentialRef),
    baseURL: typeof options.baseURL === 'string' ? options.baseURL : DEEPSEEK_WEB_API_BASE_URL,
    count: typeof options.count === 'number' ? options.count : DEEPSEEK_DEFAULT_COUNT,
    ...(options.sendOriginalQuestion === false ? {} : { originalQuestion: () => latestUserQuestion(ctx) }),
  }
}

export function deepseekSearchApi(ctx: Context, overrides: () => NativeOverrides = () => DEFAULT_NATIVE_OVERRIDES): WebSearchProvider {
  return nativeBackend(new DeepSeekSearchApiProvider(() => searchApiOptions(ctx, overrides())), cause => { ctx.logger.debug('Native search failed', cause) })
}
