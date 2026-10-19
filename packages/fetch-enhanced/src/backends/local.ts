/**
 * The local backend: fetch from this machine with DSH's official HTTP(S)
 * transport (`HttpFetchProvider` from `@deepseek-ai/dsh-web-fetch-http`),
 * using the native `web-fetch-http` row's default limits.
 *
 * This is the only fetch backend that reaches targets over HTTP itself, so it
 * is the only one that checks target addresses. M0 is exact native parity:
 * public destinations only. The fetch alignment milestone ports the
 * dsh-web-fetch-enhanced 0.1 allowlist as this connection's operator options —
 * an IP-literal pre-check and an injected resolver that validates the whole
 * DNS answer set against CIDR and hostname rules. With an empty allowlist it
 * stays identical to this one.
 */
import type { WebFetchProvider } from '@deepseek-ai/dsh-web'
import { DEFAULT_USER_AGENT, HttpFetchProvider, type HttpFetchLimits } from '@deepseek-ai/dsh-web-fetch-http'

/** Defaults of the native `web-fetch-http` row. */
export const NATIVE_LIMITS: HttpFetchLimits = {
  maxResponseBytes: 5_000_000,
  maxBodyChars: 100_000,
  timeoutMs: 30_000,
  maxRedirects: 5,
  userAgent: DEFAULT_USER_AGENT,
}

/**
 * @param limits - transport and size limits.
 * @returns the official transport, public destinations only.
 */
export function localBackend(limits: HttpFetchLimits = NATIVE_LIMITS): WebFetchProvider {
  return new HttpFetchProvider(limits)
}
