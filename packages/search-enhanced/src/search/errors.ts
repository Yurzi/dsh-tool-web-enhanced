import type { WebError } from '@deepseek-ai/dsh-web'
import { capabilityErrors } from 'dsh-tool-web-enhanced-core/host'
import { SEARCH } from 'dsh-tool-web-enhanced-core/shared'

export type { OnDiagnostic } from 'dsh-tool-web-enhanced-core/host'

export type SearchErrorCode =
  | 'WEB_PROVIDER_ERROR' | 'WEB_ABORTED' | 'WEB_PROVIDER_CREDENTIAL_MISSING'
  | 'WEB_PROVIDER_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_MISSING'

export const searchErrors = capabilityErrors(SEARCH.packageName, 'search aborted')
export const searchError: (code: SearchErrorCode, message: string) => WebError = searchErrors.error
export const { aborted, abortable, throwIfAborted } = searchErrors
