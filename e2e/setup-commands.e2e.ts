import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost, type Host } from './harness/host.ts'

const e2e = inject('e2e')
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)

describe('Setup commands in the installed real Host', () => {
  let host: Host | undefined
  afterEach(async () => {
    if (host !== undefined) await host.dispose()
    host = undefined
  })

  async function start(overlays: string[] = []) {
    enterIsolatedEnvironment(e2e.env)
    const active = await bootHost(e2e, [fixture('command-defaults.yml'), ...overlays])
    host = active
    const { sessionId } = await active.ctx.sessionController.create({ cwd: e2e.env.DSH_HOME! })
    const resolved = await active.ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    return { ctx: active.ctx, agent: resolved.agent, sessionId }
  }

  it('lists both commands, displays state, and shares connection/freshness writes with Remote', async () => {
    const { ctx, agent, sessionId } = await start([fixture('setup-command-connections.yml')])
    const run = async (line: string) => (await ctx.commands.execute(agent, line, [], new AbortController().signal))!.result
    expect(ctx.commands.list(agent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'setup-search', description: "Show or change this session's web search connection", input: { hint: '[off | <connection id> | freshness auto|fresh|realtime]' } }),
      expect.objectContaining({ name: 'setup-fetch', description: "Show or change this session's web fetch connection", input: { hint: '[off | <connection id>]' } }),
    ]))
    const search = await run('/setup-search')
    expect(search).toMatchObject({ kind: 'success', text: expect.stringContaining('Routing: web_search goes to this plugin.') })
    expect(search.text).toContain('Connections (/setup-search <id> chooses one):')
    expect(search.text).toContain('- builtin:openalex — OpenAlex · ready')
    const fetch = await run('/setup-fetch')
    expect(fetch).toMatchObject({ kind: 'success', text: expect.stringContaining('fetches from this machine') })
    expect(await run('/setup-search off')).toEqual({ kind: 'success', text: 'Web search is off for this session from the next model request.' })
    expect(await ctx.searchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: null }, source: 'session' })
    expect(await run('/setup-search')).toMatchObject({ text: expect.stringContaining('Off · chosen in this session · freshness: auto') })
    expect(await run('/setup-search builtin:exa')).toEqual({ kind: 'success', text: 'Now using Exa (builtin:exa) for web search from the next model request.' })
    for (const mode of ['fresh', 'realtime', 'auto']) {
      expect(await run('/setup-search freshness ' + mode)).toEqual({ kind: 'success', text: 'Freshness is ' + mode + ' from the next model request.' })
      expect(await ctx.searchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: 'builtin:exa', options: { freshness: mode } } })
    }
    expect(await run('/setup-search custom:MyEngine')).toMatchObject({ kind: 'success', text: expect.stringContaining('(custom:MyEngine)') })
    expect(await run('/setup-fetch off')).toEqual({ kind: 'success', text: 'Web fetch is off for this session from the next model request.' })
    expect(await ctx.fetchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: null } })
    expect(await run('/setup-fetch builtin:local')).toMatchObject({ kind: 'success', text: expect.stringContaining('(builtin:local) for web fetch from the next model request.') })
    expect(await ctx.fetchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: 'builtin:local' } })
  })

  it('rejects invalid grammar, unavailable ids and unsupported freshness without changing the selection', async () => {
    const { ctx, agent, sessionId } = await start()
    const run = async (line: string) => (await ctx.commands.execute(agent, line, [], new AbortController().signal))!.result
    expect(await run('/setup-search builtin:openalex')).toMatchObject({ kind: 'success' })
    const before = await ctx.searchConnections.get({ sessionId })
    expect(await run('/setup-search BAD')).toEqual({ kind: 'error', text: 'Unknown argument "BAD". Usage: /setup-search [off | <connection id> | freshness auto|fresh|realtime]' })
    expect(await run('/setup-search freshness yesterday')).toEqual({ kind: 'error', text: 'Unknown freshness "yesterday". Use auto, fresh or realtime.' })
    expect(await run('/setup-search builtin:exa')).toEqual({ kind: 'error', text: 'builtin:exa is missing or turned off in the settings. Run /setup-search to list the connections.' })
    expect(await run('/setup-search freshness fresh')).toEqual({ kind: 'error', text: 'The current connection does not apply freshness. Choose one marked "applies freshness" first.' })
    expect(await ctx.searchConnections.get({ sessionId })).toEqual(before)
    expect(await run('/setup-fetch freshness fresh')).toEqual({ kind: 'error', text: 'Unknown argument "freshness fresh". Usage: /setup-fetch [off | <connection id>]' })
    expect(await run('/setup-fetch custom:missing')).toEqual({ kind: 'error', text: 'custom:missing is missing or turned off in the settings. Run /setup-fetch to list the connections.' })
  })

  it('reports invalid row settings without exposing internal diagnostics', async () => {
    const { ctx, agent } = await start([fixture('setup-command-invalid-settings.yml')])
    for (const kind of ['search', 'fetch']) {
      expect(await ctx.commands.execute(agent, '/setup-' + kind, [], new AbortController().signal)).toMatchObject({ result: {
        kind: 'error', text: 'The web ' + kind + ' settings are invalid; fix them in the Enhanced web ' + kind + ' row settings.',
      } })
    }
  })

  it.each(['search', 'fetch'])('removes the %s command when its plugin row is off', async kind => {
    const { ctx, agent } = await start([fixture('disable-' + kind + '.yml')])
    expect(ctx.commands.list(agent).map(command => command.name)).not.toContain('setup-' + kind)
    expect(await ctx.commands.execute(agent, '/setup-' + kind, [], new AbortController().signal)).toBeUndefined()
  })

  it('keeps both Host commands when the shared UI row is off', async () => {
    const { ctx, agent } = await start([fixture('disable-ui.yml')])
    for (const name of ['setup-search', 'setup-fetch']) {
      expect(await ctx.commands.execute(agent, '/' + name + ' off', [], new AbortController().signal)).toMatchObject({ result: { kind: 'success' } })
    }
  })
})
