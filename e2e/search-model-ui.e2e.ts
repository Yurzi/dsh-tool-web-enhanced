import { copyFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { stringify } from 'yaml'
import type { Locator, Page } from 'playwright-core'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import { PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { MODEL_PROTOCOLS } from '../packages/search-enhanced/src/catalog.ts'
import { en as text, zh } from '../packages/search-enhanced/src/client/locales.ts'
import { messagesAnswer, modelDocument, modelFixture, piAiFixture, piAiRows } from './fixtures/search-model.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows, enterIsolatedEnvironment, profilePatchPath } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { connectionButton, openConnectionTab, newSession, openBundle, openConnections, openSearchSettings } from './harness/navigation.ts'
import { startModelApi } from './harness/model-api.ts'
import { modelGroups, modelViewport } from './harness/model-visuals.ts'
import { expectTheme, setTheme } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const e2e = isolatedContext(base)
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const credentials = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const deepseekKey = credentials.credentialRef('DEEPSEEK_API_KEY')
const customKey = credentials.credentialRef(modelFixture.credentialRef)
const modelName = text['connection.sessionModel']
const configureName = text['services.configureLabel'].replace('{name}', modelName)
const matrix = [1280, 768, 390].flatMap(width => (['light', 'dark'] as const).map(scheme => ({ width, scheme })))

/** Use the shell's currently rendered conversation, not a cold-restored identity. */
async function currentConversation(page: Page): Promise<string> {
  await openBundle(page)
  await page.getByRole('button', { name: 'New session', exact: true }).last().click()
  const conversation = page.locator('[data-conversation-session]:visible')
  const chooseWorkspace = page.getByRole('textbox', { name: 'Choose workspace', exact: true })
  await conversation.or(chooseWorkspace).first().waitFor()
  if (await chooseWorkspace.isVisible()) return newSession(page)
  // DSH may intentionally reuse its existing blank Session; that is fine here.
  const id = await conversation.getAttribute('data-conversation-session')
  if (!id) throw new Error('DSH rendered no current conversation identity')
  return id
}

async function modelEditor(settings: Locator, page: Page, endpoint: string) {
  await settings.getByRole('button', { name: text['custom.addStructured'], exact: true }).click()
  const editor = settings.getByRole('form', { name: text['editor.titleNew'], exact: true })
  await editor.getByRole('textbox', { name: text['editor.label'], exact: true }).fill(modelFixture.label)
  await editor.getByRole('textbox', { name: text['editor.id'], exact: true }).fill('e2e-model')
  await editor.getByRole('button', { name: text['editor.adapter'], exact: true }).click()
  await page.getByRole('menuitem', { name: text['model.format'].replace('{protocol}', MODEL_PROTOCOLS['anthropic-messages'].label), exact: true }).click()
  await editor.getByRole('textbox', { name: text['model.id'], exact: true }).fill(modelFixture.model)
  await editor.getByRole('textbox', { name: text['editor.endpoint'], exact: true }).fill(endpoint)
  await editor.getByRole('textbox', { name: text['editor.credentialRef'], exact: true }).fill(modelFixture.credentialRef)
  return editor
}

describe.skipIf(chromiumPath === undefined && !browserRequired)('Model search connections in the real GUI', () => {
  let server: WebServer | undefined
  let app: App | undefined
  let api: Awaited<ReturnType<typeof startModelApi>>

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startModelApi(messagesAnswer())
    e2e.env.DEEPSEEK_BASE_URL = new URL('anthropic', api.url).href
  })

  let guiBoot = 0
  async function closeGui() {
    if (app !== undefined) { await app.close(); app = undefined }
    if (server !== undefined) {
      await server.stop()
      server = undefined
      copyFileSync(join(artifacts, 'web.log'), join(artifacts, 'search-model-web-' + guiBoot++ + '.log'))
    }
  }
  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'search-model-ui-' + task.name.replace(/[^a-z0-9-]+/gi, '-') + '-failure')
    } finally { await closeGui() }
  })
  afterAll(async () => {
    await closeGui()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try {
      await host.ctx.credentials.unset(deepseekKey)
      await host.ctx.credentials.unset(customKey)
      writeFileSync(join(artifacts, 'search-model-ui-wire.json'), JSON.stringify(api.requests, null, 2))
      for (const memory of (await host.ctx.searchConnections.pairings({})).pairings) await host.ctx.searchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
      expect(api.requests).toEqual([])
    } finally {
      try { await host.dispose() } finally { if (api !== undefined) await api.close() }
    }
  })

  it('shows missing credentials, becomes selectable after key setup and persists only the next-step choice', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    let sessionId = await newSession(app.page)
    const menu = await openConnections(app.page)
    const search = await openConnectionTab(menu, text['section.title'])
    const row = search.getByRole('menuitemradio', { name: new RegExp('^' + modelName + '(?: |$)') })
    await row.getByText(text['status.sessionModelNeedsKey'], { exact: true }).waitFor()
    expect(await row.getAttribute('aria-checked')).toBe('false')
    await app.screenshot('search-model-menu-needs-key')
    await closeGui()

    enterIsolatedEnvironment(e2e.env)
    const writer = await bootHost(e2e)
    try {
      const before = await writer.ctx.searchConnections.get({ sessionId })
      expect(before.connections.find(connection => connection.id === 'builtin:session-model')).toMatchObject({ status: 'needs-credential', kind: 'model' })
      await writer.ctx.credentials.set(deepseekKey, modelFixture.key)
      expect(await writer.ctx.credentials.describe(deepseekKey)).toMatchObject({ configured: true })
    } finally { await writer.dispose() }

    server = await startWeb(e2e)
    app = await openApp(server.url)
    sessionId = await currentConversation(app.page)
    const readyMenu = await openConnections(app.page)
    const readySearch = await openConnectionTab(readyMenu, text['section.title'])
    const readyRow = readySearch.getByRole('menuitemradio', { name: new RegExp('^' + modelName + '(?: |$)') })
    await readyRow.getByText(text['status.sessionModelReady'].replace('{access}', text['access.apiKey']), { exact: true }).waitFor()
    await readyRow.click()
    await readyMenu.waitFor({ state: 'hidden' })
    await openConnections(app.page)
    await openConnectionTab(readyMenu, text['section.title'])
    await expect.poll(() => readyRow.getAttribute('aria-checked')).toBe('true')
    await app.screenshot('search-model-menu-selected')
    expect(app.errors).toEqual([])
    await closeGui()

    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try {
      const selected = await host.ctx.searchConnections.get({ sessionId })
      expect(selected).toMatchObject({ selection: { connectionId: 'builtin:session-model', revision: 1 }, source: 'session' })
      // Missing credentials prevent all model I/O while exposing the frozen-plan seam.
      await host.ctx.credentials.unset(deepseekKey)
      const resolved = await host.ctx.sessionController.resolveAgent(sessionId as Parameters<typeof host.ctx.sessionController.resolveAgent>[0])
      if ('error' in resolved) throw resolved.error
      const { agent } = resolved
      const route = { provider: 'deepseek-official', model: 'deepseek-v4-pro' }
      agent.session.append('request/context', route)
      let step = 0
      const requestStep = () => host.ctx.waterfall('agent/request', { agent, turn: 1, step: step++, signal: new AbortController().signal } as never, (async () => route) as never)
      const searchCall = () => host.ctx.agents.withInitiator(agent, () => host.web.search({ query: modelFixture.query }))
      await requestStep()
      await expect(searchCall()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      await host.ctx.searchConnections.set({ sessionId, connectionId: null, expectedRevision: selected.selection.revision })
      await expect(searchCall()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      await requestStep()
      await expect(searchCall()).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      expect(api.requests).toEqual([])
    } finally { await host.dispose() }
  })

  it('expands protocol-grouped Session model options and cold-persists a trusted fixed model', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const settings = await openSearchSettings(app.page)
    await settings.getByRole('button', { name: configureName, exact: true }).click()
    const row = settings.getByRole('listitem').filter({ has: app.page.getByRole('button', { name: configureName, exact: true }) })
    await row.getByText(text['services.sessionModel.note'], { exact: true }).waitFor()
    for (const protocol of Object.values(MODEL_PROTOCOLS)) await row.getByRole('group', { name: new RegExp(protocol.label) }).first().waitFor()
    const editor = await modelEditor(settings, app.page, api.url)
    await editor.getByLabel(text['editor.apiKey'], { exact: true }).fill(modelFixture.key)
    const save = editor.getByRole('button', { name: text['editor.save'], exact: true })
    expect(await save.isDisabled()).toBe(true)
    const trust = editor.getByRole('checkbox', { name: text['editor.trust'].replace('{ref}', modelFixture.credentialRef), exact: true })
    expect(await trust.isChecked()).toBe(false)
    await trust.check()
    await app.screenshot('search-model-custom-editor-trusted')
    await save.click()
    await editor.waitFor({ state: 'hidden' })
    const config = () => composedRows(e2e).find(candidate => candidate.id === SEARCH.rowId)!.config
    const expected = { connections: { [modelFixture.connectionId]: { kind: 'model', protocol: 'anthropic-messages', model: modelFixture.model, label: modelFixture.label, endpoint: api.url, trustedEndpoint: true, credentialRef: modelFixture.credentialRef } } }
    await expect.poll(config).toMatchObject(expected)
    expect(JSON.stringify(config())).not.toContain(modelFixture.key)
    await closeGui()
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const reopened = await openSearchSettings(app.page)
    await reopened.getByRole('switch', { name: text['services.enable'].replace('{name}', modelFixture.label), exact: true }).waitFor()
    expect(config()).toMatchObject(expected)
    expect(app.errors).toEqual([])
    await closeGui()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try { expect(await host.ctx.credentials.describe(customKey)).toMatchObject({ configured: true }) } finally { await host.dispose() }
    expect(api.requests).toEqual([])
  })

  it.each(matrix)('captures model settings, editor and menu at $width px in $scheme', async ({ width, scheme }) => {
    // Screenshots must not inherit native blank-session restoration/model preferences
    // from the functional cases. Each viewport has the same isolated declarative state.
    const isolated = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = isolated.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(isolated, [profile], plugins)
    isolated.env.DEEPSEEK_BASE_URL = new URL('anthropic', api.url).href
    writeFileSync(profilePatchPath(isolated), stringify([{
      id: SEARCH.rowId, config: { ...modelDocument(api.url), defaultConnection: 'builtin:session-model' },
    }]))
    server = await startWeb(isolated)
    app = await openApp(server.url, { viewport: { width: 1280, height: 1100 } })
    await newSession(app.page)
    await setTheme(app.page, scheme)
    const settings = await openSearchSettings(app.page)
    await settings.getByRole('button', { name: configureName, exact: true }).click()
    await settings.getByText(text['services.sessionModel.note'], { exact: true }).waitFor()
    await modelViewport(app.page, width)
    await settings.getByRole('button', { name: configureName, exact: true }).scrollIntoViewIfNeeded()
    await expectTheme(app.page, scheme)
    await app.screenshot('search-model-session-expanded-' + width + '-' + scheme)
    const sessionRow = settings.getByRole('listitem').filter({ has: app.page.getByRole('button', { name: configureName, exact: true }) })
    await modelGroups(sessionRow, 'search-model-session-options-' + width + '-' + scheme)
    // Edit the previously saved custom connection; consent remains visible and checked.
    const custom = settings.getByRole('listitem').filter({ has: app.page.getByRole('switch', { name: text['services.enable'].replace('{name}', modelFixture.label), exact: true }) })
    await custom.getByRole('button', { name: text['custom.edit'], exact: true }).click()
    const editor = custom.getByRole('form', { name: text['editor.titleEdit'].replace('{id}', modelFixture.connectionId), exact: true })
    const trust = editor.getByRole('checkbox', { name: text['editor.trust'].replace('{ref}', modelFixture.credentialRef), exact: true })
    expect(await trust.isChecked()).toBe(true)
    await editor.scrollIntoViewIfNeeded()
    await app.screenshot('search-model-custom-editor-' + width + '-' + scheme)
    await trust.scrollIntoViewIfNeeded()
    await app.screenshot('search-model-custom-editor-trust-' + width + '-' + scheme)
    await editor.getByRole('button', { name: text['editor.cancel'], exact: true }).click()
    await app.page.setViewportSize({ width: 1280, height: 1100 })
    await app.page.getByRole('treeitem', { name: 'New Session', exact: true }).last().click()
    const button = connectionButton(app.page)
    const accessibleName = await button.getAttribute('aria-label')
    await modelViewport(app.page, width)
    expect(await button.getAttribute('aria-label')).toBe(accessibleName)
    expect(await button.getAttribute('title')).toBe(accessibleName)
    const menu = await openConnections(app.page)
    const search = await openConnectionTab(menu, text['section.title'])
    const modelRow = search.getByRole('menuitemradio', { name: new RegExp('^' + modelName + '(?: |$)') })
    await modelRow.scrollIntoViewIfNeeded()
    await modelRow.getByText(text['status.sessionModelNeedsKey'], { exact: true }).waitFor()
    if (width === 390) {
      expect(await modelRow.isVisible()).toBe(true)
      expect(await button.getAttribute('aria-label')).toBe(accessibleName)
    }
    await app.screenshot('search-model-menu-' + width + '-' + scheme)
    expect(api.requests).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('shows a hand-written pi-ai session route as ready without making a model request', async () => {
    // Independent home: GUI checks its current conversation; cold persistence is
    // covered separately by the Host Remote, never the shell's sidebar restore.
    const isolated = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = isolated.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(isolated, [profile], plugins)
    isolated.env.DEEPSEEK_BASE_URL = new URL('anthropic', api.url).href
    const overlay = join(dirname(isolated.env.DSH_HOME!), 'model-ui-pi-ai.yml')
    writeFileSync(overlay, stringify([
      ...piAiRows(api.url),
      { id: 'agent-default-model', config: piAiFixture },
      { id: SEARCH.rowId, config: { version: 2, defaultConnection: 'builtin:session-model' } },
    ]))
    enterIsolatedEnvironment(isolated.env)
    const writer = await bootHost(isolated, [overlay])
    try { await writer.ctx.credentials.set(customKey, modelFixture.key) } finally { await writer.dispose() }
    try {
      server = await startWeb(isolated, [overlay])
      app = await openApp(server.url)
      await newSession(app.page)
      const menu = await openConnections(app.page)
      const search = await openConnectionTab(menu, text['section.title'])
      const row = search.getByRole('menuitemradio', { name: new RegExp('^' + modelName + '(?: |$)') })
      await row.getByText(text['status.sessionModelReady'].replace('{access}', text['access.apiKey']), { exact: true }).waitFor()
      expect(await row.getAttribute('aria-checked')).toBe('true')
      await app.screenshot('search-model-menu-pi-ai')
      expect(api.requests).toEqual([])
      expect(app.errors).toEqual([])
    } finally {
      await closeGui()
      enterIsolatedEnvironment(isolated.env)
      const host = await bootHost(isolated, [overlay])
      try {
        await host.ctx.credentials.unset(customKey)
        for (const memory of (await host.ctx.searchConnections.pairings({})).pairings) await host.ctx.searchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
      } finally { await host.dispose() }
    }
  })

  it('captures Chinese Session model settings at 1280 px in light', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    // Settle the native welcome before opening the account popover.
    await openBundle(app.page)
    await setTheme(app.page, 'light')
    const storageState = await app.page.context().storageState()
    const url = app.page.url()
    await app.close()
    app = await openApp(url, { locale: 'zh-CN', storageState, viewport: { width: 1280, height: 1100 } })
    await app.page.getByRole('navigation', { name: '全局面板', exact: true }).getByRole('button', { name: '插件', exact: true }).click()
    await app.page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^查看/ }).click()
    await app.page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^配置.*增强网页搜索$/ }).click()
    const settings = app.page.locator('[data-plugin-row-detail="' + rowConfigKey(SEARCH) + '"]')
    const configure = settings.getByRole('button', { name: zh['services.configureLabel'].replace('{name}', zh['connection.sessionModel']), exact: true })
    await configure.click()
    await settings.getByText(zh['services.sessionModel.note'], { exact: true }).waitFor()
    await configure.scrollIntoViewIfNeeded()
    await expectTheme(app.page, 'light')
    await app.screenshot('search-model-session-expanded-zh-1280-light')
    const row = settings.getByRole('listitem').filter({ has: app.page.getByRole('button', { name: zh['services.configureLabel'].replace('{name}', zh['connection.sessionModel']), exact: true }) })
    await modelGroups(row, 'search-model-session-options-zh-1280-light')
    expect(api.requests).toEqual([])
    expect(app.errors).toEqual([])
  })
})
