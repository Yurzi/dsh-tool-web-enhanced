import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { addPlugins, enterIsolatedEnvironment } from './harness/environment.ts'
import { upgradeEnvironment } from './harness/upgrade.ts'
import { bootHost, type Host } from './harness/host.ts'
import { connectionButton, expandConnectionSection, newSession, openConnections } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

// Do not race other specs' persisted draft restoration when opening the workspace picker.
const e2e = upgradeEnvironment(inject('e2e'))

describe.skipIf(chromiumPath === undefined && !browserRequired)('Composer search selection', () => {
  let server: WebServer | undefined
  let app: App | undefined
  let host: Host | undefined
  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    server = await startWeb(e2e)
    app = await openApp(server.url)
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'composer-menu-failure')
  })
  afterAll(async () => {
    await app?.close()
    await server?.stop()
    await host?.dispose()
  })

  it('persists Off from the search section and hides the real Web preset tool until restored', async () => {
    const browser = app!
    const { page } = browser
    const sessionId = await newSession(page)
    const connections = await openConnections(page)
    await connections.getByRole('group', { name: /^Fetch(?: ·|$)/ }).waitFor()
    const menu = await expandConnectionSection(connections, searchText['section.title'])
    await expect.poll(() => menu.getByRole('button', { name: new RegExp('^' + searchText['section.title'] + ' ·') }).getAttribute('aria-label')).toContain(searchText['source.default'])
    const button = connectionButton(page)
    const sideName = (capability: string, state: string) => uiText['button.side'].replace('{capability}', capability).replace('{state}', state)
    const searchAttention = uiText['button.sideAttention'].replace('{capability}', searchText['section.title']).replace('{state}', 'DeepSeek Messages')
    const localName = sideName(fetchText['section.title'], fetchText['connection.local'])
    await expect.poll(() => button.getAttribute('aria-label')).toBe(searchAttention + ' · ' + localName)
    expect(await button.locator('span[data-capability]').count()).toBe(2)
    expect(await button.getAttribute('title')).toBe(await button.getAttribute('aria-label'))
    await menu.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).click()
    await expect.poll(() => button.getAttribute('aria-label')).toBe(sideName(searchText['section.title'], uiText['button.off']) + ' · ' + localName)
    expect(await button.locator('span[data-capability="search"]').textContent()).toBe(sideName(searchText['section.title'], uiText['button.off']))
    expect(await button.locator('span[data-capability="fetch"]').textContent()).toBe(fetchText['connection.local'])
    await openConnections(page)
    await expandConnectionSection(connections, searchText['section.title'])
    await expect.poll(() => menu.getByRole('button', { name: new RegExp('^' + searchText['section.title'] + ' ·') }).getAttribute('aria-label')).toContain(searchText['source.session'])
    expect(await menu.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).getAttribute('aria-checked')).toBe('true')
    await browser.screenshot('composer-search-off')
    expect(browser.errors).toEqual([])

    // Never have two Host processes writing the same session/domain concurrently.
    await browser.close()
    app = undefined
    await server!.stop()
    server = undefined
    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e)
    const { ctx } = host
    const remote = ctx.searchConnections
    const off = await remote.get({ sessionId })
    expect(off).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    const resolved = await ctx.sessionController.resolveAgent(sessionId as Parameters<typeof ctx.sessionController.resolveAgent>[0])
    if ('error' in resolved) throw resolved.error
    const { agent } = resolved
    // Load scopeOf from the same DSH installation that owns the real Agent.
    const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
    const scope = (require('@deepseek-ai/dsh-scope') as { scopeOf: typeof scopeOf }).scopeOf(agent.ctx)
    expect(scope).toBeDefined()
    expect(ctx.tools.get('web_search', scope)).toBeUndefined()
    expect(ctx.tools.schemas(scope).map(tool => tool.name)).not.toContain('web_search')
    expect(ctx.tools.get('web_fetch', scope)).toBeDefined()
    await expect(ctx.agents.withInitiator(agent, () => host!.web.search({ query: 'off session must not search' })))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    const on = await remote.set({ sessionId, connectionId: 'builtin:deepseek-messages', expectedRevision: off.selection.revision })
    expect(on).toMatchObject({ selection: { connectionId: 'builtin:deepseek-messages', revision: 2 }, source: 'session' })
    expect(ctx.tools.get('web_search', scope)).toBeDefined()
    expect(ctx.tools.schemas(scope).map(tool => tool.name)).toContain('web_search')
    // Exercise the actual request hook before calling the next-step seat; no model/network is mocked.
    await ctx.waterfall('agent/request', { agent, turn: 1, step: 0, signal: new AbortController().signal } as never,
      (async () => ({ provider: 'e2e', model: 'e2e' })) as never)
    await expect(ctx.agents.withInitiator(agent, () => host!.web.search({ query: 'restored default' })))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    for (const memory of (await remote.pairings({})).pairings) await remote.forgetPairing({ provider: memory.provider, model: memory.model })
  })
})
