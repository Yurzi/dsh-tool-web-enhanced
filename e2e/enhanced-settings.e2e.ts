import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import type { Page } from 'playwright-core'
import { FETCH, PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { CATALOG as searchCatalog } from '../packages/search-enhanced/src/catalog.ts'
import { CATALOG as fetchCatalog } from '../packages/fetch-enhanced/src/catalog.ts'
import { en as searchText, zh as searchZh } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText, zh as fetchZh } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiText, zh as uiZh } from '../packages/ui/src/client/locales.ts'
import searchMeta from '../packages/search-enhanced/locale/zh.json'
import fetchMeta from '../packages/fetch-enhanced/locale/zh.json'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { newSession, openBundle, openConnectionTab, openConnections, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { modelViewport } from './harness/model-visuals.ts'
import { expectTheme, setTheme } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
let e2e: ReturnType<typeof isolatedContext>
const require = createRequire(join(base.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { ToolCallId: callId } = require('@deepseek-ai/dsh-llm') as { ToolCallId: typeof ToolCallId }
const matrix = [1280, 768, 390].flatMap(width => (['light', 'dark'] as const).flatMap(scheme =>
  (['en-US', 'zh-CN'] as const).map(locale => ({ width, scheme, locale }))))

async function chineseSettings(page: Page, capability: typeof SEARCH) {
  await page.getByRole('navigation', { name: '全局面板', exact: true }).getByRole('button', { name: '插件', exact: true }).click()
  const back = page.getByRole('button', { name: /^返回/ }).filter({ hasText: '增强网页工具' })
  if (await back.isVisible()) await back.click()
  const bundle = page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]')
  if (!await bundle.isVisible()) await page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^查看/ }).click()
  const title = capability === SEARCH ? searchMeta.meta.title : fetchMeta.meta.title
  await bundle.getByRole('button', { name: '配置 ' + title, exact: true }).click()
  const settings = page.locator('[data-plugin-row-detail="' + rowConfigKey(capability) + '"]')
  await settings.waitFor()
  return settings
}

