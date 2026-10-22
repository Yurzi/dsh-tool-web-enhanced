import { join } from 'node:path'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { connectionButton, newSession, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = isolatedContext(inject('e2e'))
const overlays = ['disable-ui.yml', 'command-defaults.yml'].map(file => join(import.meta.dirname, 'fixtures', file))

describe.skipIf(chromiumPath === undefined && !browserRequired)('Capability UI without the shared UI row', () => {
  let server: WebServer | undefined
  let app: App | undefined

  beforeAll(() => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
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
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'ui-row-off-failure')
    } finally {
      await closeGui()
    }
  })

  afterAll(async () => {
    await closeGui()
  })

  it('still opens both plugin row settings from the Plugins page', async () => {
    server = await startWeb(e2e, overlays)
    app = await openApp(server.url)
    const search = await openSearchSettings(app.page)
    await search.getByRole('heading', { name: searchText['defaults.title'], exact: true }).waitFor()
    await search.getByRole('button', { name: searchText['defaults.connection'], exact: true }).waitFor()
    await app.screenshot('ui-row-off-search-settings')
    const fetch = await openFetchSettings(app.page)
    await fetch.getByRole('textbox', { name: fetchText['allowlist.allowCidrs'], exact: true }).waitFor()
    await app.screenshot('ui-row-off-fetch-settings')
    expect(app.errors).toEqual([])
  })

  it('persists both slash command selections without a composer button and restores them', async () => {
    server = await startWeb(e2e, overlays)
    app = await openApp(server.url)
    const { page } = app
    const sessionId = await newSession(page)
    expect(await connectionButton(page).count()).toBe(0)
    async function command(name: string, label: string, choice: string | RegExp) {
      const currentPage = app!.page
      const composer = currentPage.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true })
      await composer.fill('/' + name)
      await currentPage.getByRole('option', { name: new RegExp(label) }).click()
      const choices = currentPage.getByRole('listbox', { name: '/' + name + ' matches', exact: true })
      const option = choices.getByRole('option', { name: choice, exact: typeof choice === 'string' })
      await option.waitFor()
      await app!.screenshot('ui-row-off-' + name + '-' + (choice === searchText['selector.offRow'] || choice === fetchText['selector.offRow'] ? 'off' : 'restore'))
      await option.click()
      await choices.waitFor({ state: 'hidden' })
    }

    await command('setup-search', searchText['command.label'], searchText['selector.offRow'])
    await command('setup-fetch', fetchText['command.label'], fetchText['selector.offRow'])
    await app.screenshot('ui-row-off-commands-off')
    expect(app.errors).toEqual([])
    await closeGui()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, overlays)
    try {
      expect(await host.ctx.searchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
      expect(await host.ctx.fetchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
    } finally {
      await host.dispose()
    }

    server = await startWeb(e2e, overlays)
    app = await openApp(server.url)
    // The same session is restored by the public GUI's persisted layout.
    await app.page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    await command('setup-search', searchText['command.label'], /^OpenAlex(?: |$)/)
    await command('setup-fetch', fetchText['command.label'], fetchText['connection.local'] + ' ' + fetchText['access.local'])
    await app.screenshot('ui-row-off-commands-restored')
    expect(app.errors).toEqual([])
    await closeGui()
    const restored = await bootHost(e2e, overlays)
    try {
      expect(await restored.ctx.searchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: 'builtin:openalex', revision: 2 }, source: 'session' })
      expect(await restored.ctx.fetchConnections.get({ sessionId })).toMatchObject({ selection: { connectionId: 'builtin:local', revision: 2 }, source: 'session' })
    } finally {
      await restored.dispose()
    }
  })
})
