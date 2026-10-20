import type { LookupAddress } from 'node:dns'
import ipaddr from 'ipaddr.js'
import { describe, expect, it, vi } from 'vitest'
import { AddressPolicy } from '../src/local/backend.ts'
import { type AddressLookup, resolveAllowedAddresses } from '../src/local/resolver.ts'

const signal = () => new AbortController().signal
const policy = (allowCidrs: string[] = [], allowHostnames: string[] = []) => new AddressPolicy({ allowCidrs, allowHostnames })
const answers = (...entries: LookupAddress[]): AddressLookup => vi.fn(async () => entries)

describe('resolveAllowedAddresses', () => {
  it('returns the whole validated answer set', async () => {
    await expect(resolveAllowedAddresses('fake.test', signal(), policy(['198.18.0.0/15']),
      answers({ address: '93.184.216.34', family: 4 }, { address: '198.18.20.30', family: 4 })))
      .resolves.toEqual([{ address: '93.184.216.34', family: 4 }, { address: '198.18.20.30', family: 4 }])
  })

  it('accepts localhost resolving to both loopback addresses when both are allowed', async () => {
    await expect(resolveAllowedAddresses('localhost', signal(), policy(['127.0.0.0/8', '::1/128']),
      answers({ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 })))
      .resolves.toHaveLength(2)
  })

  it('refuses the whole set when any answer is outside the allowlist', async () => {
    await expect(resolveAllowedAddresses('mixed.test', signal(), policy(),
      answers({ address: '93.184.216.34', family: 4 }, { address: '10.0.0.2', family: 4 })))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })

  it('checks an IPv4 literal without DNS', async () => {
    const lookup = vi.fn<AddressLookup>()
    await expect(resolveAllowedAddresses('127.0.0.1', signal(), policy(['127.0.0.1/32']), lookup))
      .resolves.toEqual([{ address: '127.0.0.1', family: 4 }])
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects empty and malformed answers as provider errors', async () => {
    await expect(resolveAllowedAddresses('empty.test', signal(), policy(), answers()))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(resolveAllowedAddresses('family.test', signal(), policy(), answers({ address: '8.8.8.8', family: 6 })))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('checks the IPv4 address an active NAT64 prefix translates to', async () => {
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [{ address: '2001:4860:64::c000:aa', family: 6 }]
      : [{ address: '2001:4860:64::c0a8:101', family: 6 }]
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: 'The destination is outside the local allowlist. Ask the operator to review it.' })
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(['192.168.0.0/16']), lookup))
      .resolves.toHaveLength(1)
  })

  it.each([32, 40, 48, 56, 64, 96])('checks RFC 6052 /%i translation for all discovered prefixes', async length => {
    const embed = (ipv4: readonly number[]) => {
      const bytes = [0x20, 0x01, 0x48, 0x60, ...Array<number>(12).fill(0)]
      let position = length / 8
      for (const octet of ipv4) {
        if (position === 8) position++
        bytes[position++] = octet
      }
      return new ipaddr.IPv6(bytes).toString()
    }
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [{ address: embed([192, 0, 0, 170]), family: 6 }]
      : [{ address: embed([10, 0, 0, 1]), family: 6 }]
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
    await expect(resolveAllowedAddresses('nat64.test', signal(), policy(['10.0.0.1/32']), lookup))
      .resolves.toHaveLength(1)
  })

  it('fails closed without exposing NAT64 discovery errors', async () => {
    const lookup: AddressLookup = async hostname => {
      if (hostname === 'ipv4only.arpa') throw new Error('secret discovery details')
      return [{ address: '2001:4860:4860::8888', family: 6 }]
    }
    await expect(resolveAllowedAddresses('public.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Unable to resolve the destination. Check DNS and try again.' })
  })

  it('checks every overlapping NAT64 prefix, not the first match', async () => {
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [
          // As /32 the target embeds public 8.8.8.8; as /96 it embeds loopback.
          { address: '2001:4860:c000:aa::', family: 6 },
          { address: '2001:4860:808:808::c000:aa', family: 6 },
        ]
      : [{ address: '2001:4860:808:808::7f00:1', family: 6 }]
    await expect(resolveAllowedAddresses('overlap.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL', message: 'The destination is outside the local allowlist. Ask the operator to review it.' })
  })

  it('does not start DNS for an already cancelled request or accept an IPv4 literal', async () => {
    const controller = new AbortController()
    controller.abort('cancelled')
    const lookup = vi.fn<AddressLookup>()
    await expect(resolveAllowedAddresses('cancelled.test', controller.signal, policy(), lookup)).rejects.toThrow('aborted')
    await expect(resolveAllowedAddresses('8.8.8.8', controller.signal, policy(), lookup)).rejects.toThrow('aborted')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects invalid IPv6 answers before starting discovery', async () => {
    const lookup = answers({ address: 'not an address', family: 6 })
    await expect(resolveAllowedAddresses('invalid.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('ignores malformed discovery entries as upstream does', async () => {
    const lookup: AddressLookup = async hostname => hostname === 'ipv4only.arpa'
      ? [{ address: 'malformed', family: 6 }, { address: '8.8.8.8', family: 6 }]
      : [{ address: '2001:4860:4860::8888', family: 6 }]
    await expect(resolveAllowedAddresses('public.test', signal(), policy(), lookup)).resolves.toHaveLength(1)
  })

  it('does not expose resolver failures or retry them', async () => {
    const lookup = vi.fn<AddressLookup>().mockRejectedValue(new Error('secret DNS details'))
    await expect(resolveAllowedAddresses('failed.test', signal(), policy(), lookup))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Unable to resolve the destination. Check DNS and try again.' })
    expect(lookup).toHaveBeenCalledTimes(1)
  })

  it('cancels while NAT64 discovery is pending', async () => {
    const controller = new AbortController()
    let discoveryStarted!: () => void
    const started = new Promise<void>(resolve => { discoveryStarted = resolve })
    const lookup: AddressLookup = hostname => {
      if (hostname !== 'ipv4only.arpa') return Promise.resolve([{ address: '2001:4860:4860::8888', family: 6 }])
      discoveryStarted()
      return new Promise(() => {})
    }
    const pending = resolveAllowedAddresses('public.test', controller.signal, policy(), lookup)
    await started
    controller.abort('cancelled')
    await expect(pending).rejects.toThrow('aborted during hostname resolution')
  })

  it('stops waiting for DNS once the request is cancelled', async () => {
    const controller = new AbortController()
    const pending = resolveAllowedAddresses('slow.test', controller.signal, policy(), () => new Promise(() => {}))
    controller.abort('cancelled')
    await expect(pending).rejects.toThrow('aborted during hostname resolution')
  })
})
