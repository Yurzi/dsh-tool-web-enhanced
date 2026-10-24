import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Projections from '@deepseek-ai/dsh-session-projection'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { afterEach, expect, it } from 'vitest'
import { SEARCH, FETCH } from '../src/shared/index.ts'
import type { TuiCommandTreeProvider } from '../src/host/terminal.ts'
import * as searchPlugin from '../../search-enhanced/src/index.ts'
import * as fetchPlugin from '../../fetch-enhanced/src/index.ts'
import { mountWebSettings } from './fixtures/web-settings.ts'
import { MODEL_SETTINGS_NS, modelSettingsPlugin } from '../../search-enhanced/tests/fixtures/model-host.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).toReversed()) await cleanup() })

async function host(options: { search?: object; fetch?: object; terminal?: boolean; account?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'host-command-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(Projections)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(Storage)
  await ctx.plugin(StorageJson, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(CommandRuntime)
  const trees = new Map<string, TuiCommandTreeProvider>()
  if (options.terminal !== false) ctx.provide('tuiCommandTrees', {
    register(provider) {
      expect(trees.has(provider.root)).toBe(false)
      trees.set(provider.root, provider)
      return () => { trees.delete(provider.root) }
    },
  })
  await mountWebSettings(ctx, root, {
    web: { searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId },
    rows: [
      { id: SEARCH.rowId, name: 'cordis:searchCommandTest', config: options.search ?? { defaultConnection: 'builtin:openalex', connections: { 'builtin:openalex': { disabled: false }, 'builtin:exa': { disabled: false, access: 'api-key' } } } },
      { id: FETCH.rowId, name: 'cordis:fetchCommandTest', config: options.fetch ?? {} },
      ...(options.account ? [{ id: MODEL_SETTINGS_NS, name: 'cordis:commandModelRoutes', config: { routes: { 'deepseek-account': {} } } }] : []),
    ],
    configure(scope) {
      scope.loader.builtins.searchCommandTest = searchPlugin
      scope.loader.builtins.fetchCommandTest = fetchPlugin
      scope.loader.builtins.commandModelRoutes = modelSettingsPlugin
    },
  })
  await ctx.fiber.await()
  if (options.account) {
    ctx.llm.registerConfigurableProviders([{ provider: 'deepseek-account', displayName: 'Account', settingsNs: MODEL_SETTINGS_NS, settingsPath: ['routes', 'deepseek-account'] }])
    ctx.provide('deepseekAccount', { resolveToken: async () => undefined } as never)
  }
  const create = async (id: string, meta = {}, seeded = false) => {
    const handle = await ctx.agents.create({ sessionId: SessionId(id), meta,
      agentOptions: { provider: options.account ? 'deepseek-account' : 'fixture', model: 'fixture' },
      ...(seeded ? { seed: [], inheritedEventCount: SessionLogOffset(0) } : {}),
    })
    cleanups.push(() => handle.dispose())
    return handle.agent
  }
  const agent = await create('ordinary')
  const run = async (line: string, target = agent) => {
    const execution = await ctx.commands.execute(target, line, [], new AbortController().signal)
    if (execution === undefined) throw new Error('command not registered: ' + line)
    return execution.result
  }
  const tree = (command: string, path: readonly string[] = [command]) => {
    const provider = trees.get(command)
    if (provider === undefined) throw new Error('missing tree: ' + command)
    return provider.children(path)
  }
  return { root, ctx, agent, run, trees, tree, create }
}

it('advertises both Host commands with exact English metadata and unregisters on actual row disable', async () => {
  const h = await host()
  expect(h.ctx.commands.list(h.agent)).toEqual([
    { name: FETCH.command, description: "Show or change this session's web fetch connection", input: { hint: '[off | <connection id>]' } },
    { name: SEARCH.command, description: "Show or change this session's web search connection", input: { hint: '[off | <connection id> | freshness auto|fresh|realtime]' } },
  ])
  const row = [...h.ctx.loader.entries()].find(entry => entry.options.id === SEARCH.rowId)!
  await row.update({ disabled: true })
  await h.ctx.loader.await()
  expect(h.ctx.commands.find(h.agent, SEARCH.command)).toBeUndefined()
  expect(h.trees.has(SEARCH.command)).toBe(false)
  expect(h.ctx.commands.find(h.agent, FETCH.command)).toBeDefined()
  expect(h.tree(FETCH.command)).toContainEqual({ name: 'builtin:local', description: 'Local HTTP' })
  await row.update({ disabled: false })
  await h.ctx.loader.await()
  expect(h.ctx.commands.find(h.agent, SEARCH.command)).toBeDefined()
  expect(h.trees.has(SEARCH.command)).toBe(true)
})

it('shows local fetch with its recipient and no freshness sections', async () => {
  const h = await host()
  expect(await h.run('/setup-fetch')).toEqual({ kind: 'success', text: [
    'Local HTTP (builtin:local) · the default connection',
    'Routing: web_fetch goes to this plugin.',
    'Connections (/setup-fetch <id> chooses one):',
    '- builtin:local — Local HTTP · ready · current · fetches from this machine',
    'Turn off: /setup-fetch off',
  ].join('\n') })
})

it('writes off and connections with durable revisions and model memory, including identical writes', async () => {
  const h = await host()
  expect(await h.run('/setup-search off')).toEqual({ kind: 'success', text: 'Web search is off for this session from the next model request.' })
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('Off · chosen in this session · freshness: auto') })
  expect(await h.run('/setup-search builtin:exa')).toEqual({ kind: 'success', text: 'Now using Exa (builtin:exa) for web search from the next model request.' })
  expect(await h.run('/setup-search builtin:exa')).toEqual({ kind: 'success', text: 'Now using Exa (builtin:exa) for web search from the next model request.' })
  const domain = h.ctx.storageDomain.get('web_search_enhanced')!
  expect(domain.table('selections').get(h.agent.id)).toMatchObject({ connectionId: 'builtin:exa', revision: 3 })
  expect([...domain.table('pairings').entries()]).toHaveLength(1)
  expect(await h.run('/setup-search freshness fresh')).toEqual({ kind: 'success', text: 'Freshness is fresh from the next model request.' })
  expect(domain.table('selections').get(h.agent.id)).toMatchObject({ connectionId: 'builtin:exa', revision: 4, freshness: 'fresh' })
  const shown = await h.run('/setup-search')
  expect(shown).toMatchObject({ text: expect.stringContaining('Exa (builtin:exa) · chosen in this session · freshness: fresh') })
  expect(shown).toMatchObject({ text: expect.stringContaining('- builtin:exa — Exa · needs an API key · current · applies freshness') })
})

