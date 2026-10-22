import { copyFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Locator } from 'playwright-core'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import { PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, afterEach, describe, expect, inject, it } from 'vitest'
import { MODEL_PROTOCOLS, type ModelProtocol } from '../packages/search-enhanced/src/catalog.ts'
import { en as text, zh, type LocaleKey } from '../packages/search-enhanced/src/client/locales.ts'
import { zh as uiZh } from '../packages/ui/src/client/locales.ts'
import { messagesAnswer, modelDocument, modelFixture, piAiFixture, piAiRows } from './fixtures/search-model.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows, enterIsolatedEnvironment, profilePatchPath, type E2EContext } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startModelApi } from './harness/model-api.ts'
import { modelViewport } from './harness/model-visuals.ts'
import { openConnectionTab, newSession, openConnections, openSearchSettings } from './harness/navigation.ts'
import { setTheme } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const require = createRequire(join(base.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const credentials = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const key = credentials.credentialRef(modelFixture.credentialRef)
const missingLabel = 'E2E missing model'
const configureName = text['services.configureLabel'].replace('{name}', text['connection.sessionModel'])
const domainGroup = MODEL_PROTOCOLS['anthropic-messages'].label + ' / ' + MODEL_PROTOCOLS['openai-responses'].label

describe.skipIf(chromiumPath === undefined && !browserRequired)('Model UI review element evidence', () => {
  let e2e: E2EContext | undefined
  let api: Awaited<ReturnType<typeof startModelApi>> | undefined
  let app: App | undefined
  let server: WebServer | undefined
  let evidence = 0

  async function world(extraRows: object[] = []) {
    e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startModelApi(messagesAnswer())
    e2e.env.DEEPSEEK_BASE_URL = new URL('anthropic', api.url).href
    const config = modelDocument(api.url)
    writeFileSync(profilePatchPath(e2e), stringify([
      { id: SEARCH.rowId, config: { ...config, defaultConnection: 'builtin:session-model', connections: {
        ...config.connections,
        'custom:e2e-no-key': { ...config.connections[modelFixture.connectionId], label: missingLabel, credentialRef: 'E2E_MISSING_MODEL_KEY' },
      } } },
      ...extraRows,
    ]))
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try { await host.ctx.credentials.set(key, modelFixture.key) } finally { await host.dispose() }
    server = await startWeb(e2e)
    app = await openApp(server.url, { viewport: { width: 1280, height: 1100 } })
    const sessionId = await newSession(app.page)
    await setTheme(app.page, 'light')
    return { e2e, api, sessionId, app }
  }

  async function shot(locator: Locator, name: string) {
    await expect.poll(() => app!.page.locator('body > [role="alert"]').count()).toBe(0)
    await locator.scrollIntoViewIfNeeded()
    await locator.screenshot({ path: join(artifacts, 'search-model-review-' + name + '.png') })
  }

  async function draft(settings: Locator, protocol: ModelProtocol, copy: Readonly<Record<LocaleKey, string>> = text) {
    const browser = app!
    await settings.getByRole('button', { name: copy['custom.addStructured'], exact: true }).click()
    const editor = settings.getByRole('form', { name: copy['editor.titleNew'], exact: true })
    await editor.getByRole('textbox', { name: copy['editor.id'], exact: true }).fill('review-draft')
    await editor.getByRole('textbox', { name: copy['editor.label'], exact: true }).fill('Review model draft')
    await editor.getByRole('button', { name: copy['editor.adapter'], exact: true }).click()
    await browser.page.getByRole('menuitem', { name: copy['model.format'].replace('{protocol}', MODEL_PROTOCOLS[protocol].label), exact: true }).click()
    await editor.getByRole('textbox', { name: copy['model.id'], exact: true }).fill(modelFixture.model)
    await editor.getByRole('textbox', { name: copy['editor.endpoint'], exact: true }).fill(api!.url)
    await editor.getByRole('textbox', { name: copy['editor.credentialRef'], exact: true }).fill(modelFixture.credentialRef)
    return editor
  }

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'search-model-review-' + evidence + '-failure')
    } finally {
      try {
        if (app !== undefined) { await app.close(); app = undefined }
        if (server !== undefined) {
          await server.stop(); server = undefined
          copyFileSync(join(artifacts, 'web.log'), join(artifacts, 'search-model-review-web-' + evidence + '.log'))
        }
        if (e2e !== undefined) {
          enterIsolatedEnvironment(e2e.env)
          const host = await bootHost(e2e)
          try {
            await host.ctx.credentials.unset(key)
            for (const memory of (await host.ctx.searchConnections.pairings({})).pairings) await host.ctx.searchConnections.forgetPairing({ provider: memory.provider, model: memory.model })
          } finally { await host.dispose() }
          e2e = undefined
        }
      } finally {
        if (api !== undefined) {
          try {
            writeFileSync(join(artifacts, 'search-model-review-wire-' + evidence + '.json'), JSON.stringify(api.requests, null, 2))
            expect(api.requests).toEqual([])
          } finally { await api.close(); api = undefined }
        }
        evidence++
      }
    }
  })
  afterAll(() => { expect(app).toBeUndefined(); expect(server).toBeUndefined(); expect(api).toBeUndefined() })

  it.each([1280, 390])('captures list states, unchecked trust, fixed rows and menu at %i px', async width => {
    const { app: browser, e2e: isolated } = await world()
    await modelViewport(browser.page, width)
    const settings = await openSearchSettings(browser.page)
    await shot(settings.locator('section').filter({ has: browser.page.getByRole('heading', { name: text['defaults.title'], exact: true }) }), 'defaults-' + width + '-light')
    await settings.getByRole('button', { name: configureName, exact: true }).click()
    const row = settings.getByRole('listitem').filter({ has: browser.page.getByRole('button', { name: configureName, exact: true }) })
    const group = row.getByRole('group', { name: domainGroup, exact: true })
    const allowed = group.getByRole('textbox', { name: text['option.model.allowedDomains'], exact: true })
    const blocked = group.getByRole('textbox', { name: text['option.model.blockedDomains'], exact: true })
    await allowed.fill('example.org\ndocs.example.org/api')
    await allowed.blur()
    await expect.poll(() => composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).toMatchObject({ connections: { 'builtin:session-model': { options: { allowedDomains: ['example.org', 'docs.example.org/api'] } } } })
    await shot(group, 'list-valid-' + width + '-light')
    await allowed.fill('example.org\nhttps://invalid.example')
    await expect.poll(() => allowed.getAttribute('aria-invalid')).toBe('true')
    expect(await allowed.getAttribute('aria-describedby')).toContain('-error')
    await shot(group, 'list-invalid-item-' + width + '-light')
    await allowed.fill(Array.from({ length: 101 }, (_, index) => 'site' + index + '.example.org').join('\n'))
    await group.getByText(text['options.tooMany'].replace('{max}', '100'), { exact: true }).waitFor()
    await shot(group, 'list-too-many-' + width + '-light')
    await allowed.fill('example.org')
    await allowed.blur()
    await expect.poll(() => composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).toMatchObject({ connections: { 'builtin:session-model': { options: { allowedDomains: ['example.org'] } } } })
    await blocked.fill('blocked.example.org')
    await blocked.blur()
    await expect.poll(() => allowed.getAttribute('aria-invalid')).toBe('true')
    await expect.poll(() => blocked.getAttribute('aria-invalid')).toBe('true')
    const sessionConflict = group.getByText(text['options.exclusive'].replace('{other}', text['option.model.allowedDomains']), { exact: true })
    await sessionConflict.waitFor()
    expect(composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).not.toHaveProperty('connections.builtin:session-model.options.blockedDomains')
    await shot(group, 'list-both-session-' + width + '-light')
    await shot(sessionConflict, 'list-both-session-error-' + width + '-light')
    // Resolving the conflict must persist the held list without another edit or
    // blur on that list, under the real settings validator and revision fence.
    await allowed.fill('')
    await allowed.blur()
    await expect.poll(() => composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).toMatchObject({ connections: { 'builtin:session-model': { options: { blockedDomains: ['blocked.example.org'] } } } })
    expect(composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).not.toHaveProperty('connections.builtin:session-model.options.allowedDomains')
    await expect.poll(() => blocked.getAttribute('aria-invalid')).toBe('false')
    expect(await row.getByRole('alert').count()).toBe(0)
    await settings.getByRole('button', { name: configureName, exact: true }).click()
    await settings.getByRole('button', { name: configureName, exact: true }).click()
    expect(await blocked.inputValue()).toBe('blocked.example.org')
    expect(await allowed.inputValue()).toBe('')
    await settings.getByRole('button', { name: configureName, exact: true }).click()

    const editor = await draft(settings, 'anthropic-messages')
    const trust = editor.getByRole('checkbox', { name: text['editor.trust'].replace('{ref}', modelFixture.credentialRef), exact: true })
    expect(await trust.isChecked()).toBe(false)
    const save = editor.getByRole('button', { name: text['editor.save'], exact: true })
    expect(await save.isDisabled()).toBe(true)
    await trust.scrollIntoViewIfNeeded()
    await browser.screenshot('search-model-review-trust-off-' + width + '-light')
    await save.scrollIntoViewIfNeeded()
    await editor.getByText(text['draft.trust'], { exact: true }).waitFor()
    await browser.screenshot('search-model-review-save-disabled-' + width + '-light')
    await trust.check()
    await editor.getByRole('textbox', { name: text['option.model.allowedDomains'], exact: true }).fill('example.org')
    await editor.getByRole('textbox', { name: text['option.model.blockedDomains'], exact: true }).fill('blocked.example.org')
    const editorBlocked = editor.getByRole('textbox', { name: text['option.model.blockedDomains'], exact: true })
    await expect.poll(() => editorBlocked.getAttribute('aria-invalid')).toBe('true')
    expect(await editorBlocked.getAttribute('aria-describedby')).toContain('-error')
    const editorConflict = editor.getByText(text['options.exclusive'].replace('{other}', text['option.model.allowedDomains']), { exact: true })
    await editorConflict.waitFor()
    await save.click()
    await editor.getByText(text['draft.options'], { exact: true }).waitFor()
    expect(composedRows(isolated).find(candidate => candidate.id === SEARCH.rowId)!.config).not.toHaveProperty('connections.custom:review-draft')
    await editorBlocked.scrollIntoViewIfNeeded()
    await expect.poll(() => browser.page.locator('body > [role="alert"]').count()).toBe(0)
    await browser.screenshot('search-model-review-list-both-anthropic-' + width + '-light')
    await shot(editorConflict, 'list-both-anthropic-error-' + width + '-light')
    await editor.getByRole('button', { name: text['editor.cancel'], exact: true }).click()

    const fixed = settings.getByRole('listitem').filter({ has: browser.page.getByRole('switch', { name: text['services.enable'].replace('{name}', modelFixture.label), exact: true }) })
    await shot(fixed, 'fixed-list-' + width + '-light')
    await modelViewport(browser.page, 1280)
    await browser.page.getByRole('treeitem', { name: 'New Session', exact: true }).last().click()
    await modelViewport(browser.page, width)
    const menu = await openConnections(browser.page)
    const search = await openConnectionTab(menu, text['section.title'])
    const ready = search.getByRole('menuitemradio', { name: new RegExp('^' + modelFixture.label + '(?: |$)') })
    await ready.getByText(text['status.modelReady'].replace('{access}', text['access.apiKey']).replace('{name}', modelFixture.label), { exact: true }).waitFor()
    await shot(ready, 'fixed-menu-ready-' + width + '-light')
    const missing = search.getByRole('menuitemradio', { name: new RegExp('^' + missingLabel + '(?: |$)') })
    await missing.getByText(text['status.needsCredential'], { exact: true }).waitFor()
    await shot(missing, 'fixed-menu-needs-key-' + width + '-light')
    expect(browser.errors).toEqual([])
  })

  it.each(['openai-responses', 'openai-chat-completions'] as const)('captures %s editor at 390 px', async protocol => {
    const { app: browser } = await world()
    const settings = await openSearchSettings(browser.page)
    const editor = await draft(settings, protocol)
    await modelViewport(browser.page, 390)
    await editor.getByRole('button', { name: text['editor.adapter'], exact: true }).scrollIntoViewIfNeeded()
    await browser.screenshot('search-model-review-editor-' + protocol + '-390-light')
    const trust = editor.getByRole('checkbox', { name: text['editor.trust'].replace('{ref}', modelFixture.credentialRef), exact: true })
    await trust.scrollIntoViewIfNeeded()
    await browser.screenshot('search-model-review-editor-' + protocol + '-trust-390-light')
    await editor.getByRole('button', { name: text['editor.cancel'], exact: true }).click()
    expect(browser.errors).toEqual([])
  })

  it.each(['protocol', 'headers', 'account'] as const)('captures the %s Session model reason without model I/O', async reason => {
    // All declared API endpoints remain loopback even when the protocol cannot be inferred.
    // The protocol case deliberately uses pi-ai catalog inference, not an explicit api.
    const profile = reason === 'protocol'
      ? { provider: 'openai', model: 'gpt-4o' }
      : reason === 'headers' ? piAiFixture : { provider: 'deepseek-account', model: 'deepseek-flash' }
    const isolated = isolatedContext(base)
    const { [PROFILE_PACKAGE]: bundle, ...plugins } = isolated.tarballs
    if (bundle === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(isolated, [bundle], plugins)
    api = await startModelApi(messagesAnswer())
    e2e = isolated
    isolated.env.DEEPSEEK_BASE_URL = new URL('anthropic', api.url).href
    const providers = reason === 'protocol'
      ? { openai: { baseURL: api.url, apiKeyEnv: modelFixture.credentialRef, models: [{ id: profile.model }] } }
      : { [piAiFixture.provider]: { ...piAiRows(api.url)[0]!.config.providers[piAiFixture.provider], headers: { 'x-e2e-custom': 'unsupported' } } }
    writeFileSync(profilePatchPath(isolated), stringify([
      { id: SEARCH.rowId, config: { version: 2, defaultConnection: 'builtin:session-model' } },
      { id: 'agent-default-model', config: profile },
      ...(reason === 'account' ? [] : [{ id: 'llm-pi-ai', config: { providers } }]),
    ]))
    server = await startWeb(isolated)
    app = await openApp(server.url)
    await newSession(app.page)
    await setTheme(app.page, 'light')
    const menu = await openConnections(app.page)
    const search = await openConnectionTab(menu, text['section.title'])
    const row = search.getByRole('menuitemradio', { name: new RegExp('^' + text['connection.sessionModel'] + '(?: |$)') })
    const message = reason === 'account' ? text['status.sessionModelNeedsSignIn'] : text[reason === 'headers' ? 'status.reason.headers' : 'status.reason.protocol']
    await row.getByText(message, { exact: true }).waitFor()
    // Native independent-home workspace notifications are unrelated to this menu.
    await menu.screenshot({ path: join(artifacts, 'search-model-review-session-' + reason + '-1280-light.png') })
    await app.page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    await modelViewport(app.page, 390)
    const narrowMenu = await openConnections(app.page)
    await openConnectionTab(narrowMenu, text['section.title'])
    await row.getByText(message, { exact: true }).waitFor()
    await row.scrollIntoViewIfNeeded()
    const box = await narrowMenu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await narrowMenu.screenshot({ path: join(artifacts, 'search-model-review-session-' + reason + '-390-light.png') })
    expect(app.errors).toEqual([])
  })

  it('captures Chinese model editor and Session model menu in light', async () => {
    const { app: initial, sessionId } = await world()
    const storageState = await initial.page.context().storageState()
    const url = initial.page.url()
    await initial.close()
    app = await openApp(url, { locale: 'zh-CN', storageState, viewport: { width: 1280, height: 1100 } })
    await app.page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
    const menu = await openConnections(app.page, uiZh)
    const search = await openConnectionTab(menu, zh['section.title'])
    await search.getByText(zh['status.sessionModelNeedsKey'], { exact: true }).waitFor()
    await app.screenshot('search-model-review-menu-zh-1280-light')
    await app.page.keyboard.press('Escape')
    await app.page.getByRole('navigation', { name: '全局面板', exact: true }).getByRole('button', { name: '插件', exact: true }).click()
    await app.page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^查看/ }).click()
    await app.page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^配置.*增强网页搜索$/ }).click()
    const settings = app.page.locator('[data-plugin-row-detail="' + rowConfigKey(SEARCH) + '"]')
    const editor = await draft(settings, 'anthropic-messages', zh)
    await editor.scrollIntoViewIfNeeded()
    await app.screenshot('search-model-review-editor-zh-1280-light')
    await editor.getByRole('checkbox', { name: zh['editor.trust'].replace('{ref}', modelFixture.credentialRef), exact: true }).scrollIntoViewIfNeeded()
    await app.screenshot('search-model-review-editor-trust-zh-1280-light')
    await editor.getByRole('button', { name: zh['editor.cancel'], exact: true }).click()
    expect(app.errors).toEqual([])
  })
})
