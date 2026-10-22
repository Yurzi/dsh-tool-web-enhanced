/** web_fetch_enhanced end to end over the real composition host (Settings rows, WebRuntime, storage, Agents); local servers stand in for targets and services. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { expect, it, onTestFinished } from 'vitest'
import type { FetchSettings } from '../src/settings/types.ts'
import { composeFetch } from './fixtures/composition-host.ts'
import { json, readJson, serve } from './fixtures/http.ts'

/** The fixture stores 'composition-secret' under TEST_KEY. */
const SECRET = 'composition-secret'
let calls = 0

function settingsFor(services: { crawl: string; native: string }): FetchSettings {
  return {
    enhancedTools: true,
    connections: {
      'builtin:local': { options: { allowCidrs: ['127.0.0.0/8'] } },
      'builtin:deepseek-fetch-api': { disabled: false, trustedEndpoint: true, credentialRef: 'TEST_KEY', options: { baseURL: services.native } },
      'custom:crawl': { kind: 'adapter', adapter: 'firecrawl', label: 'Crawl', credentialRef: 'TEST_KEY', endpoint: services.crawl, trustedEndpoint: true },
    },
  }
}

async function host(services: { crawl: string; native: string }) {
  const h = await composeFetch(settingsFor(services))
  await h.request()
  const call = (name: string, args: Record<string, unknown>, agent: Agent = h.agent) =>
    h.ctx.tools.execute({ callId: ToolCallId(`call-${++calls}`), name, arguments: args, agent, signal: new AbortController().signal })
  const conversation = async () => {
    const handle = await h.ctx.agents.create({ sessionId: SessionId(`later-${++calls}`) })
    onTestFinished(() => handle.dispose())
    await h.ctx.waterfall('agent/request', { agent: handle.agent, turn: 1, step: 0, signal: new AbortController().signal } as never, (async () => ({ provider: 'p', model: 'm' })) as never)
    return handle.agent
  }
  return { ...h, call, conversation }
}

const text = (result: ToolExecutionResult) => (result.content[0] as { text: string }).text
const failure = (result: ToolExecutionResult) => {
  expect(result.isError).toBe(true)
  return result.isError ? result.error : undefined
}
const unused = () => serve((_request, response) => { response.statusCode = 500; response.end() })

