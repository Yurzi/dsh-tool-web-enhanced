/**
 * Grammar of the local provider's allowlist rules. The Host policy and the
 * settings page parse with this one module, so a line the page accepts is a
 * line the Host accepts, and a refused line can be explained and corrected
 * in the browser instead of failing a save.
 */
import ipaddr from 'ipaddr.js'

/** A parsed IPv4 or IPv6 address. */
export type IpAddress = ipaddr.IPv4 | ipaddr.IPv6

/** A CIDR written as its network base address. */
export interface Cidr {
  readonly network: IpAddress
  readonly prefixLength: number
}

/** An exact hostname, or a left-most wildcard matching strict subdomains of `suffix`. */
export type HostnameRule =
  | { readonly kind: 'exact'; readonly hostname: string }
  | { readonly kind: 'suffix'; readonly suffix: string }

/** Why a rule line is refused; `fix` is the corrected line when exactly one is meant. */
export type RuleProblem =
  /** Not a CIDR or hostname at all. */
  | { readonly code: 'syntax' }
  /** IPv4 written in a form other than four decimal octets, such as `010.0.0.0/8` or `10.1/16`. */
  | { readonly code: 'ipv4-form' }
  /** An IPv6 zone id such as `%eth0`, which no destination address carries. */
  | { readonly code: 'zone' }
  /** An IPv4-mapped or IPv4-compatible IPv6 CIDR; addresses are matched as IPv4. */
  | { readonly code: 'mapped'; readonly fix?: string }
  /** Host bits set below the prefix; the rule must name its network address. */
  | { readonly code: 'host-bits'; readonly fix: string }
  /** A `*` anywhere but a whole left-most label. */
  | { readonly code: 'wildcard' }
  /** A wildcard over an IP address. */
  | { readonly code: 'wildcard-ip' }
  /** A URL, path, or port where a bare hostname belongs. */
  | { readonly code: 'not-hostname'; readonly fix: string }

/** Accepted CIDRs that deserve a second look before they widen reachability. */
export type CidrWarning =
  /** A public range: public addresses are reachable without any rule. */
  | 'public'
  /** Shorter than /8 (IPv4) or /16 (IPv6). */
  | 'broad'
  /** Includes this machine's loopback address. */
  | 'loopback'
  /** Includes the cloud instance metadata endpoint. */
  | 'metadata'

/** Outcome of parsing one rule line. */
export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: RuleProblem }

const DECIMAL_IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const PREFIX = /^(?:0|[1-9]\d*)$/
const LOOPBACK = parseRanges(['127.0.0.0/8', '::1/128'])
const METADATA = parseRanges(['169.254.169.254/32', 'fd00:ec2::254/128'])
// Union of ipaddr.js 2.5's non-unicast ranges (nested ranges are redundant).
// Keep this aligned with range(), which the destination policy uses. Inspecting
// only the rule's base or endpoints misses special ranges inside a larger CIDR.
const NON_PUBLIC = parseRanges([
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
  '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '192.0.0.0/24', '192.0.2.0/24', '192.88.99.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '192.175.48.0/24', '192.31.196.0/24', '192.52.193.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
  '::/128', '::1/128', '::ffff:0:0/96', 'fe80::/10', 'ff00::/8',
  'fc00::/7', 'fec0::/10', '100::/64', '::ffff:0:0:0/96',
  '64:ff9b::/96', '64:ff9b:1::/48', '2002::/16',
  '2001::/23', '2001:db8::/32', '2620:4f:8000::/48',
  '5f00::/16', '3fff::/20',
])

/**
 * Parse one CIDR rule.
 * @param input - one line as typed; surrounding whitespace is ignored.
 * @returns the CIDR, or why it is refused.
 */
export function parseCidr(input: string): ParseResult<Cidr> {
  const [address = '', prefix, ...extra] = input.trim().split('/')
  if (prefix === undefined || extra.length > 0 || !PREFIX.test(prefix)) return refuse('syntax')
  if (address.includes('%')) return refuse('zone')
  const prefixLength = Number(prefix)
  let network: IpAddress
  if (address.includes(':')) {
    if (!ipaddr.IPv6.isValid(address) || prefixLength > 128) return refuse('syntax')
    network = ipaddr.IPv6.parse(address)
    const bytes = network.toByteArray()
    const compatible = network.range() !== 'unspecified' && network.range() !== 'loopback' && bytes.slice(0, 12).every(byte => byte === 0)
    if (network.isIPv4MappedAddress() || compatible) {
      const fix = prefixLength >= 96 ? `${new ipaddr.IPv4(bytes.slice(12)).toString()}/${prefixLength - 96}` : undefined
      return { ok: false, problem: fix === undefined ? { code: 'mapped' } : { code: 'mapped', fix } }
    }
  } else {
    if (!DECIMAL_IPV4.test(address)) return refuse(ipaddr.IPv4.isValid(address) ? 'ipv4-form' : 'syntax')
    if (prefixLength > 32) return refuse('syntax')
    network = ipaddr.IPv4.parse(address)
  }
  const base = network.kind() === 'ipv4'
    ? ipaddr.IPv4.networkAddressFromCIDR(`${address}/${prefixLength}`)
    : ipaddr.IPv6.networkAddressFromCIDR(`${address}/${prefixLength}`)
  if (base.toString() !== network.toString()) {
    return { ok: false, problem: { code: 'host-bits', fix: `${base.toString()}/${prefixLength}` } }
  }
  return { ok: true, value: { network, prefixLength } }
}