describe.skipIf(chromiumPath === undefined && !browserRequired)('Enhanced consent and remote opt-in in a fresh GUI', () => {
  let server: WebServer
  let app: App | undefined

  beforeEach(() => {
    e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
  })
  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'enhanced-settings-failure')
    } finally {
      if (app !== undefined) { await app.close(); app = undefined }
      if (server !== undefined) await server.stop()
    }
  })
  afterAll(async () => {
    if (app !== undefined) await app.close()
  })

  it.each(matrix)('shows consent, remote defaults and menu hints at $width px in $scheme / $locale', async ({ width, scheme, locale }) => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    await newSession(app.page)
    await openBundle(app.page)
    await setTheme(app.page, scheme)
    if (locale === 'zh-CN') {
      const url = app.page.url()
      const storageState = await app.page.context().storageState()
      await app.close()
      app = await openApp(url, { locale, storageState })
    }
    const { page } = app
    const uiCopy = locale === 'zh-CN' ? uiZh : uiText
    const name = 'm5-settings-' + width + '-' + scheme + '-' + locale
    async function capture(suffix: string) {
      await reviewScreenshot(app!, name + '-' + suffix)
    }
    for (const capability of [SEARCH, FETCH]) {
      await page.setViewportSize({ width: 1280, height: 1100 })
      const text = capability === SEARCH ? (locale === 'zh-CN' ? searchZh : searchText) : (locale === 'zh-CN' ? fetchZh : fetchText)
      const settings = locale === 'zh-CN' ? await chineseSettings(page, capability)
        : capability === SEARCH ? await openSearchSettings(page) : await openFetchSettings(page, false)
      await modelViewport(page, width, locale === 'zh-CN' ? '全局面板' : 'Global panels')
      const enhanced = settings.getByRole('group', { name: text['enhanced.title'], exact: true })
      await enhanced.evaluate(element => { element.scrollIntoView({ block: 'center' }) })
      expect((await enhanced.getAttribute('aria-describedby'))!.split(' ')).toHaveLength(2)
      await settings.getByText(text['enhanced.description'], { exact: true }).waitFor()
      await settings.getByText(text['enhanced.consent'], { exact: true }).waitFor()
      await expectTheme(page, scheme)
      await capture(capability.rowId + '-consent')
      const enhancedSwitch = enhanced.getByRole('switch', { name: text['enhanced.title'], exact: true })
      expect(await enhancedSwitch.isChecked()).toBe(false)
      if (scheme === 'dark' && width !== 768) {
        await enhancedSwitch.click()
        await expect.poll(() => composedRows(e2e).find(row => row.id === capability.rowId)!.config).toMatchObject({ enhancedTools: true })
        await capture(capability.rowId + '-consent-on')
        await enhancedSwitch.click()
        await expect.poll(() => composedRows(e2e).find(row => row.id === capability.rowId)!.config).not.toHaveProperty('enhancedTools')
      }
      const notice = settings.getByText(text['services.optInNotice'], { exact: true })
      await settings.getByRole('heading', { name: text['services.title'], exact: true }).evaluate(element => { element.scrollIntoView({ block: 'start' }) })
      await notice.waitFor()
      await capture(capability.rowId + '-services')
      const catalog = capability === SEARCH ? searchCatalog : fetchCatalog
      const remoteServices = Object.values(catalog).filter(item => item.optIn)
      for (const descriptor of remoteServices) {
        expect(await settings.getByRole('switch', { name: text['services.enable'].replace('{name}', descriptor.label), exact: true }).isChecked()).toBe(false)
      }
      const lastService = remoteServices.at(-1)!
      const lastRow = settings.getByRole('listitem').filter({ has: page.getByRole('switch', { name: text['services.enable'].replace('{name}', lastService.label), exact: true }) })
      await lastRow.evaluate(element => { element.scrollIntoView({ block: 'end' }) })
      expect(await lastRow.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight })).toBe(true)
      await capture(capability.rowId + '-services-bottom')
      expect(readFileSync(join(artifacts, name + '-' + capability.rowId + '-consent.png')).equals(
        readFileSync(join(artifacts, name + '-' + capability.rowId + '-services.png')))).toBe(false)
    }
    // The native sidebar action is localized by DSH, while plugin labels come from their dictionaries.
    await page.setViewportSize({ width: 1280, height: 1100 })
    await page.getByRole('button', { name: locale === 'zh-CN' ? '新建会话' : 'New session', exact: true }).last().click()
    await page.locator('[data-conversation-session]:visible').waitFor()
    await modelViewport(page, width, locale === 'zh-CN' ? '全局面板' : 'Global panels')
    const menu = await openConnections(page, uiCopy)
    for (const title of locale === 'zh-CN' ? [searchZh['section.title'], fetchZh['section.title']] : [searchText['section.title'], fetchText['section.title']]) {
      const panel = await openConnectionTab(menu, title)
      const hint = panel.getByRole('button', { name: uiCopy['menu.moreServices'], exact: true })
      await hint.waitFor()
      await capture(title === searchText['section.title'] || title === searchZh['section.title'] ? 'search-menu-hint' : 'fetch-menu-hint')
      expect(await hint.isVisible()).toBe(true)
      const catalog = title === searchText['section.title'] || title === searchZh['section.title'] ? searchCatalog : fetchCatalog
      for (const service of Object.values(catalog).filter(item => item.optIn)) {
        expect(await panel.getByRole('menuitemradio', { name: new RegExp('^' + service.label + '(?: |$)') }).count()).toBe(0)
      }
    }
    await page.keyboard.press('Escape')
    expect(app.errors).toEqual([])
  })

  it('enables a remote service in settings, then exposes it in the menu and a new Agent provider list', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const { page } = app
    const settings = await openFetchSettings(page, false)
    const enabled = settings.getByRole('switch', { name: fetchText['services.enable'].replace('{name}', 'Firecrawl'), exact: true })
    expect(await enabled.isChecked()).toBe(false)
    await enabled.click()
    await expect.poll(() => composedRows(e2e).find(row => row.id === FETCH.rowId)!.config).toMatchObject({
      connections: { 'builtin:firecrawl': { disabled: false } },
    })
    // Read the committed descriptor revision before editing another section.
    await page.reload()
    const refreshed = await openFetchSettings(page, false)
    await refreshed.getByRole('switch', { name: fetchText['enhanced.title'], exact: true }).click()
    await expect.poll(() => composedRows(e2e).find(row => row.id === FETCH.rowId)!.config).toMatchObject({
      enhancedTools: true, connections: { 'builtin:firecrawl': { disabled: false } },
    })
    await newSession(page)
    const menu = await openConnections(page)
    const panel = await openConnectionTab(menu, fetchText['section.title'])
    const caption = fetchText['status.remoteReady'].replace('{access}', fetchText['access.keyless']).replace('{name}', 'Firecrawl')
    await panel.getByRole('menuitemradio').filter({ hasText: caption }).waitFor()
    expect(await panel.getByRole('button', { name: uiText['menu.moreServices'], exact: true }).count()).toBe(0)
    await reviewScreenshot(app, 'm5-remote-enabled-menu')
    await app.close()
    app = undefined
    await server.stop()
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try {
      const { sessionId } = await host.ctx.sessionController.create({ cwd: e2e.env.DSH_HOME! })
      const resolved = await host.ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      await host.ctx.waterfall('agent/request', { agent: resolved.agent, turn: 1, step: 0, signal: new AbortController().signal } as never,
        (async () => ({ provider: 'e2e', model: 'e2e' })) as never)
      const listed = await host.ctx.tools.execute({ name: FETCH.tools.list, arguments: {}, callId: callId('m5-enabled-list'),
        signal: new AbortController().signal, agent: resolved.agent })
      expect(listed.isError, JSON.stringify(listed)).toBe(false)
      expect(JSON.stringify(listed.value)).toContain('builtin:firecrawl')
      const view = await host.ctx.fetchConnections.get({ sessionId })
      expect(view.connections.find(connection => connection.id === 'builtin:firecrawl')).toMatchObject({ status: 'ready' })
    } finally { await host.dispose() }
  })
})