it('fetches through local, a remote adapter and the native API by explicit id, leaving the Session selection alone', async () => {
  const target = await serve((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<h1>Local page</h1>') })
  const crawled: unknown[] = []
  const crawl = await serve((request, response) => { void readJson(request).then(body => { crawled.push([request.headers.authorization, body.url]); json(response, { success: true, data: { markdown: 'crawled page' } }) }) })
  const native = await serve((request, response) => { void readJson(request).then(() => { json(response, { content: `native page for ${request.headers.authorization}` }) }) })
  const h = await host({ crawl, native })
  const before = await h.ctx.fetchConnections.get({ sessionId: h.agent.id })

  const local = await h.call('web_fetch_enhanced', { url: `${target}/page`, provider: 'builtin:local' })
  expect(text(local)).toMatch(/^Provider: builtin:local\n\nFetched http:\/\/127\.0\.0\.1:\d+\/page \(HTTP 200\)/u)
  expect(text(local)).toContain('# Local page')
  const remote = await h.call('web_fetch_enhanced', { url: 'http://10.1.2.3/internal', provider: 'custom:crawl' })
  expect(remote.value).toEqual({ provider: 'custom:crawl', url: 'http://10.1.2.3/internal', statusCode: 200, body: { kind: 'text', content: 'crawled page' }, truncated: false })
  expect(crawled).toEqual([[`Bearer ${SECRET}`, 'http://10.1.2.3/internal']])
  const api = await h.call('web_fetch_enhanced', { url: 'https://example.com/', provider: 'builtin:deepseek-fetch-api' })
  expect(api.value).toMatchObject({ provider: 'builtin:deepseek-fetch-api', body: { kind: 'text', content: 'native page for Bearer [redacted]' } })

  const after = await h.ctx.fetchConnections.get({ sessionId: h.agent.id })
  expect(after.selection).toEqual(before.selection)
  expect(after.selection).toMatchObject({ connectionId: 'builtin:local', revision: 0 })
  expect(await h.ctx.fetchConnections.pairings({})).toEqual({ pairings: [] })
})

it('hints remote failures but not local allowlist or URL refusals, keeping redaction and explanations', async () => {
  const crawl = await serve((request, response) => { response.statusCode = 401; json(response, { error: `denied ${request.headers.authorization}` }) })
  const h = await host({ crawl, native: await unused() })

  const withheld = failure(await h.call('web_fetch_enhanced', { url: 'https://example.com/', provider: 'custom:crawl' }))
  const [first, ...rest] = withheld?.message.split('\n\n') ?? []
  expect(first).toMatch(/^dsh-web-fetch-enhanced: .+ Provider "custom:crawl" failed; list_web_fetch_providers shows the others\.$/u)
  expect(rest).toEqual(["Crawl's response was withheld because it contained this request's credential."])
  expect(JSON.stringify(withheld)).not.toContain(SECRET)

  const blocked = failure(await h.call('web_fetch_enhanced', { url: 'http://10.23.45.67/internal', provider: 'builtin:local' }))
  expect(blocked?.info).toMatchObject({ code: 'WEB_BLOCKED_URL' })
  expect(blocked?.message).not.toContain('list_web_fetch_providers')

  const invalid = failure(await h.call('web_fetch_enhanced', { url: 'ftp://example.com/file', provider: 'builtin:local' }))
  expect(invalid?.info).toMatchObject({ code: 'WEB_INVALID_URL' })
  expect(invalid?.message).not.toContain('list_web_fetch_providers')
})

it('runs local and a remote service in parallel within one step', async () => {
  const both = Promise.withResolvers<void>()
  const arrived: Array<() => void> = []
  const hold = (answer: () => void) => {
    arrived.push(answer)
    if (arrived.length === 2) both.resolve()
  }
  const target = await serve((_request, response) => { hold(() => { response.setHeader('content-type', 'text/plain'); response.end('local body') }) })
  const crawl = await serve((request, response) => { void readJson(request).then(() => { hold(() => { json(response, { success: true, data: { markdown: 'remote body' } }) }) }) })
  const h = await host({ crawl, native: await unused() })
  const local = h.call('web_fetch_enhanced', { url: `${target}/a`, provider: 'builtin:local' })
  const remote = h.call('web_fetch_enhanced', { url: `${target}/b`, provider: 'custom:crawl' })
  await both.promise
  for (const answer of arrived) answer()
  expect((await local).value).toMatchObject({ provider: 'builtin:local', body: { content: 'local body' } })
  expect((await remote).value).toMatchObject({ provider: 'custom:crawl', body: { content: 'remote body' } })
})

it('lists who receives the URL and the local allowlist for "this provider", following live settings', async () => {
  const h = await host({ crawl: await unused(), native: await unused() })
  const schemas = () => JSON.stringify(h.ctx.tools.schemas().filter(schema => schema.name.includes('fetch_')))
  const before = schemas()
  const notice = (cidr: string) => `The operator has authorized this provider to reach non-public addresses within [${cidr}]. All other URL, DNS, redirect, and transport safety checks still apply.`
  const first = await h.call('list_web_fetch_providers', {})
  expect(text(first).split('\n')).toEqual([
    `builtin:local — Local HTTP · ready · selected for this session · fetches from this machine · ${notice('127.0.0.0/8')}`,
    'builtin:deepseek-fetch-api — DeepSeek Fetch API · ready · URLs go to 127.0.0.1',
    'custom:crawl — Crawl · ready · URLs go to 127.0.0.1',
  ])
  expect(await h.notice()).toContain('The operator has authorized web_fetch to reach non-public addresses within [127.0.0.0/8].')

  await h.ctx.settings.mutate(FETCH.rowId, [{ op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: ['10.0.0.0/8'] }])
  const second = await h.call('list_web_fetch_providers', {})
  expect(second.value).toMatchObject({ sessionProvider: 'builtin:local', sessionProviderTurnedOff: false, providers: [{ id: 'builtin:local', sendsTo: 'this machine', notice: notice('10.0.0.0/8') }, {}, {}] })
  await h.ctx.settings.mutate(FETCH.rowId, [
    { op: 'set', path: ['connections', 'builtin:local', 'options', 'allowCidrs'], value: [] },
    { op: 'set', path: ['connections', 'builtin:local', 'disabled'], value: true },
  ])
  const third = await h.call('list_web_fetch_providers', {})
  expect(text(third).split('\n')).toEqual([
    'builtin:local — Local HTTP · ready · selected for this session · fetches from this machine',
    'builtin:deepseek-fetch-api — DeepSeek Fetch API · ready · URLs go to 127.0.0.1',
    'custom:crawl — Crawl · ready · URLs go to 127.0.0.1',
    "This session's selection, builtin:local, is turned off; web_fetch will fail until the user changes it.",
  ])
  expect(schemas()).toBe(before)

  // A conversation started now snapshots only what is selectable now.
  const later = await h.conversation()
  expect((await h.call('list_web_fetch_providers', {}, later)).value).toMatchObject({ providers: [{ id: 'builtin:deepseek-fetch-api' }, { id: 'custom:crawl' }] })
})
