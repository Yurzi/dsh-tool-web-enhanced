import { WebError } from '@deepseek-ai/dsh-web'

/** Restate a native provider failure using only capability-owned public messages. */
export function restateNative(messages: Readonly<Record<string, string>> & { readonly WEB_PROVIDER_ERROR: string }, prefix = ''): (error: unknown) => WebError {
  return error => {
    const code = error instanceof WebError && Object.hasOwn(messages, error.code) ? error.code : 'WEB_PROVIDER_ERROR'
    return new WebError(prefix + messages[code], code)
  }
}

/** Common native call boundary; capability adapters supply result normalization and diagnostics. */
export function nativeBackend<Q, R>(
  upstream: { readonly id: string; available(): boolean },
  invoke: (request: Q, signal?: AbortSignal) => Promise<R>,
  restate: (error: unknown) => WebError,
  onDiagnostic?: (error: unknown) => void,
) {
  return {
    id: upstream.id,
    available: () => upstream.available(),
    async execute(this: void, request: Q, signal?: AbortSignal): Promise<R> {
      try {
        return await invoke(request, signal)
      } catch (error) {
        if (onDiagnostic !== undefined) onDiagnostic(error)
        throw restate(error)
      }
    },
  }
}
