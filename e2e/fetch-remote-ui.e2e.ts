import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { FETCH, PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { firecrawlResponse, remoteFetchFixture } from './fixtures/remote-fetch.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { addPlugins, composedRows, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { openConnectionTab, newSession, openConnections, openFetchSettings } from './harness/navigation.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'
import { upgradeEnvironment } from './harness/upgrade.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = upgradeEnvironment(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const credentials = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const tinyfishKey = credentials.credentialRef('TINYFISH_API_KEY')
const customKey = credentials.credentialRef(remoteFetchFixture.credentialRef)
const loopbackOverlay = join(import.meta.dirname, 'fixtures/fetch-allow-loopback.yml')
const notice = 'authorized web_fetch to reach non-public addresses within [127.0.0.1/32]'
const services = ['Exa', 'Firecrawl', 'Tavily', 'Tinyfish'] as const

describe.skipIf(chromiumPath === undefined && !browserRequired)('Remote fetch connections in the real GUI', () => {
  let server: WebServer | undefined
  let app: App | undefined
  let api: Awaited<ReturnType<typeof startRemoteFetchApi>>

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startRemoteFetchApi(firecrawlResponse())
  })

  async function closeGui() {
    if (app !== undefined) {
      await app.close()
      app = undefined
    }
    if (server !== undefined) {
      await server.stop()
      server = undefined
    }
  }

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'fetch-remote-ui-failure')
    } finally {
      await closeGui()
    }
  })

  afterAll(async () => {
    await closeGui()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try {
      await host.ctx.credentials.unset(tinyfishKey)
      await host.ctx.credentials.unset(customKey)
      for (const memory of (await host.ctx.fetchConnections.pairings({})).pairings) {
        await host.ctx.fetchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
      }
    } finally {
      try {
        await host.dispose()
      } finally {
        if (api !== undefined) await api.close()
      }
    }
  })

  it('shows readiness and URL hand-off, persists keyless Firecrawl and changes only the next-step plan', async () => {
    server = await startWeb(e2e, [loopbackOverlay])
    app = await openApp(server.url)
    const { page } = app
    const sessionId = await newSession(page)
    const menu = await openConnections(page)
    const fetch = await openConnectionTab(menu, fetchText['section.title'])
    for (const name of ['Exa', 'Firecrawl', 'Tavily']) {
      const row = fetch.getByRole('menuitemradio', { name: new RegExp('^' + name + '(?: |$)') })
      await row.waitFor()
      expect(await row.isEnabled()).toBe(true)
      const caption = fetchText['status.remoteReady'].replace('{access}', fetchText['access.keyless']).replace('{name}', name)
      await row.getByText(caption, { exact: true }).waitFor()
    }
    const tinyfish = fetch.getByRole('menuitemradio', { name: /^Tinyfish(?: |$)/ })
    expect(await tinyfish.getAttribute('aria-checked')).toBe('false')
    await tinyfish.getByText(fetchText['status.needsCredential'].replace('{name}', 'Tinyfish'), { exact: true }).waitFor()
    await app.screenshot('fetch-remote-menu-readiness')
    await fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).click()
    await menu.waitFor({ state: 'hidden' })
    await openConnections(page)
    await openConnectionTab(menu, fetchText['section.title'])
    await expect.poll(() => fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).getAttribute('aria-checked')).toBe('true')
    await fetch.getByText(fetchText['source.session'], { exact: true }).waitFor()
    await app.screenshot('fetch-remote-menu-firecrawl-selected')
    // A missing-key row opens settings rather than changing the conversation selection.
    await tinyfish.click()
    await page.getByRole('heading', { name: 'Web Tools Enhanced', exact: true }).waitFor()
    await page.getByRole('treeitem', { name: 'New Session', exact: true }).click()
    await page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    await openConnections(page)
    await openConnectionTab(menu, fetchText['section.title'])
    expect(await fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).getAttribute('aria-checked')).toBe('true')
    expect(await tinyfish.getAttribute('aria-checked')).toBe('false')
    expect(app.errors).toEqual([])
    await closeGui()

    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, [loopbackOverlay])
    try {
      const { ctx } = host
      const selected = await ctx.fetchConnections.get({ sessionId })
      expect(selected).toMatchObject({ selection: { connectionId: 'builtin:firecrawl', revision: 1 }, source: 'session' })
      expect(selected.connections.find(connection => connection.id === 'builtin:tinyfish')).toMatchObject({ status: 'needs-credential', access: 'api-key' })
      for (const id of ['exa', 'firecrawl', 'tavily']) {
        expect(selected.connections.find(connection => connection.id === 'builtin:' + id)).toMatchObject({ status: 'ready', access: 'keyless' })
      }
      const resolved = await ctx.sessionController.resolveAgent(sessionId as Parameters<typeof ctx.sessionController.resolveAgent>[0])
      if ('error' in resolved) throw resolved.error
      const { agent } = resolved
      let step = 0
      const requestStep = () => ctx.waterfall('agent/request', { agent, turn: 1, step: step++, signal: new AbortController().signal } as never,
        (async () => ({ provider: 'e2e', model: 'e2e' })) as never)
      const prompt = () => ctx.agents.withInitiator(agent, async () => (await ctx.systemPrompt.assemble()).contexts.map(context => context.text).join('\n'))
      const select = async (connectionId: string) => {
        const current = await ctx.fetchConnections.get({ sessionId })
        await ctx.fetchConnections.set({ sessionId, connectionId, expectedRevision: current.selection.revision })
      }
      await requestStep()
      expect(await prompt()).not.toContain(notice)
      await select('builtin:local')
      expect(await prompt()).not.toContain(notice)
      await requestStep()
      expect(await prompt()).toContain(notice)
      await select('builtin:firecrawl')
      expect(await prompt()).toContain(notice)
      await requestStep()
      expect(await prompt()).not.toContain(notice)
      await select('builtin:local')
      await requestStep()
      expect(await prompt()).toContain(notice)
      // The prompt is the observable plan seam. Never execute a keyless remote fetch.
      expect(api.requests).toEqual([])
    } finally {
      await host.dispose()
    }
  })

  it('persists a Tinyfish credential and a trusted custom Firecrawl connection through row settings', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const { page } = app
    const settings = await openFetchSettings(page, false)
    for (const name of services) {
      await settings.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', name), exact: true }).waitFor()
    }
    const configureTinyfish = settings.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', 'Tinyfish'), exact: true })
    const tinyfish = settings.getByRole('listitem').filter({ has: page.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', 'Tinyfish'), exact: true }) })
    const summary = fetchText['services.personalKey'].replace('{ref}', 'TINYFISH_API_KEY') + ' · '
    await tinyfish.getByText(summary + fetchText['credential.unset'], { exact: false }).waitFor()
    await configureTinyfish.click()
    await tinyfish.getByLabel(fetchText['credential.label'], { exact: true }).fill('wfe-e2e-tinyfish-never-sent')
    await app.screenshot('fetch-remote-tinyfish-before-key')
    await tinyfish.getByRole('button', { name: fetchText['credential.save'], exact: true }).click()
    await tinyfish.getByRole('status').getByText(fetchText['credential.saved'], { exact: true }).waitFor()
    await tinyfish.getByText(summary + fetchText['credential.set'], { exact: false }).waitFor()
    await app.screenshot('fetch-remote-tinyfish-configured')

    await settings.getByRole('button', { name: fetchText['custom.addStructured'], exact: true }).click()
    const editor = settings.getByRole('form', { name: fetchText['editor.titleNew'], exact: true })
    await editor.getByRole('textbox', { name: fetchText['editor.label'], exact: true }).fill(remoteFetchFixture.label)
    await editor.getByRole('textbox', { name: fetchText['editor.id'], exact: true }).fill('e2e-firecrawl')
    await editor.getByRole('button', { name: fetchText['editor.adapter'], exact: true }).click()
    await page.getByRole('menuitem', { name: 'Firecrawl', exact: true }).click()
    const endpoint = new URL('v2/scrape', api.url).href
    await editor.getByRole('textbox', { name: fetchText['editor.endpoint'], exact: true }).fill(endpoint)
    await editor.getByRole('textbox', { name: fetchText['editor.credentialRef'], exact: true }).fill(remoteFetchFixture.credentialRef)
    await editor.getByLabel(fetchText['editor.apiKey'], { exact: true }).fill(remoteFetchFixture.key)
    const save = editor.getByRole('button', { name: fetchText['editor.save'], exact: true })
    expect(await save.isDisabled()).toBe(true)
    await editor.getByRole('checkbox', { name: fetchText['editor.trust'].replace('{ref}', remoteFetchFixture.credentialRef), exact: true }).check()
    await app.screenshot('fetch-remote-custom-editor-trusted')
    await save.click()
    await editor.waitFor({ state: 'hidden' })
    const config = () => {
      const row = composedRows(e2e).find(candidate => candidate.id === FETCH.rowId)
      if (row === undefined) throw new Error('the fetch row disappeared')
      return row.config
    }
    await expect.poll(config).toMatchObject({ connections: { [remoteFetchFixture.connectionId]: {
      kind: 'adapter', adapter: 'firecrawl', label: remoteFetchFixture.label, endpoint,
      credentialRef: remoteFetchFixture.credentialRef, trustedEndpoint: true,
    } } })
    expect(JSON.stringify(config())).not.toContain(remoteFetchFixture.key)
    await page.reload()
    const reopened = await openFetchSettings(page, false)
    await reopened.getByText(remoteFetchFixture.label, { exact: false }).waitFor()
    await app.screenshot('fetch-remote-custom-saved')
    expect(app.errors).toEqual([])
    await closeGui()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try {
      expect(await host.ctx.credentials.describe(tinyfishKey)).toMatchObject({ configured: true })
      expect(await host.ctx.credentials.describe(customKey)).toMatchObject({ configured: true })
      expect(api.requests).toEqual([])
    } finally {
      await host.dispose()
    }
  })
})
