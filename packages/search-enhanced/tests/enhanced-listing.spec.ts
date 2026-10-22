/** The facts list_web_search_providers reads from settings: use, recipient and freshness support. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import { afterEach, expect, it } from 'vitest'
import { searchEnhanced } from '../src/tools/index.ts'
import { resolveSettings } from '../src/settings/resolve.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup()
})

async function facts(document: unknown) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.fiber.await()
  const handle = await ctx.agents.create({ sessionId: SessionId('s'), agentOptions: { provider: 'anthropic', model: 'claude-x' } })
  cleanups.push(() => handle.dispose())
  const { agent } = handle
  const enhanced = searchEnhanced(ctx)
  const settings = resolveSettings(document)
  return Object.fromEntries([...settings.connections.values()].map(connection => [connection.id, enhanced.listing(connection, { agent, signal: new AbortController().signal })]))
}

it('gives catalog uses, recipients and freshness support by the current access', async () => {
  const listed = await facts({
    connections: {
      'builtin:exa': { access: 'api-key', disabled: false },
      'builtin:firecrawl': { disabled: false },
      'custom:lab': { kind: 'adapter', adapter: 'tavily', label: 'Lab Tavily', credentialRef: 'LAB_KEY', endpoint: 'https://search.lab.example/search', trustedEndpoint: true },
      'custom:papers': { kind: 'adapter', adapter: 'openalex', label: 'Papers', credentialRef: 'PAPERS_KEY' },
      'custom:fixed': { kind: 'model', protocol: 'openai-responses', model: 'gpt-x', label: 'Fixed', credentialRef: 'FIXED_KEY', endpoint: 'https://llm.example:8443/v1', trustedEndpoint: true },
    },
  })
  expect(listed).toEqual({
    'builtin:deepseek-messages': { use: 'answers with a summary and sources', recipient: { kind: 'service', service: 'DeepSeek Messages', host: undefined }, appliesFreshness: false },
    'builtin:deepseek-search-api': { use: undefined, recipient: { kind: 'service', service: 'DeepSeek Search API', host: undefined }, appliesFreshness: false },
    'builtin:session-model': { use: 'the session model searches and answers', recipient: { kind: 'session-model', provider: 'anthropic' }, appliesFreshness: false },
    'builtin:exa': { use: undefined, recipient: { kind: 'service', service: 'Exa', host: undefined }, appliesFreshness: true },
    'builtin:firecrawl': { use: undefined, recipient: { kind: 'service', service: 'Firecrawl', host: undefined }, appliesFreshness: true },
    'builtin:tavily': { use: undefined, recipient: { kind: 'service', service: 'Tavily', host: undefined }, appliesFreshness: false },
    'builtin:tinyfish': { use: undefined, recipient: { kind: 'service', service: 'Tinyfish', host: undefined }, appliesFreshness: false },
    'builtin:openalex': { use: 'scholarly works (papers, citations); keyword queries', recipient: { kind: 'service', service: 'OpenAlex', host: undefined }, appliesFreshness: false },
    'builtin:semanticscholar': { use: 'academic papers (citations, TL;DR); keyword queries', recipient: { kind: 'service', service: 'Semantic Scholar', host: undefined }, appliesFreshness: false },
    'custom:lab': { use: undefined, recipient: { kind: 'service', service: 'Tavily', host: 'search.lab.example' }, appliesFreshness: false },
    'custom:papers': { use: 'scholarly works (papers, citations); keyword queries', recipient: { kind: 'service', service: 'OpenAlex', host: undefined }, appliesFreshness: false },
    'custom:fixed': { use: 'the model searches and answers', recipient: { kind: 'service', service: 'OpenAI Responses', host: 'llm.example' }, appliesFreshness: false },
  })
})

it('names an operator endpoint by its hostname, and keyless Exa does not apply freshness', async () => {
  const listed = await facts({
    connections: {
      'builtin:deepseek-messages': { trustedEndpoint: true, options: { baseURL: 'https://ds.proxy.example/anthropic' } },
      'builtin:exa': { disabled: false },
    },
  })
  expect(listed['builtin:deepseek-messages']?.recipient).toEqual({ kind: 'service', service: 'DeepSeek Messages', host: 'ds.proxy.example' })
  expect(listed['builtin:exa']).toMatchObject({ recipient: { kind: 'service', service: 'Exa', host: undefined }, appliesFreshness: false })
})
