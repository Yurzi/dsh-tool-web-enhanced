import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { addPlugins, artifacts, enterIsolatedEnvironment, isolatedContext } from './harness/environment.ts'
import { connectionButton, openConnections, openConnectionTab } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { startWeb, type WebServer } from './harness/web.ts'
import { bootHost } from './harness/host.ts'
import { startTextModelApi } from './harness/model-api.ts'

const e2e = isolatedContext(inject('e2e'))
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)
const inputLabel = new RegExp('^(?:Message or run a task|Describe what you want to build), / commands, @ files or sessions$')

describe.skipIf(chromiumPath === undefined && !browserRequired)('Setup command decorations in the real Web GUI', () => {
  let app: App | undefined
  let server: WebServer | undefined
  let frames: string[] = []
  let sequence = 0
  let model: Awaited<ReturnType<typeof startTextModelApi>>
  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    model = await startTextModelApi('M6 loopback seed completed.')
    e2e.env.DEEPSEEK_BASE_URL = model.url
    e2e.env.DEEPSEEK_API_KEY = 'm6-gui-loopback-never-real'
  })
  afterAll(async () => { if (model !== undefined) await model.close() })
  afterEach(async ({ task }) => {
    writeFileSync(join(artifacts, 'm6-setup-ui-wire-' + task.name.replaceAll(/[^a-z0-9]+/gi, '-') + '.txt'), frames.join('\n'))
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'm6-setup-ui-' + task.name.replaceAll(/[^a-z0-9]+/gi, '-') + '-failure')
    } finally {
      if (app !== undefined) { await app.close(); app = undefined }
      if (server !== undefined) { await server.stop(); server = undefined }
    }
  })

  async function start(extra: string[] = []) {
    const overlays = [fixture('setup-command-connections.yml'), ...extra]
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e, overlays)
    const title = 'M6 command session ' + ++sequence
    let sessionId: string
    try {
      const registry = host.ctx.get('workspaceRegistry') as { create(path: string, title: string): Promise<{ id: NonNullable<SessionCreateRequest['workspaceId']> }> }
      const workspace = await registry.create(e2e.env.DSH_HOME!, 'M6 loopback workspace')
      const created = await host.ctx.sessionController.create({ workspaceId: workspace.id, agentPreset: 'standard' })
      sessionId = created.sessionId
      await host.ctx.sessionController.rename({ sessionId: created.sessionId, title })
      const resolved = await host.ctx.sessionController.resolveAgent(created.sessionId)
      if ('error' in resolved) throw resolved.error
      const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
      const { createUserMessage: userMessage } = require('@deepseek-ai/dsh-llm') as { createUserMessage: typeof createUserMessage }
      resolved.agent.followup(userMessage({ content: [{ type: 'text', text: 'Complete one loopback seed turn before testing commands.' }], source: { kind: 'user' } }))
      await resolved.agent.whenIdle()
    } finally { await host.dispose() }
    server = await startWeb(e2e, overlays)
    frames = []
    const active = await openApp(server.url, {}, 'dismiss', page => {
      page.on('request', request => {
        if (request.resourceType() === 'fetch') frames.push('http ' + request.method() + ' ' + request.url() + ' ' + String(request.postData()))
      })
      page.on('websocket', socket => {
        socket.on('framesent', frame => frames.push('send ' + String(frame.payload)))
        socket.on('framereceived', frame => frames.push('recv ' + String(frame.payload)))
      })
    })
    app = active
    await active.page.getByRole('button', { name: 'Search sessions', exact: true }).click()
    await active.page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(title)
    await active.page.getByRole('treeitem').filter({ has: active.page.getByText(title, { exact: true }) }).click()
    await active.page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    await active.page.getByText('M6 loopback seed completed.', { exact: true }).waitFor()
    await active.page.getByRole('button', { name: 'Search sessions', exact: true }).click()
    return active
  }

  async function chooser(active: App, kind: 'search' | 'fetch', captureMenu = false) {
    const composer = active.page.getByRole('textbox', { name: inputLabel })
    await composer.fill('/setup-' + kind)
    const command = active.page.getByRole('option', { name: new RegExp('^setup-' + kind + '(?: |$)') })
    await command.waitFor()
    if (captureMenu) await reviewScreenshot(active, 'm6-' + kind + '-slash-menu')
    await command.click()
    const choices = active.page.getByRole('listbox', { name: '/setup-' + kind + ' matches', exact: true })
    await choices.waitFor()
    return choices
  }

  async function execute(active: App, line: string, output: string) {
    const composer = active.page.getByRole('textbox', { name: inputLabel })
    await composer.fill(line)
    await composer.press('End')
    await composer.press('Enter')
    await active.page.getByText(output, { exact: true }).last().waitFor()
  }

  it('keeps the original no-argument choosers and renders parameterized command output with refreshed menus', async () => {
    const active = await start()
    for (const [kind, copy] of [['search', searchText], ['fetch', fetchText]] as const) {
      const choices = await chooser(active, kind, true)
      await choices.getByRole('option', { name: copy['selector.offRow'], exact: true }).waitFor()
      await choices.getByRole('option', { name: kind === 'search' ? /^OpenAlex(?: |$)/ : /^Local HTTP Direct HTTP access(?: |$)/ }).waitFor()
      await reviewScreenshot(active, 'm6-' + kind + '-chooser')
      await active.page.keyboard.press('Escape')
    }
    await execute(active, '/setup-search off', 'Web search is off for this session from the next model request.')
    await expect.poll(() => connectionButton(active.page).locator('[data-capability="search"]').textContent()).toContain(searchText['selector.offRow'])
    const menu = await openConnections(active.page)
    const panel = await openConnectionTab(menu, searchText['section.title'])
    expect(await panel.getByRole('menuitemradio', { name: searchText['selector.offRow'], exact: true }).getAttribute('aria-checked')).toBe('true')
    await reviewScreenshot(active, 'm6-search-command-off-menu')
    await active.page.keyboard.press('Escape')
    await execute(active, '/setup-search builtin:exa', 'Now using Exa (builtin:exa) for web search from the next model request.')
    await execute(active, '/setup-search freshness realtime', 'Freshness is realtime from the next model request.')
    await openConnections(active.page)
    const refreshed = await openConnectionTab(menu, searchText['section.title'])
    expect(await refreshed.getByRole('menuitemradio', { name: /^Exa(?: |$)/ }).getAttribute('aria-checked')).toBe('true')
    await reviewScreenshot(active, 'm6-search-command-realtime-menu')
    await active.page.keyboard.press('Escape')
    await execute(active, '/setup-fetch off', 'Web fetch is off for this session from the next model request.')
    await openConnections(active.page)
    const fetchPanel = await openConnectionTab(menu, fetchText['section.title'])
    expect(await fetchPanel.getByRole('menuitemradio', { name: fetchText['selector.offRow'], exact: true }).getAttribute('aria-checked')).toBe('true')
    await active.page.keyboard.press('Escape')
    await execute(active, '/setup-fetch builtin:local', 'Now using Local HTTP (builtin:local) for web fetch from the next model request.')
    await execute(active, '/setup-fetch custom:missing', 'custom:missing is missing or turned off in the settings. Run /setup-fetch to list the connections.')
    await reviewScreenshot(active, 'm6-command-cards')
    expect(active.errors).toEqual([])
  })

  it('expands the command card to show the multiline routing warning', async () => {
    const active = await start([fixture('setup-command-other-route.yml')])
    const composer = active.page.getByRole('textbox', { name: inputLabel })
    await composer.fill('/setup-search')
    await active.page.getByRole('option', { name: /^setup-search(?: |$)/ }).waitFor()
    await composer.press('End')
    await composer.press('Space')
    await composer.locator('[data-composer-command="setup-search"]').waitFor()
    await composer.pressSequentially('off')
    await composer.press('Enter')
    const card = active.page.getByRole('button', { name: /^setup-search.*Web search is off/s })
    await card.waitFor()
    await card.click()
    await expect.poll(() => card.getAttribute('aria-expanded')).toBe('true')
    const body = active.page.locator('pre').filter({ hasText: 'Web search is off for this session from the next model request.' })
    await body.waitFor()
    expect(await body.textContent()).toBe('Web search is off for this session from the next model request.\nRouting: web_search goes to deepseek, so this selection has no effect until the web row routes it to search-enhanced.')
    await reviewScreenshot(active, 'm6-command-expanded-routing-warning')
    expect(active.errors).toEqual([])
  })

  it('still opens both decorations and executes arguments with the shared UI row disabled', async () => {
    const active = await start([fixture('disable-ui.yml')])
    expect(await connectionButton(active.page).count()).toBe(0)
    for (const kind of ['search', 'fetch'] as const) {
      await chooser(active, kind)
      await active.page.keyboard.press('Escape')
      await execute(active, '/setup-' + kind + ' off', 'Web ' + kind + ' is off for this session from the next model request.')
    }
    await reviewScreenshot(active, 'm6-ui-row-off-command-cards')
    expect(active.errors).toEqual([])
  })

  it.each(['search', 'fetch'])('removes the %s command and chooser with the plugin row disabled', async kind => {
    const active = await start([fixture('disable-' + kind + '.yml')])
    const other = kind === 'search' ? 'fetch' : 'search'
    const composer = active.page.getByRole('textbox', { name: inputLabel })
    await composer.fill('/setup-')
    await active.page.getByRole('option', { name: new RegExp('^setup-' + other + '(?: |$)') }).waitFor()
    expect(await active.page.getByRole('option', { name: new RegExp('^setup-' + kind + '(?: |$)') }).count()).toBe(0)
    expect(active.errors).toEqual([])
  })
})
