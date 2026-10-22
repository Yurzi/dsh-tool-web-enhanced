import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { FETCH, PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, inject, it } from 'vitest'
import { en as searchEn, zh as searchZh } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchEn, zh as fetchZh } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiEn, zh as uiZh } from '../packages/ui/src/client/locales.ts'
import searchMeta from '../packages/search-enhanced/locale/zh.json'
import fetchMeta from '../packages/fetch-enhanced/locale/zh.json'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, composedRows, profileDir, profilePatchPath } from './harness/environment.ts'
import { captureEnhancedToolReview } from './harness/enhanced-tool-review.ts'
import { modelViewport } from './harness/model-visuals.ts'
import { newSession, openBundle, openConnections, openConnectionTab, openSearchSettings, openFetchSettings } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { expectTheme, setTheme } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
type View = { width: number; scheme: 'light' | 'dark'; locale: 'en-US' | 'zh-CN' }
const serviceViews: View[] = [
  { width: 1280, scheme: 'light', locale: 'en-US' },
  { width: 390, scheme: 'dark', locale: 'zh-CN' },
]
const menuViews: View[] = [
  { width: 1280, scheme: 'light', locale: 'zh-CN' },
  { width: 390, scheme: 'dark', locale: 'en-US' },
]
const activationViews: View[] = [
  { width: 1280, scheme: 'light', locale: 'en-US' },
  { width: 1280, scheme: 'light', locale: 'zh-CN' },
  { width: 390, scheme: 'dark', locale: 'zh-CN' },
]
const activationCases = activationViews.flatMap(view =>
  (['no-preflight', 'real-preflight'] as const).map(condition => ({ ...view, condition })))

function viewName(view: View): string {
  return view.width + '-' + view.scheme + '-' + view.locale
}

async function center(target: Locator): Promise<void> {
  await target.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
}

async function openSettings(page: Page, capability: typeof SEARCH, locale: View['locale']): Promise<Locator> {
  // DSH's navigation labels and the plugin's metadata have separate locale owners.
  if (locale === 'en-US') return capability === SEARCH ? openSearchSettings(page) : openFetchSettings(page, false)
  await page.getByRole('navigation', { name: '全局面板', exact: true }).getByRole('button', { name: '插件', exact: true }).click()
  const back = page.getByRole('button', { name: /^返回/ }).filter({ hasText: '增强网页工具' })
  if (await back.isVisible()) await back.click()
  const bundle = page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]')
  if (!await bundle.isVisible()) {
    await page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^查看/ }).click()
  }
  const title = capability === SEARCH ? searchMeta.meta.title : fetchMeta.meta.title
  await bundle.getByRole('button', { name: '配置 ' + title, exact: true }).click()
  const settings = page.locator('[data-plugin-row-detail="' + rowConfigKey(capability) + '"]')
  await settings.waitFor()
  return settings
}

async function menuBox(menu: Locator) {
  const box = await menu.boundingBox()
  if (box === null) throw new Error('The visible connections menu has no bounding box')
  return box
}

async function expectSameMenuBox(menu: Locator, expected: Awaited<ReturnType<typeof menuBox>>): Promise<void> {
  await expect.poll(async () => {
    const box = await menuBox(menu)
    return Math.max(...(['x', 'y', 'width', 'height'] as const).map(key => Math.abs(box[key] - expected[key])))
  }).toBeLessThanOrEqual(1)
}