/**
 * Parse one hostname rule: an exact hostname, an IP literal, or `*.` plus a hostname.
 * @param input - one line as typed; surrounding whitespace is ignored.
 * @returns the normalized rule, or why it is refused.
 */
export function parseHostnameRule(input: string): ParseResult<HostnameRule> {
  const source = input.trim()
  if (source.startsWith('*.')) {
    const base = source.slice(2)
    if (base.includes('*')) return refuse('wildcard')
    const parsed = parseHostname(base)
    if (!parsed.ok) return parsed
    if (isIpLiteral(parsed.value)) return refuse('wildcard-ip')
    return { ok: true, value: { kind: 'suffix', suffix: `.${parsed.value}` } }
  }
  if (source.includes('*')) return refuse('wildcard')
  const parsed = parseHostname(source)
  return parsed.ok ? { ok: true, value: { kind: 'exact', hostname: parsed.value } } : parsed
}

/**
 * Notes about an accepted CIDR that widens reachability more than its author may intend.
 * @param cidr - an accepted rule.
 * @returns every warning that applies, most severe first.
 */
export function cidrWarnings(cidr: Cidr): CidrWarning[] {
  const intersects = (targets: readonly Cidr[]) => targets.some(target => intersectsCidr(target, cidr))
  const warnings: CidrWarning[] = []
  if (intersects(METADATA)) warnings.push('metadata')
  if (intersects(LOOPBACK)) warnings.push('loopback')
  if (cidr.prefixLength < (cidr.network.kind() === 'ipv4' ? 8 : 16)) warnings.push('broad')
  else if (!intersects(NON_PUBLIC)) warnings.push('public')
  return warnings
}

/**
 * Whether an address lies inside a CIDR of the same family.
 * @param address - the parsed address.
 * @param cidr - the rule.
 * @returns true for a match.
 */
export function matchesCidr(address: IpAddress, cidr: Cidr): boolean {
  return address.kind() === cidr.network.kind() && address.match(cidr.network, cidr.prefixLength)
}

/**
 * Normalize a URL hostname for rule comparison: no IPv6 brackets, no trailing
 * dot, lower case, and IP literals in canonical form.
 * @param hostname - `URL.hostname` or a rule's host part.
 * @returns the comparable form.
 */
export function normalizeHost(hostname: string): string {
  const host = stripIpv6Brackets(hostname).replace(/\.$/, '').toLowerCase()
  return ipaddr.IPv6.isValid(host) ? ipaddr.IPv6.parse(host).toString() : host
}

/** WHATWG URL keeps brackets around an IPv6 hostname; address parsers do not. */
export function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

/** English diagnostic for an invalid operator rule. */
export function describeProblem(problem: RuleProblem): string {
  switch (problem.code) {
    case 'syntax': return 'is not valid'
    case 'ipv4-form': return 'must write IPv4 as four decimal octets'
    case 'zone': return 'must not carry an IPv6 zone id'
    case 'mapped': return `is IPv4-mapped; write the IPv4 CIDR${problem.fix === undefined ? '' : ` ${problem.fix}`}`
    case 'host-bits': return `must name its network address ${problem.fix}`
    case 'wildcard': return 'may use * only as the whole left-most label'
    case 'wildcard-ip': return 'cannot wildcard an IP address'
    case 'not-hostname': return `must be a bare hostname such as ${problem.fix}`
  }
}

function parseHostname(source: string): ParseResult<string> {
  if (source === '' || /[\s@\\]/.test(source)) return refuse('syntax')
  const bare = stripIpv6Brackets(source)
  if (bare.includes('%')) return refuse('zone')
  if (DECIMAL_IPV4.test(bare)) return { ok: true, value: bare }
  if (ipaddr.IPv6.isValid(bare)) {
    // Only forms a URL can carry: the URL parser refuses, for example, a zero-padded IPv4 tail.
    const url = URL.parse(`http://[${bare}]/`)
    return url === null ? refuse('syntax') : { ok: true, value: normalizeHost(url.hostname) }
  }
  // A URL, a path, or a port: offer the hostname it names.
  if (/[/:?#]/.test(source)) {
    const url = URL.parse(/^[a-z][a-z\d+.-]*:\/\//i.test(source) ? source : `http://${source}`)
    if (url === null || url.hostname === '') return refuse('syntax')
    return { ok: false, problem: { code: 'not-hostname', fix: normalizeHost(url.hostname) } }
  }
  const url = URL.parse(`http://${source}/`)
  return url === null || url.hostname === '' ? refuse('syntax') : { ok: true, value: normalizeHost(url.hostname) }
}

function parseRanges(rules: readonly string[]): Cidr[] {
  return rules.map(rule => {
    const [network, prefixLength] = ipaddr.parseCIDR(rule)
    return { network, prefixLength }
  })
}

function intersectsCidr(left: Cidr, right: Cidr): boolean {
  return left.network.kind() === right.network.kind()
    && left.network.match(right.network, Math.min(left.prefixLength, right.prefixLength))
}

function isIpLiteral(host: string): boolean {
  return DECIMAL_IPV4.test(host) || ipaddr.IPv6.isValid(host)
}

function refuse(code: 'syntax' | 'ipv4-form' | 'zone' | 'wildcard' | 'wildcard-ip'): { ok: false; problem: RuleProblem } {
  return { ok: false, problem: { code } }
}
