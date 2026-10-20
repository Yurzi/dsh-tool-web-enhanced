import type { WebError } from '@deepseek-ai/dsh-web'
import { capabilityErrors, type CapabilityErrorCode } from 'dsh-tool-web-enhanced-core/host'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'

export type { OnDiagnostic } from 'dsh-tool-web-enhanced-core/host'

export const fetchErrors = capabilityErrors(FETCH.packageName, 'fetch aborted')
export const fetchError: (code: CapabilityErrorCode, message: string) => WebError = fetchErrors.error