describe.skipIf(chromiumPath === undefined && !browserRequired)('M5 supplemental visual review', () => {
  it.each(serviceViews)('captures genuine tool outcomes at $width / $scheme / $locale', async view => {
    // The helper owns its isolated installation, loopback fixtures and cleanup.
    await captureEnhancedToolReview(base, view)
  })

  describe('Remote service panels, menus and first activation', () => {
    let e2e: ReturnType<typeof isolatedContext>
    let app: App | undefined
    let server: WebServer | undefined

    beforeEach(() => {
      e2e = isolatedContext(base)
      const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
      if (profile === undefined) throw new Error('The global setup did not pack the profile bundle')
      addPlugins(e2e, [profile], plugins)
    })

    afterEach(async ({ task }) => {
      try {
        if (task.result?.state === 'fail' && app !== undefined) {
          await recordBrowserFailure(app, 'm5-review-' + task.name.replace(/[^a-z0-9-]+/gi, '-') + '-failure')
        }
      } finally {
        try {
          if (app !== undefined) await app.close()
        } finally {
          app = undefined
          try {
            if (server !== undefined) await server.stop()
          } finally { server = undefined }
        }
      }
    })

    async function startSettingsReview(view: View): Promise<App> {
      server = await startWeb(e2e)
      app = await openApp(server.url, { colorScheme: view.scheme, viewport: { width: 1280, height: 1100 } })
      await newSession(app.page)
      await openBundle(app.page)
      await setTheme(app.page, view.scheme)
      if (view.locale === 'zh-CN') {
        const url = app.page.url()
        const storageState = await app.page.context().storageState()
        const errors = [...app.errors]
        await app.close()
        app = undefined
        app = await openApp(url, { locale: view.locale, storageState, colorScheme: view.scheme, viewport: { width: 1280, height: 1100 } })
        app.errors.unshift(...errors)
      }
      await expectTheme(app.page, view.scheme)
      return app
    }

    it.each(serviceViews)('centers expanded remote service notices at $width / $scheme / $locale', async view => {
      const current = await startSettingsReview(view)
      const { page } = current
      const searchCopy = view.locale === 'zh-CN' ? searchZh : searchEn
      const fetchCopy = view.locale === 'zh-CN' ? fetchZh : fetchEn
      const services = [
        { capability: SEARCH, label: 'Exa', slug: 'searchExa-keyless', copy: searchCopy, note: undefined },
        { capability: FETCH, label: 'Firecrawl', slug: 'fetchFirecrawl-keyless', copy: fetchCopy, note: fetchCopy['services.note.firecrawl'] },
        { capability: FETCH, label: 'Tinyfish', slug: 'fetchTinyfish-api-key-only', copy: fetchCopy, note: fetchCopy['services.note.tinyfish'] },
      ]
      for (const service of services) {
        await page.setViewportSize({ width: 1280, height: 1100 })
        const settings = await openSettings(page, service.capability, view.locale)
        const toggle = settings.getByRole('switch', { name: service.copy['services.enable'].replace('{name}', service.label), exact: true })
        expect(await toggle.isChecked()).toBe(false)
        const row = settings.getByRole('listitem').filter({
          has: page.getByRole('switch', { name: service.copy['services.enable'].replace('{name}', service.label), exact: true }),
        })
        const disclosure = row.getByRole('button', { name: service.copy['services.configureLabel'].replace('{name}', service.label), exact: true })
        if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click()
        const id = await disclosure.getAttribute('aria-controls')
        if (id === null) throw new Error('The service disclosure did not identify its panel')
        const panel = row.locator('[id="' + id + '"]')
        await panel.waitFor()
        const recipientText = service.copy['services.remoteNotice'].replace('{name}', service.label)
        const recipient = panel.getByText(recipientText, { exact: true })
        await recipient.waitFor()
        expect(await panel.locator(':scope > p').first().innerText()).toBe(recipientText)
        if (service.note !== undefined) {
          await panel.getByText(service.note, { exact: true }).waitFor()
          expect(await panel.locator(':scope > p').nth(1).innerText()).toBe(service.note)
        }
        if (service.label === 'Tinyfish') {
          expect(await panel.getByRole('tab', { name: service.copy['services.accessKeyless'], exact: true }).count()).toBe(0)
          await panel.getByLabel(fetchCopy['credential.label'], { exact: true }).waitFor()
          expect(await panel.getByRole('button', { name: fetchCopy['credential.save'], exact: true }).isEnabled()).toBe(false)
        } else {
          await panel.getByRole('tab', { name: service.copy['services.accessKeyless'], exact: true, selected: true }).waitFor()
          await panel.getByText(service.copy['services.accessHint.keyless'], { exact: true }).waitFor()
        }
        await modelViewport(page, view.width, view.locale === 'zh-CN' ? '全局面板' : 'Global panels')
        await center(panel)
        await expectTheme(page, view.scheme)
        const name = 'm5-review-services-' + viewName(view) + '-' + service.slug
        await reviewScreenshot(current, name + '-panel-centered')
        // Long API-key-only panels need a second view to keep the recipient and
        // cache/retention text readable, rather than hiding them above the viewport.
        await center(recipient)
        await reviewScreenshot(current, name + '-recipient-notices')
        expect(await toggle.isChecked()).toBe(false)
        await disclosure.click()
      }
      expect(current.errors).toEqual([])
    })

    it.each(menuViews)('keeps the same conversation menu stable after GUI Exa opt-in at $width / $scheme / $locale', async view => {
      const current = await startSettingsReview(view)
      const { page } = current
      const searchCopy = view.locale === 'zh-CN' ? searchZh : searchEn
      const fetchCopy = view.locale === 'zh-CN' ? fetchZh : fetchEn
      const uiCopy = view.locale === 'zh-CN' ? uiZh : uiEn
      const settings = await openSettings(page, SEARCH, view.locale)
      const exa = settings.getByRole('switch', { name: searchCopy['services.enable'].replace('{name}', 'Exa'), exact: true })
      expect(await exa.isChecked()).toBe(false)
      const configureExa = settings.getByRole('button', { name: searchCopy['services.configureLabel'].replace('{name}', 'Exa'), exact: true })
      await configureExa.click()
      // This case has its own fresh home: Exa's catalog route defaults to
      // keyless. Verify that route in this GUI, not in another case's state.
      await settings.getByRole('tab', { name: searchCopy['services.accessKeyless'], exact: true, selected: true }).waitFor()
      await settings.getByText(searchCopy['services.accessHint.keyless'], { exact: true }).waitFor()
      await configureExa.click()
      await exa.click()
      await expect.poll(() => composedRows(e2e).find(row => row.id === SEARCH.rowId)!.config).toMatchObject({
        connections: { 'builtin:exa': { disabled: false } },
      })
      await expect.poll(() => exa.isChecked()).toBe(true)
      // No other remote service or enhanced-tools switch is changed by this flow.
      expect(composedRows(e2e).find(row => row.id === FETCH.rowId)).not.toHaveProperty('config.enhancedTools', true)
      await modelViewport(page, view.width, view.locale === 'zh-CN' ? '全局面板' : 'Global panels')
      await center(settings.getByRole('heading', { name: searchCopy['services.title'], exact: true }))
      await reviewScreenshot(current, 'm5-review-remote-menu-' + viewName(view) + '-exa-on-services-list')
      await page.setViewportSize({ width: 1280, height: 1100 })
      await page.getByRole('button', { name: view.locale === 'zh-CN' ? '新建会话' : 'New session', exact: true }).last().click()
      const conversation = page.locator('[data-conversation-session]:visible')
      await conversation.waitFor()
      const sessionId = await conversation.getAttribute('data-conversation-session')
      expect(sessionId).not.toBeNull()
      await modelViewport(page, view.width, view.locale === 'zh-CN' ? '全局面板' : 'Global panels')
      const menu = await openConnections(page, uiCopy)
      const search = await openConnectionTab(menu, searchCopy['section.title'])
      const ready = searchCopy['status.remoteReady'].replace('{access}', searchCopy['access.keyless']).replace('{name}', 'Exa')
      await search.getByRole('menuitemradio').filter({ hasText: ready }).waitFor()
      expect(await search.getByRole('button', { name: uiCopy['menu.moreServices'], exact: true }).count()).toBe(0)
      expect(await search.getByText(searchCopy['status.disabled'].replace('{name}', 'Firecrawl'), { exact: true }).count()).toBe(0)
      const box = await menuBox(menu)
      await expectTheme(page, view.scheme)
      await reviewScreenshot(current, 'm5-review-remote-menu-' + viewName(view) + '-exa-on-search-no-footer')
      const fetch = await openConnectionTab(menu, fetchCopy['section.title'])
      await fetch.getByRole('button', { name: uiCopy['menu.moreServices'], exact: true }).waitFor()
      expect(await fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).count()).toBe(0)
      await expectSameMenuBox(menu, box)
      await reviewScreenshot(current, 'm5-review-remote-menu-' + viewName(view) + '-exa-on-fetch-retains-footer')
      await openConnectionTab(menu, searchCopy['section.title'])
      await expectSameMenuBox(menu, box)
      expect(await conversation.getAttribute('data-conversation-session')).toBe(sessionId)
      expect(current.errors).toEqual([])
    })

    it.each(activationCases)('captures $condition activation at $width / $scheme / $locale', async view => {
      // Public profile fixture: keep the installed dependency, but start before
      // its first enablement. This avoids unloading a live client bundle merely
      // to reproduce the initial activation guidance.
      const manifestPath = join(profileDir(e2e), 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dsh: { profile: { bundles: string[] } } }
      expect(manifest.dsh.profile.bundles).toContain(PROFILE_PACKAGE)
      manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== PROFILE_PACKAGE)
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      if (view.condition === 'real-preflight') {
        const path = profilePatchPath(e2e)
        const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
        const existing: unknown = source.trim() === '' ? [] : parse(source)
        if (!Array.isArray(existing)) throw new Error('The public profile user patch must be a YAML list')
        writeFileSync(path, stringify([...existing, { id: 'web', config: { fetchProvider: 'http' } }]))
      }
      server = await startWeb(e2e)
      app = await openApp(server.url, {
        colorScheme: view.scheme, viewport: { width: 1280, height: 1100 },
      }, 'keep')
      // Settle native initial workspace restoration through the public picker,
      // just as the settings cases do, before changing the running bundle.
      await newSession(app.page)
      if (view.locale === 'zh-CN') {
        const url = app.page.url()
        const storageState = await app.page.context().storageState()
        const errors = [...app.errors]
        await app.close()
        app = undefined
        app = await openApp(url, {
          locale: view.locale, storageState, colorScheme: view.scheme, viewport: { width: 1280, height: 1100 },
        }, 'keep')
        app.errors.unshift(...errors)
      }
      const { page } = app
      await modelViewport(page, view.width, view.locale === 'zh-CN' ? '全局面板' : 'Global panels')
      const copy = view.locale === 'zh-CN' ? uiZh : uiEn
      // CLI installation alone does not open guidance: the manager deliberately
      // presents it only after explicit enablement on the public bundle list.
      await page.getByRole('navigation', { name: view.locale === 'zh-CN' ? '全局面板' : 'Global panels', exact: true })
        .getByRole('button', { name: view.locale === 'zh-CN' ? '插件' : 'Plugins', exact: true }).click()
      const card = page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]')
      const enabled = card.getByRole('switch')
      await enabled.waitFor()
      expect(await enabled.isChecked()).toBe(false)
      await enabled.click()
      const dialog = page.getByRole('dialog', { name: copy['activation.title'], exact: true })
      await dialog.getByRole('button', { name: copy['activation.open'], exact: true }).hover()
      await dialog.waitFor()
      await expectTheme(page, view.scheme)
      if (view.condition === 'real-preflight') {
        await dialog.getByText(copy['activation.preflight'], { exact: true }).waitFor()
        expect(await dialog.getByText(copy['activation.remoteOff'], { exact: true }).count()).toBe(0)
        expect(composedRows(e2e).find(row => row.id === 'web')!.config).toMatchObject({ fetchProvider: 'http' })
      } else {
        await dialog.getByText(copy['activation.body'], { exact: true }).waitFor()
        await dialog.getByText(copy['activation.remoteOff'], { exact: true }).waitFor()
        expect(await dialog.getByText(copy['activation.preflight'], { exact: true }).count()).toBe(0)
      }
      await center(dialog)
      await reviewScreenshot(app, 'm5-review-activation-' + viewName(view) + '-' + view.condition)
      expect(app.errors).toEqual([])
      await dialog.getByRole('button', { name: copy['activation.later'], exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
    })
  })
})
