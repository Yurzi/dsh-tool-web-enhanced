import type { WebSearchProvider, WebSearchRequest } from '@deepseek-ai/dsh-web'
import { nativeBackend as wrapNative, restateNative } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { OnDiagnostic } from '../search/errors.ts'
import { normalizeResult } from '../search/sources.ts'
export { nativeAuth } from 'dsh-tool-web-enhanced-core/host'

export interface NativeOverrides {
  readonly credentialRef: string
  readonly options: Readonly<Record<string, unknown>>
}

export const DEFAULT_NATIVE_OVERRIDES: NativeOverrides = { credentialRef: 'DEEPSEEK_API_KEY', options: {} }

const NATIVE_MESSAGES = {
  WEB_PROVIDER_CREDENTIAL_MISSING: 'DeepSeek search has no API key; ask the user to save the configured credential (DEEPSEEK_API_KEY by default) in search connection settings or use a DeepSeek account model.',
  WEB_PROVIDER_ERROR: 'DeepSeek search failed. If every query fails, ask the user to check search connection settings, the API key or DeepSeek account sign-in. Do not retry in a loop.',
  WEB_ABORTED: 'search aborted',
  WEB_PROVIDER_UNAVAILABLE: 'DeepSeek search is unavailable; choose another search connection.',
  WEB_PROVIDER_CONFIGURED_UNAVAILABLE: 'DeepSeek search is unavailable; check its connection settings.',
  WEB_PROVIDER_CONFIGURED_MISSING: 'DeepSeek search is not configured; choose a search connection.',
} as const

export const restateNativeError = restateNative(NATIVE_MESSAGES, SEARCH.packageName + ': ',
  'DeepSeek search failed; check the connection settings, API key or DeepSeek account sign-in. Do not retry in a loop.')

export function nativeBackend(upstream: WebSearchProvider, onDiagnostic?: OnDiagnostic, secrets: Iterable<string> = [], resolverFailed: () => boolean = () => false): WebSearchProvider {
  const backend = wrapNative(upstream, async (request: WebSearchRequest, signal) => normalizeResult(await upstream.search(request, signal)), restateNativeError, onDiagnostic, secrets, resolverFailed)
  return { id: backend.id, available: backend.available, search: backend.execute }
}
