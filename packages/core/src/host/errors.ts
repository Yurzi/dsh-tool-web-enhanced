import { WebError } from '@deepseek-ai/dsh-web'

export type CapabilityErrorCode =
  | 'WEB_PROVIDER_ERROR' | 'WEB_ABORTED' | 'WEB_PROVIDER_CREDENTIAL_MISSING'
  | 'WEB_PROVIDER_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' | 'WEB_PROVIDER_CONFIGURED_MISSING'
  | 'WEB_PROVIDER_AMBIGUOUS' | 'WEB_DUPLICATE_PROVIDER'
  | 'WEB_INVALID_URL' | 'WEB_BLOCKED_URL' | 'WEB_REDIRECT_BLOCKED'
  | 'WEB_FETCH_TIMEOUT' | 'WEB_FETCH_TOO_LARGE' | 'WEB_UNSUPPORTED_CONTENT_TYPE'

/** Host-only diagnostics; never attach these causes to model-facing WebErrors. */
export type OnDiagnostic = (cause: unknown) => void

export interface CapabilityErrors {
  readonly error: (code: CapabilityErrorCode, message: string) => WebError
  readonly aborted: () => WebError
  readonly abortable: <T>(pending: Promise<T>, signal: AbortSignal | undefined) => Promise<T>
  readonly throwIfAborted: (signal: AbortSignal | undefined) => void
}

export function capabilityErrors(prefix: string, abortedMessage = 'request aborted'): CapabilityErrors {
  function error(code: CapabilityErrorCode, message: string): WebError {
    return new WebError(prefix + ': ' + message, code)
  }

  const aborted = (): WebError => error('WEB_ABORTED', abortedMessage)

  function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal !== undefined && signal.aborted) throw aborted()
  }

  // Observe both outcomes even when cancellation wins, without retaining pending work.
  function abortable<T>(pending: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    if (signal === undefined) return pending
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => { reject(aborted()) }
      pending.then(
        value => { signal.removeEventListener('abort', onAbort); resolve(value) },
        (cause: unknown) => { signal.removeEventListener('abort', onAbort); reject(cause) },
      )
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  return { error, aborted, abortable, throwIfAborted }
}
