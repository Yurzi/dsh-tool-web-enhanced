import { describe, expect, it } from 'vitest'
import type { AllowlistRules } from '../src/local/address-policy.ts'
import { allowlistNotice } from '../src/prompt.ts'

/** The system prompt's wording; list_web_fetch_providers words the same rules for "this provider". */
const systemNotice = (rules: AllowlistRules) => allowlistNotice(rules, 'web_fetch')

describe('operator allowlist notice', () => {
  it('is empty without CIDRs, even with hostname restrictions', () => {
    expect(systemNotice({ allowCidrs: [], allowHostnames: ['internal.test'] })).toBe('')
  })

  it('preserves the predecessor wording and all remaining safety checks', () => {
    expect(systemNotice({ allowCidrs: ['198.18.0.0/15'], allowHostnames: [] })).toBe(
      'The operator has authorized web_fetch to reach non-public addresses within [198.18.0.0/15]. All other URL, DNS, redirect, and transport safety checks still apply.',
    )
  })

  it('canonicalizes and deduplicates large whitespace-padded rule sets', () => {
    const cidr = ` ${' '.repeat(1970)}198.18.0.0/15 `
    const hostname = ` ${' '.repeat(1970)}Wiki.Example.COM. `
    const notice = systemNotice({ allowCidrs: Array.from({ length: 200 }, () => cidr), allowHostnames: Array.from({ length: 200 }, () => hostname) })
    expect(notice).toBe(systemNotice({ allowCidrs: ['198.18.0.0/15'], allowHostnames: ['wiki.example.com'] }))
    expect(notice.length).toBeLessThanOrEqual(2000)
  })

  it('uses canonical IPv6, wildcard and international hostname forms', () => {
    const notice = systemNotice({ allowCidrs: [' FD00:0000::/8 ', 'fd00::/8'], allowHostnames: [' *.Example.COM. ', '*.example.com', 'BÜCHER.test', 'xn--bcher-kva.test', '[0:0::1]', '::1'] })
    expect(notice).toContain('within [fd00::/8]')
    expect(notice).toContain('matches [*.example.com, xn--bcher-kva.test, ::1]')
  })

  it('bounds unique long rules without losing hostname restrictions or implying a complete list', () => {
    const allowCidrs = Array.from({ length: 200 }, (_, index) => `10.${index}.0.0/16`)
    const allowHostnames = Array.from({ length: 200 }, (_, index) => `${index}.${'a'.repeat(1900)}.test`)
    const notice = systemNotice({ allowCidrs, allowHostnames })
    expect(notice.length).toBeLessThanOrEqual(2000)
    expect(notice).toContain('200 CIDR ranges and 200 hostname rules')
    expect(notice).toContain('see the fetch settings page')
    expect(notice).toContain('Only URLs whose hostname matches a configured hostname rule')
    expect(notice).toContain('partial list')
    expect(notice).toContain('All other URL, DNS, redirect, and transport safety checks still apply.')
  })

  it('summarizes CIDR-only exceptions without inventing hostname restrictions', () => {
    const allowCidrs = Array.from({ length: 200 }, (_, index) => `10.${index}.0.0/16`)
    const notice = systemNotice({ allowCidrs, allowHostnames: [] })
    expect(notice.length).toBeLessThanOrEqual(2000)
    expect(notice).toContain('200 CIDR ranges and 0 hostname rules')
    expect(notice).not.toContain('Only URLs')
    expect(notice).toContain('CIDR examples (partial list): [10.0.0.0/16,')
    expect(notice).toMatch(/\/16\]\.$/)
  })

  it('counts canonical distinct rules in a bounded summary and preserves whole hostname examples', () => {
    const cidrs = Array.from({ length: 100 }, (_, index) => `10.${index}.0.0/16`)
    const hostnames = Array.from({ length: 100 }, (_, index) => `host${index}.example.test`)
    const notice = systemNotice({ allowCidrs: [...cidrs, ...cidrs.map(rule => ` ${rule} `)], allowHostnames: [...hostnames, ...hostnames.map(rule => ` ${rule.toUpperCase()}. `)] })
    expect(notice.length).toBeLessThanOrEqual(2000)
    expect(notice).toContain('100 CIDR ranges and 100 hostname rules')
    expect(notice).toContain('Hostname examples (partial list): [host0.example.test,')
    expect(notice).toMatch(/example\.test\]\.$/)
  })

  it('does not hide malformed rules while building the notice', () => {
    expect(() => systemNotice({ allowCidrs: ['not-a-cidr'], allowHostnames: [] })).toThrow()
    expect(() => systemNotice({ allowCidrs: ['10.0.0.0/8'], allowHostnames: ['https://example.com'] })).toThrow()
  })

  it('explains optional hostname narrowing without treating hostnames as permissions', () => {
    expect(systemNotice({ allowCidrs: ['10.0.0.0/8', 'fd00::/8'], allowHostnames: ['internal.test', '*.svc.test'] })).toBe(
      'The operator has authorized web_fetch to reach non-public addresses within [10.0.0.0/8, fd00::/8]. Only URLs whose hostname matches [internal.test, *.svc.test] may use these exceptions. All other URL, DNS, redirect, and transport safety checks still apply.',
    )
  })

  it('names the subject the listing gives it, in the full and the summarized form', () => {
    expect(allowlistNotice({ allowCidrs: ['10.0.0.0/8'], allowHostnames: ['internal.test'] }, 'this provider')).toBe(
      'The operator has authorized this provider to reach non-public addresses within [10.0.0.0/8]. Only URLs whose hostname matches [internal.test] may use these exceptions. All other URL, DNS, redirect, and transport safety checks still apply.',
    )
    const allowCidrs = Array.from({ length: 200 }, (_, index) => `10.${index}.0.0/16`)
    const summary = allowlistNotice({ allowCidrs, allowHostnames: [] }, 'this provider')
    expect(summary).toMatch(/^The operator has authorized this provider exceptions described by 200 CIDR ranges/u)
    expect(summary.length).toBeLessThanOrEqual(2000)
  })
})