it.each([false, true])('writes a subagent without changing model memory (seeded=%s)', async seeded => {
  const h = await host()
  const child = await h.create('child', { origin: 'subagent', parentSession: h.agent.id, isSeeded: seeded }, seeded)
  expect(await h.run('/setup-search off', child)).toMatchObject({ kind: 'success' })
  const domain = h.ctx.storageDomain.get('web_search_enhanced')!
  expect(domain.table('selections').get(child.id)).toMatchObject({ connectionId: null, revision: 1 })
  expect([...domain.table('pairings').entries()]).toHaveLength(0)
  expect(await h.run('/setup-search', child)).toMatchObject({ text: expect.stringContaining('Off · chosen in this session') })
})

it.each([
  ['off   extra', 'Unknown argument "off extra". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['off extra', 'Unknown argument "off extra". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['freshness', 'Unknown argument "freshness". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['freshness yesterday', 'Unknown freshness "yesterday". Use auto, fresh or realtime.'],
  ['off\nextra', 'Unknown argument "off extra". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['\u001b[31mred', 'Unknown argument "[31mred". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['a' + '😀'.repeat(40), 'Unknown argument "a' + '😀'.repeat(31) + '…". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['freshness \u001b[31mred', 'Unknown freshness "[31mred". Use auto, fresh or realtime.'],
  ['freshness ' + 'y'.repeat(80), 'Unknown freshness "' + 'y'.repeat(63) + '…". Use auto, fresh or realtime.'],
  ['freshness a' + '😀'.repeat(40), 'Unknown freshness "a' + '😀'.repeat(31) + '…". Use auto, fresh or realtime.'],
  ['x'.repeat(80), 'Unknown argument "' + 'x'.repeat(63) + '…". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]'],
  ['custom:missing', 'custom:missing is missing or turned off in the settings. Run /setup-search to list the connections.'],
  ['builtin:tavily', 'builtin:tavily is missing or turned off in the settings. Run /setup-search to list the connections.'],
])('rejects %s with exact grammar or eligibility wording', async (args, text) => {
  const h = await host()
  expect(await h.run('/setup-search ' + args)).toEqual({ kind: 'error', text })
})

it('rejects unsupported freshness and fetch freshness grammar', async () => {
  const h = await host()
  expect(await h.run('/setup-search freshness fresh')).toEqual({ kind: 'error', text: 'The current connection does not apply freshness. Choose one marked "applies freshness" first.' })
  expect(await h.run('/setup-fetch freshness fresh')).toEqual({ kind: 'error', text: 'Unknown argument "freshness fresh". Usage: /setup-fetch [off | <connection id>]' })
  await h.run('/setup-search off')
  expect(await h.run('/setup-search freshness realtime')).toMatchObject({ kind: 'error', text: expect.stringContaining('does not apply freshness') })
})

it('shows and appends the other and auto routing explanations without changing the web row', async () => {
  const h = await host()
  const row = [...h.ctx.loader.entries()].find(entry => entry.options.id === 'web')!
  await h.ctx.settings.update('web', { searchProvider: 'elsewhere' })
  const other = 'Routing: web_search goes to elsewhere, so this selection has no effect until the web row routes it to search-enhanced.'
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining(other) })
  expect(await h.run('/setup-search off')).toEqual({ kind: 'success', text: 'Web search is off for this session from the next model request.\n' + other })
  await row.update({ config: {} })
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('Routing: the web row pins no web_search provider, so this selection has no effect until it routes web_search to search-enhanced.') })

})

it('shows inherited and model sources, then warns for a disabled selected connection', async () => {
  const h = await host()
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('OpenAlex (builtin:openalex) · the default connection') })
  await h.run('/setup-search builtin:exa')
  const inherited = await h.create('fork', { parentSession: h.agent.id, isSeeded: true }, true)
  expect(await h.run('/setup-search', inherited)).toMatchObject({ text: expect.stringContaining('Exa (builtin:exa) · copied from the parent session') })
  const model = await h.create('same-model')
  expect(await h.run('/setup-search', model)).toMatchObject({ text: expect.stringContaining('Exa (builtin:exa) · remembered for this model') })
  await h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: ['connections', 'builtin:exa', 'disabled'], value: true }])
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('builtin:exa · chosen in this session · missing or turned off in the settings; web_search fails until another connection is chosen') })
  expect((await h.run('/setup-search')).text).not.toContain('- builtin:exa')
})

