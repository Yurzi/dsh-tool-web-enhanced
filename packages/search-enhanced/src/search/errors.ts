import type { WebError } from '@deepseek-ai/dsh-web'
import { capabilityErrors } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'

export type { OnDiagnostic } from 'dsh-tool-web-enhanced-core/host'

export type SearchErrorCode =
  | 'WEB_PROVIDER_ERROR' | 'WEB_ABORTED' | 'WEB_PROVIDER_CREDENTIAL_MISSING'
  | 'WEB_PROVIDER_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_MISSING'

export function credentialMissing(ref: string, source: 'credentials' | 'route' = 'credentials'): string {
  const settings = source === 'route' ? 'DSH Credentials or Models settings' : 'search connection settings (DSH Credentials)'
  return 'no API key is stored for ' + ref + '; ask the user to add it in ' + settings + ' or choose another connection'
}

export function credentialInvalid(ref: string, source: 'credentials' | 'route' = 'credentials'): string {
  const settings = source === 'route' ? 'DSH Credentials or Models settings' : 'search connection settings (DSH Credentials)'
  return 'the API key stored for ' + ref + ' is malformed (it contains a line break or another control character); ask the user to re-enter it in ' + settings
}

export const searchErrors = capabilityErrors(SEARCH.packageName, 'search aborted')
export const searchError: (code: SearchErrorCode, message: string) => WebError = searchErrors.error
export const { aborted, abortable, throwIfAborted } = searchErrors
