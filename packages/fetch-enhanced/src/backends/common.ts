import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider, WebFetchRequest } from '@deepseek-ai/dsh-web'
import { nativeBackend as wrapNative, restateNative } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
export { nativeAuth } from 'dsh-tool-web-enhanced-core/host'

export interface NativeOverrides {
  readonly credentialRef: string
  readonly options: Readonly<Record<string, unknown>>
}

const NATIVE_MESSAGES = {
  WEB_PROVIDER_CREDENTIAL_MISSING: 'DeepSeek fetch has no API key; ask the user to save the configured credential (DEEPSEEK_API_KEY by default) in fetch connection settings or use a DeepSeek account model.',
  WEB_PROVIDER_ERROR: 'DeepSeek fetch failed; ask the user to check fetch connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop.',
  WEB_ABORTED: 'fetch aborted',
} as const

export const restateNativeError = restateNative(NATIVE_MESSAGES, FETCH.packageName + ': ')

export function nativeBackend(ctx: Context, upstream: WebFetchProvider): WebFetchProvider {
  const backend = wrapNative(upstream, (request: WebFetchRequest, signal) => upstream.fetch(request, signal), restateNativeError,
    error => { ctx.logger.debug('Native fetch failed', error) })
  return { id: backend.id, available: backend.available, fetch: backend.execute }
}
