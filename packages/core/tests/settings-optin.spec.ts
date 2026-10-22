import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { resolveDocument } from '../src/shared/settings.ts'

// One remote service the operator must turn on, one remote connection that starts on, and a local one.
const CATALOG = {
  local: { kind: 'local', label: 'Local', remote: false, optIn: false, access: { keyless: true, apiKey: false, account: false }, options: {} },
  service: { kind: 'adapter', label: 'Service', remote: true, optIn: true, endpoint: 'https://service.example/api', access: { keyless: true, apiKey: { credentialRef: 'SERVICE_KEY' }, account: false }, options: {} },
  messages: { kind: 'native', label: 'Messages', remote: true, optIn: false, endpoint: 'https://messages.example/v1', access: { keyless: false, apiKey: { credentialRef: 'MESSAGES_KEY' }, account: true }, options: {} },
} as const
const PROTOCOLS = { messages: { label: 'Messages', options: {} } } as const

const resolve = (document: unknown) => resolveDocument({ catalog: CATALOG, protocols: PROTOCOLS, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:local' }, capabilityLabel: 'opt-in' })
const disabledOf = (document: unknown, id: string) => resolve(document).connections.get(id)!.disabled
const custom = { kind: 'adapter', adapter: 'service', label: 'Team', credentialRef: 'TEAM_KEY' } as const
const model = { kind: 'model', protocol: 'messages', model: 'm-1', label: 'Fixed', credentialRef: 'FIXED_KEY', endpoint: 'https://fixed.example', trustedEndpoint: true } as const

describe('remote services start off', () => {
  it.each([
    ['a remote service', 'builtin:service', true],
    ['a remote connection that is not opt-in', 'builtin:messages', false],
    ['a local connection', 'builtin:local', false],
  ])('takes the catalog default for %s without an override', (_, id, disabled) => {
    expect(disabledOf({}, id)).toBe(disabled)
    // An override without the field is no override of it.
    expect(disabledOf({ connections: { [id]: { label: 'Renamed' } } }, id)).toBe(disabled)
  })

  it.each(['builtin:service', 'builtin:messages', 'builtin:local'])('uses a written disabled of %s whatever the catalog default', id => {
    expect(disabledOf({ connections: { [id]: { disabled: false } } }, id)).toBe(false)
    expect(disabledOf({ connections: { [id]: { disabled: true } } }, id)).toBe(true)
  })

  it('keeps operator-defined connections on, even on an opt-in adapter, unless they say otherwise', () => {
    const connections = { 'custom:team': custom, 'custom:fixed': model }
    expect(disabledOf({ connections }, 'custom:team')).toBe(false)
    expect(disabledOf({ connections }, 'custom:fixed')).toBe(false)
    expect(disabledOf({ connections: { 'custom:team': { ...custom, disabled: true }, 'custom:fixed': { ...model, disabled: true } } }, 'custom:team')).toBe(true)
    expect(disabledOf({ connections: { 'custom:fixed': { ...model, disabled: true } } }, 'custom:fixed')).toBe(true)
  })

  it('never rewrites the document it reads', () => {
    const document = Object.freeze({ connections: Object.freeze({ 'builtin:service': Object.freeze({ label: 'Service' }) }) })
    resolve(document)
    expect(document).toEqual({ connections: { 'builtin:service': { label: 'Service' } } })
  })

  it('accepts an opt-in service that is off as the default connection', () => {
    expect(resolve({ defaultConnection: 'builtin:service' })).toMatchObject({ defaultConnection: 'builtin:service' })
  })
})
