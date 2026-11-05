/**
 * Opt-in address preflight followed by DSH's official HTTP provider.
 * Empty rule lists keep upstream any-address behaviour. Filtered requests check
 * the initial destination only; the provider may resolve it again and owns
 * redirects, proxy transport, decoding and response limits. No address pinning.
 */
import { isIP } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { WebError, type WebFetchProvider, type WebFetchRequest, type WebFetchResult } from '@deepseek-ai/dsh-web'
import { HttpFetchProvider } from '@deepseek-ai/dsh-web-fetch-http'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { AddressPolicy } from './address-policy.ts'
import { resolveAllowedAddresses } from './resolver.ts'
import { hasAllowlistRules, stripIpv6Brackets } from './rules.ts'
import type { LocalSettings } from '../settings/types.ts'

export { AddressPolicy, isPublicAddress, type AllowlistRules } from './address-policy.ts'
export type { LocalSettings } from '../settings/types.ts'

/**
 * @param read - returns the settings for the next request; called once per request.
 * @returns the official local provider, with optional initial address preflight.
 */
export function createLocalBackend(read: () => LocalSettings, logger: Pick<Context['logger'], 'debug'> = new Context().logger): WebFetchProvider {
  return {
    id: 'local',
    available: () => true,
    async fetch(request, signal) {
      try {
        if (signal !== undefined && signal.aborted) throw cancelled()
        const settings = read()
        // Validate before testing for empty rules: invalid settings must never disable filtering.
        const policy = new AddressPolicy(settings)
        const provider = new HttpFetchProvider(settings)
        if (!hasAllowlistRules(settings)) return await provider.fetch(request, signal)
        return await fetchAfterPreflight(provider, settings, policy, request, signal)
      } catch (error: unknown) {
        if (error instanceof WebError) throw error
        logger.debug('Local fetch failed', error)
        throw new WebError(FETCH.packageName + ': The local fetch failed. Check the URL and local connection settings.', 'WEB_PROVIDER_ERROR')
      }
    },
  }
}

async function fetchAfterPreflight(
  provider: HttpFetchProvider,
  settings: LocalSettings,
  policy: AddressPolicy,
  request: WebFetchRequest,
  signal: AbortSignal | undefined,
): Promise<WebFetchResult> {
  const timeout = new AbortController()
  const timer = setTimeout(() => { timeout.abort() }, settings.timeoutMs)
  const combined = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  try {
    const url = preflightUrl(request.url)
    if (url !== undefined) {
      // A proxy resolves hostnames itself. Literals still get the opt-in policy check.
      if (isIP(stripIpv6Brackets(url.hostname)) !== 0 || !proxyRouteFor(url).proxied) {
        await resolveAllowedAddresses(url.hostname, combined, policy)
      }
    }
    combined.throwIfAborted()
    return await provider.fetch(request, combined)
  } catch (error: unknown) {
    if (signal !== undefined && signal.aborted) throw cancelled()
    if (timeout.signal.aborted) {
      throw new WebError(FETCH.packageName + ': The local fetch timed out.', 'WEB_FETCH_TIMEOUT')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function preflightUrl(input: string): URL | undefined {
  // Match rc.1 validateFetchUrl's network-independent checks without importing private policy code.
  // Invalid input goes straight to the provider for its original URL error, never to DNS.
  if (input.length > 2048) return undefined
  const url = URL.parse(input)
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || url.username !== '' || url.password !== '') return undefined
  return url
}

function cancelled(): WebError {
  return new WebError(FETCH.packageName + ': The local fetch was cancelled.', 'WEB_ABORTED')
}
