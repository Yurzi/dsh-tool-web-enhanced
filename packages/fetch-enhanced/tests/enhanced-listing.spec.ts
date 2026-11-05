/** The facts list_web_fetch_providers reads from settings: recipient and the local allowlist notice. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { fetchEnhanced } from '../src/tools/index.ts'
import { resolveSettings } from '../src/settings/resolve.ts'

function facts(document: unknown) {
  const enhanced = fetchEnhanced(new Context())
  const call = { agent: {} as Agent, signal: new AbortController().signal }
  return Object.fromEntries([...resolveSettings(document).connections.values()].map(connection => [connection.id, enhanced.listing(connection, call)]))
}

it('names who receives the URL, by hostname for an operator endpoint', () => {
  expect(facts({
    connections: {
      'builtin:deepseek-fetch-api': { trustedEndpoint: true, options: { baseURL: 'https://tools.proxy.example/v1/tools' } },
      'custom:docs': { kind: 'adapter', adapter: 'tinyfish', label: 'Docs', credentialRef: 'DOCS_KEY', endpoint: 'https://fetch.docs.example', trustedEndpoint: true },
      'custom:mirror': { kind: 'adapter', adapter: 'exa', label: 'Mirror', credentialRef: 'MIRROR_KEY' },
    },
  })).toEqual({
    'builtin:local': { use: undefined, recipient: { kind: 'this-machine' }, notice: expect.stringContaining('no plugin address filtering is enabled') },
    'builtin:deepseek-fetch-api': { use: undefined, recipient: { kind: 'service', service: 'DeepSeek Fetch API', host: 'tools.proxy.example' } },
    'builtin:exa': { use: undefined, recipient: { kind: 'service', service: 'Exa', host: undefined } },
    'builtin:firecrawl': { use: undefined, recipient: { kind: 'service', service: 'Firecrawl', host: undefined } },
    'builtin:tavily': { use: undefined, recipient: { kind: 'service', service: 'Tavily', host: undefined } },
    'builtin:tinyfish': { use: undefined, recipient: { kind: 'service', service: 'Tinyfish', host: undefined } },
    'builtin:anysearch': { use: undefined, recipient: { kind: 'service', service: 'AnySearch', host: undefined } },
    'custom:docs': { use: undefined, recipient: { kind: 'service', service: 'Tinyfish', host: 'fetch.docs.example' } },
    'custom:mirror': { use: undefined, recipient: { kind: 'service', service: 'Exa', host: undefined } },
  })
})

it('gives local the allowlist notice for "this provider" in default, hostname-only and CIDR modes', () => {
  const allowed = facts({ connections: { 'builtin:local': { options: { allowCidrs: ['10.0.0.0/8'], allowHostnames: ['*.corp.example'] } } } })
  expect(allowed['builtin:local']?.notice).toBe('The operator has authorized this provider to reach non-public addresses within [10.0.0.0/8]. Only URLs whose hostname matches [*.corp.example] may use these exceptions. This plugin checks the initial target only; upstream fetching may resolve DNS again and follow redirects without rechecking these rules. Proxy-resolved hostnames are governed by the proxy. Upstream URL, redirect, timeout, and size limits still apply.')
  const hostnamesOnly = facts({ connections: { 'builtin:local': { options: { allowHostnames: ['internal.test'] } } } })
  expect(hostnamesOnly['builtin:local']?.notice).toContain('only public addresses pass')
  expect(facts({})['builtin:local']?.notice).toContain('no plugin address filtering is enabled')
})