it('provides synchronous case-preserving completions from live settings and unregisters them', async () => {
  const h = await host({ search: { connections: { 'custom:MyEngine': { kind: 'adapter', adapter: 'exa', label: 'My   Engine', credentialRef: 'MY_ENGINE_KEY' } } } })
  expect(h.tree(SEARCH.command)).toContainEqual({ name: 'custom:MyEngine', description: 'My Engine' })
  expect(h.tree(SEARCH.command)).toContainEqual({ name: 'freshness', description: 'Content freshness, for connections that apply it' })
  expect(h.tree(FETCH.command)[0]).toEqual({ name: 'off', description: 'Turn web fetch off for this session' })
  expect(h.tree(SEARCH.command)[0]).toEqual({ name: 'off', description: 'Turn web search off for this session' })
  expect(h.tree(SEARCH.command, [SEARCH.command, 'freshness'])).toEqual([
    { name: 'auto', description: 'Auto' }, { name: 'fresh', description: 'Within 24 hours' }, { name: 'realtime', description: 'Live' },
  ])
  expect(h.tree(SEARCH.command, [SEARCH.command, 'freshness', 'auto'])).toEqual([])
  expect(h.tree(FETCH.command, [FETCH.command, 'freshness'])).toEqual([])
  await h.ctx.settings.mutate(SEARCH.rowId, [{ op: 'set', path: ['connections', 'custom:MyEngine', 'disabled'], value: true }])
  expect(h.tree(SEARCH.command).map(node => node.name)).not.toContain('custom:MyEngine')
})

it('works without a TUI registry', async () => {
  const h = await host({ terminal: false })
  expect(await h.run('/setup-fetch off')).toMatchObject({ kind: 'success' })
})

