import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { resolveDocument } from '../src/shared/settings.ts'

const CATALOG = {
  service: { kind: 'adapter', label: 'Service', remote: true, optIn: false, endpoint: 'https://service.example/api', access: { keyless: true, apiKey: { credentialRef: 'SERVICE_KEY' }, account: false }, options: {} },
} as const
const PROTOCOLS = { messages: { label: 'Messages', options: {} } } as const
const resolve = (document: unknown) => resolveDocument({ catalog: CATALOG, protocols: PROTOCOLS, document, defaults: { schema: z.strictObject({}), defaultConnection: 'builtin:service' }, capabilityLabel: 'labels' })
const custom = (label: string) => ({ kind: 'adapter', adapter: 'service', label, credentialRef: 'TEAM_KEY' })
const model = (label: string) => ({ kind: 'model', protocol: 'messages', model: 'm-1', label, credentialRef: 'FIXED_KEY', endpoint: 'https://fixed.example', trustedEndpoint: true })

// Labels reach error messages, the menu and the Agent's provider list; each must stay one line.
describe('connection labels are one line', () => {
  it.each([
    ['a line feed', 'Team\nExa', 'Team Exa'],
    ['a carriage return and tab', ' Team\r\n\tExa ', 'Team Exa'],
    ['Unicode line and paragraph separators', 'Team\u2028Exa\u2029Search', 'Team Exa Search'],
    ['other control characters and runs of spaces', 'Team\u0000\u0085  Exa\u000b', 'Team Exa'],
  ])('folds %s into single spaces for every kind of connection', (_, label, folded) => {
    const connections = resolve({ connections: { 'builtin:service': { label }, 'custom:team': custom(label), 'custom:fixed': model(label) } }).connections
    for (const id of ['builtin:service', 'custom:team', 'custom:fixed']) expect(connections.get(id)!.label, id).toBe(folded)
  })

  it('still refuses a label that has nothing but line breaks and spaces', () => {
    expect(() => resolve({ connections: { 'custom:team': custom('\n\u2028 \t') } })).toThrow('connections.custom:team')
    expect(() => resolve({ connections: { 'builtin:service': { label: '\r\n' } } })).toThrow('connections.builtin:service')
  })

  it('reads the document without rewriting it', () => {
    const document = Object.freeze({ connections: Object.freeze({ 'builtin:service': Object.freeze({ label: 'Team\nExa' }) }) })
    expect(resolve(document).connections.get('builtin:service')!.label).toBe('Team Exa')
    expect(document.connections['builtin:service'].label).toBe('Team\nExa')
  })
})
