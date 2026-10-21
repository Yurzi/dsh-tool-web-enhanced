/**
 * The local provider: fetch directly from this machine with DSH's official
 * HTTP transport, widening only its destination check. URL policy, redirects,
 * proxy routing, connection pinning, timeouts, and size limits are the
 * official `HttpFetchProvider`'s; this module supplies the resolver that
 * admits the operator's non-public exceptions.
 */
import { isIP } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { WebError, type WebFetchProvider } from '@deepseek-ai/dsh-web'
import { HttpFetchProvider, type HttpFetchResolver } from '@deepseek-ai/dsh-web-fetch-http'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { AddressPolicy } from './address-policy.ts'
import { resolveAllowedAddresses } from './resolver.ts'
import { stripIpv6Brackets } from './rules.ts'
import type { LocalSettings } from '../settings/types.ts'

export { AddressPolicy, isPublicAddress, type AllowlistRules } from './address-policy.ts'

export type { LocalSettings } from '../settings/types.ts'

/**
 * @param read - returns the settings for the next request; called once per request.
 * @returns the official local transport with current operator settings.
 */
export function createLocalBackend(read: () => LocalSettings, logger: Pick<Context['logger'], 'debug'> = new Context().logger): WebFetchProvider {
  return {
    id: 'local',
    available: () => true,
    async fetch(request, signal) {
      try {
        if (signal !== undefined && signal.aborted) throw new WebError(`${FETCH.packageName}: The local fetch was cancelled.`, 'WEB_ABORTED')
        const settings = read()
        const policy = new AddressPolicy(settings)
        assertLiteralAllowed(request.url, policy)
        const resolve: HttpFetchResolver = (hostname, abort) => resolveAllowedAddresses(hostname, abort, policy)
        return await new HttpFetchProvider(settings, resolve).fetch(request, signal)
      } catch (error: unknown) {
        if (error instanceof WebError) throw error
        logger.debug('Local fetch failed', error)
        throw new WebError(`${FETCH.packageName}: The local fetch failed. Check the URL and local connection settings.`, 'WEB_PROVIDER_ERROR')
      }
    },
  }
}

/**
 * Refuse a disallowed IP literal before the official transport sees it. That
 * transport hands IP literals it classifies as public straight to a
 * configured proxy without calling the resolver, and its classifier reads
 * IPv4-compatible IPv6 such as `[::7f00:1]` as public. Redirects are followed
 * only within one origin, so the request URL's host is every hop's host.
 * @param url - the requested URL; an unparseable one is left to the transport to reject.
 * @param policy - the allowlist in force.
 */
function assertLiteralAllowed(url: string, policy: AddressPolicy): void {
  const parsed = URL.parse(url)
  // Native URL validation runs before transport; do not mask its credential/scheme errors.
  if (parsed === null || parsed.username !== '' || parsed.password !== '' || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return
  const hostname = parsed.hostname
  if (isIP(stripIpv6Brackets(hostname)) === 0 || policy.allows(hostname, hostname)) return
  throw new WebError(`${FETCH.packageName}: The destination is outside the local allowlist. Ask the operator to review it.`, 'WEB_BLOCKED_URL')
}
