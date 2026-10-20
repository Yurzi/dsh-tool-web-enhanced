import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { addPlugins, enterIsolatedEnvironment } from './harness/environment.ts'
import { upgradeEnvironment } from './harness/upgrade.ts'
import { bootHost, type Host } from './harness/host.ts'
import { expandConnectionSection, newSession, openConnections } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

// A dedicated home keeps this multi-restart GUI flow independent of other specs' draft layouts.
const e2e = upgradeEnvironment(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const key = (require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }).credentialRef('DEEPSEEK_API_KEY')

describe.skipIf(chromiumPath === undefined && !browserRequired)('Composer fetch selection', () => {
  let server: WebServer | undefined
  let app: App | undefined
  let host: Host | undefined
  let selectedSession: string

  beforeAll(() => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
  })

  async function closeGui() {
    await app?.close()
    app = undefined
    await server?.stop()
    server = undefined
  }

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'fetch-menu-failure')
    } finally {
      await closeGui()
      await host?.dispose()
      host = undefined
    }
  })
  afterAll(async () => {
    try {
      await closeGui()
    } finally {
      // A fake key must not change the original search suite's missing-key path.
      host ??= await bootHost(e2e)
      try {
        await host.ctx.credentials.unset(key)
        for (const memory of (await host.ctx.fetchConnections.pairings({})).pairings) {
          await host.ctx.fetchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
        }
      } finally {
        await host.dispose()
      }
    }
  })

  it('selects DeepSeek Fetch API from the second section and persists it as a session choice', async () => {
    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e)
    // Configure via the public Credentials seam, never an environment key or settings secret.
    await host.ctx.credentials.set(key, 'wfe-e2e-fake-key-never-sent')
    await host.dispose()
    host = undefined

    server = await startWeb(e2e)
    app = await openApp(server.url)
    const { page } = app
    const sessionId = await newSession(page)
    selectedSession = sessionId
    const menu = await openConnections(page)
    await menu.getByRole('group', { name: /^Search(?: ·|$)/ }).waitFor()
    const fetch = await expandConnectionSection(menu, fetchText['section.title'])
    await expect.poll(() => fetch.getByRole('button', { name: /^Fetch ·/ }).getAttribute('aria-label')).toContain(fetchText['source.default'])
    expect(await menu.getByRole('group').count()).toBe(2)
    await fetch.getByRole('menuitemradio', { name: /^DeepSeek Fetch API/ }).click()
    await menu.waitFor({ state: 'hidden' })
    await openConnections(page)
    await expandConnectionSection(menu, fetchText['section.title'])
    await expect.poll(() => fetch.getByRole('button', { name: /^Fetch ·/ }).getAttribute('aria-label')).toContain(fetchText['source.session'])
    await expect.poll(() => fetch.getByRole('menuitemradio', { name: /^DeepSeek Fetch API/ }).getAttribute('aria-checked')).toBe('true')
    await fetch.getByRole('menuitemradio', { name: /^DeepSeek Fetch API/ }).scrollIntoViewIfNeeded()
    await app.screenshot('composer-fetch-deepseek')
    expect(app.errors).toEqual([])
    await closeGui()

    host = await bootHost(e2e)
    const view = await host.ctx.fetchConnections.get({ sessionId })
    expect(view).toMatchObject({ selection: { connectionId: 'builtin:deepseek-fetch-api', revision: 1 }, source: 'session' })
    // No fetch call is made with the fake credential.
    await host.dispose()
    host = undefined
  })

  it('turns fetch Off in the GUI without hiding search, then restores Local HTTP', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const sessionId = selectedSession
    await app.page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    const menu = await openConnections(app.page)
    const fetch = await expandConnectionSection(menu, fetchText['section.title'])
    await fetch.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
    await openConnections(app.page)
    await expandConnectionSection(menu, fetchText['section.title'])
    await expect.poll(() => fetch.getByRole('button', { name: /^Fetch ·/ }).getAttribute('aria-label')).toContain(fetchText['source.session'])
    await expect.poll(() => fetch.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).getAttribute('aria-checked')).toBe('true')
    await fetch.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).scrollIntoViewIfNeeded()
    await app.screenshot('composer-fetch-off')
    expect(app.errors).toEqual([])
    await closeGui()

    host = await bootHost(e2e)
    const { ctx } = host
    const off = await ctx.fetchConnections.get({ sessionId })
    expect(off).toMatchObject({ selection: { connectionId: null }, source: 'session' })
    const resolved = await ctx.sessionController.resolveAgent(sessionId as Parameters<typeof ctx.sessionController.resolveAgent>[0])
    if ('error' in resolved) throw resolved.error
    const { agent } = resolved
    const scope = (require('@deepseek-ai/dsh-scope') as { scopeOf: typeof scopeOf }).scopeOf(agent.ctx)
    expect(scope).toBeDefined()
    expect(ctx.tools.get('web_fetch', scope)).toBeUndefined()
    expect(ctx.tools.schemas(scope).map(tool => tool.name)).not.toContain('web_fetch')
    expect(ctx.tools.get('web_search', scope)).toBeDefined()
    await expect(ctx.agents.withInitiator(agent, () => host!.web.fetch({ url: 'http://127.0.0.1:9/' })))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    await host.dispose()
    host = undefined
    server = await startWeb(e2e)
    app = await openApp(server.url)
    await app.page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    const restoredMenu = await openConnections(app.page)
    const restoredFetch = await expandConnectionSection(restoredMenu, fetchText['section.title'])
    await restoredFetch.getByRole('menuitemradio', { name: /^Local HTTP/ }).click()
    await restoredMenu.waitFor({ state: 'hidden' })
    await openConnections(app.page)
    await expandConnectionSection(restoredMenu, fetchText['section.title'])
    await expect.poll(() => restoredFetch.getByRole('menuitemradio', { name: /^Local HTTP/ }).getAttribute('aria-checked')).toBe('true')
    await restoredFetch.getByRole('menuitemradio', { name: /^Local HTTP/ }).scrollIntoViewIfNeeded()
    await app.screenshot('composer-fetch-local-restored')
    expect(app.errors).toEqual([])
    await closeGui()

    host = await bootHost(e2e)
    const restored = await host.ctx.fetchConnections.get({ sessionId })
    expect(restored).toMatchObject({ selection: { connectionId: 'builtin:local', revision: off.selection.revision + 1 }, source: 'session' })
    const resumed = await host.ctx.sessionController.resolveAgent(sessionId as Parameters<typeof host.ctx.sessionController.resolveAgent>[0])
    if ('error' in resumed) throw resumed.error
    const resumedScope = (require('@deepseek-ai/dsh-scope') as { scopeOf: typeof scopeOf }).scopeOf(resumed.agent.ctx)
    expect(host.ctx.tools.get('web_fetch', resumedScope)).toBeDefined()
    expect(host.ctx.tools.schemas(resumedScope).map(tool => tool.name)).toContain('web_fetch')
    expect(host.ctx.tools.get('web_search', resumedScope)).toBeDefined()
    await expect(host.ctx.agents.withInitiator(resumed.agent, () => host!.web.fetch({ url: 'http://127.0.0.1:9/' })))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })
})