it('reports invalid settings while keeping basic completions and the other command alive', async () => {
  const h = await host({ search: { version: 999 } })
  expect(await h.run('/setup-search')).toEqual({ kind: 'error', text: 'The web search settings are invalid; fix them in the Enhanced web search row settings.' })
  expect(h.tree(SEARCH.command).map(node => node.name)).toEqual(['off', 'freshness'])
  expect(await h.run('/setup-fetch off')).toMatchObject({ kind: 'success' })
})

it('shows custom recipients and keeps connection id casing exact for writes', async () => {
  const h = await host({ search: { connections: { 'custom:CorpSearch': {
    kind: 'adapter', adapter: 'exa', label: 'Corp search', credentialRef: 'CORP_SEARCH_KEY',
    endpoint: 'https://search.corp.example/query', trustedEndpoint: true,
  } } } })
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('- custom:CorpSearch — Corp search · needs an API key · applies freshness · queries go to search.corp.example') })
  expect(await h.run('/setup-search custom:CorpSearch')).toEqual({ kind: 'success', text: 'Now using Corp search (custom:CorpSearch) for web search from the next model request.' })
  expect(await h.run('/setup-search custom:corpsearch')).toEqual({ kind: 'error', text: 'custom:corpsearch is missing or turned off in the settings. Run /setup-search to list the connections.' })
  expect(await h.run('/setup-fetch off')).toEqual({ kind: 'success', text: 'Web fetch is off for this session from the next model request.' })
  expect(await h.run('/setup-fetch builtin:local')).toEqual({ kind: 'success', text: 'Now using Local HTTP (builtin:local) for web fetch from the next model request.' })
})

it('shows the complete search summary, statuses, recipients and footer', async () => {
  const h = await host()
  expect(await h.run('/setup-search')).toEqual({ kind: 'success', text: [
    'OpenAlex (builtin:openalex) · the default connection · freshness: auto',
    'Routing: web_search goes to this plugin.',
    'Connections (/setup-search <id> chooses one):',
    '- builtin:deepseek-messages — DeepSeek Messages · needs an API key',
    '- builtin:session-model — Session model · unavailable: the model route is unknown · queries go to the service behind the session model (fixture)',
    '- builtin:exa — Exa · needs an API key · applies freshness',
    '- builtin:openalex — OpenAlex · ready · current',
    'Turn off: /setup-search off · Freshness: /setup-search freshness auto|fresh|realtime (connections marked "applies freshness")',
  ].join('\n') })
})

it('names missing DeepSeek sign-in for the account-backed session model', async () => {
  const h = await host({ account: true })
  expect(await h.run('/setup-search')).toMatchObject({ text: expect.stringContaining('- builtin:session-model — Session model · needs DeepSeek sign-in · queries go to the service behind the session model (deepseek-account)') })
})

it('accepts keyword casing without normalizing case-sensitive connection ids', async () => {
  const h = await host()
  expect(await h.run('/setup-search OFF')).toEqual({ kind: 'success', text: 'Web search is off for this session from the next model request.' })
  expect(await h.run('/setup-fetch OfF')).toEqual({ kind: 'success', text: 'Web fetch is off for this session from the next model request.' })
  await h.run('/setup-search builtin:exa')
  for (const [input, mode] of [['AUTO', 'auto'], ['Fresh', 'fresh'], ['REALTIME', 'realtime']]) {
    expect(await h.run('/setup-search FRESHNESS ' + input)).toEqual({ kind: 'success', text: 'Freshness is ' + mode + ' from the next model request.' })
  }
})

it('contains fetch storage write failures with the fetch-specific wording', async () => {
  const h = await host()
  const path = join(h.root, 'storage', 'web_fetch_enhanced.json')
  expect(path.startsWith(h.root + '/storage/')).toBe(true)
  await rm(path, { force: true })
  await mkdir(path)
  expect(await h.run('/setup-fetch off')).toEqual({ kind: 'error', text: 'The web fetch selection could not be read or saved; retry, or check the Host logs.' })
})

it('keeps only the fetch off completion when its row settings are invalid', async () => {
  const h = await host({ fetch: { version: 999 } })
  expect(await h.run('/setup-fetch')).toEqual({ kind: 'error', text: 'The web fetch settings are invalid; fix them in the Enhanced web fetch row settings.' })
  expect(h.tree(FETCH.command)).toEqual([{ name: 'off', description: 'Turn web fetch off for this session' }])
})
