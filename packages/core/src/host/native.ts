import { WebError } from '@deepseek-ai/dsh-web'
import { upstreamText } from './transport.ts'
import { containsSecret, redactDiagnostic, redactJson, secretMatcher, type SecretMatcher } from './redaction.ts'

/** Keep safe service reports while replacing DSH's retired native-row settings guidance. */
export function restateNative(
  messages: Readonly<Record<string, string>> & { readonly WEB_PROVIDER_ERROR: string },
  prefix: string,
  unexpectedMessage: string,
): (error: unknown, matcher?: SecretMatcher, resolverFailed?: boolean) => WebError {
  return (error, matcher = secretMatcher([]), resolverFailed = false) => {
    if (!(error instanceof WebError)) return new WebError(prefix + unexpectedMessage, 'WEB_PROVIDER_ERROR')
    const code = Object.hasOwn(messages, error.code) ? error.code : 'WEB_PROVIDER_ERROR'
    const message = prefix + messages[code]
    if (code === 'WEB_PROVIDER_CREDENTIAL_MISSING' || code === 'WEB_ABORTED') return new WebError(message, code)
    if (resolverFailed) return new WebError(prefix + unexpectedMessage, code)
    // Inspect the whole first paragraph before bounding; never expose pieces of a sensitive report.
    const report = error.message.split(/\r?\n[ \t]*\r?\n/u, 1)[0]!
    if (containsSecret(report, matcher)) return new WebError(message + "\n\nDeepSeek's response was withheld because it contained this request's credential.", code)
    const detail = upstreamText(report)
    return new WebError(detail === undefined ? message : message + '\n\nDeepSeek responded (untrusted): ' + detail, code)
  }
}

/** Common native call boundary; capability adapters supply result normalization and diagnostics. */
export function nativeBackend<Q, R>(
  upstream: { readonly id: string; available(): boolean },
  invoke: (request: Q, signal?: AbortSignal) => Promise<R>,
  restate: (error: unknown, matcher?: SecretMatcher, resolverFailed?: boolean) => WebError,
  onDiagnostic?: (error: unknown) => void,
  secrets: Iterable<string> = [],
  resolverFailed: () => boolean = () => false,
) {
  return {
    id: upstream.id,
    available: () => upstream.available(),
    async execute(this: void, request: Q, signal?: AbortSignal): Promise<R> {
      let result: R
      try {
        result = await invoke(request, signal)
      } catch (error) {
        const matcher = secretMatcher(secrets)
        if (onDiagnostic !== undefined) onDiagnostic(redactDiagnostic(error, matcher))
        throw restate(error, matcher, resolverFailed())
      }
      return redactJson(result, secretMatcher(secrets))
    },
  }
}
