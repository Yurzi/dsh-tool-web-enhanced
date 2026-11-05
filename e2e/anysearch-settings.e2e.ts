import { FETCH, PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { en as searchEn, zh as searchZh } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchEn, zh as fetchZh } from '../packages/fetch-enhanced/src/client/locales.ts'
import searchMeta from '../packages/search-enhanced/locale/zh.json'
import fetchMeta from '../packages/fetch-enhanced/locale/zh.json'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins } from './harness/environment.ts'
import { openPluginsPanel, openSearchSettings, openFetchSettings } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const cases = (['en-US', 'zh-CN'] as const).flatMap(locale =>
  (['search', 'fetch'] as const).map(capability => ({ locale, capability })))

describe.skipIf(chromiumPath === undefined && !browserRequired)('AnySearch settings review', () => {
  let app: App | undefined
  let server: WebServer | undefined

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'm7-anysearch-settings-failure')
    } finally {
      try {
        if (app !== undefined) await app.close()
      } finally {
        app = undefined
        if (server !== undefined) await server.stop()
        server = undefined
      }
    }
  })

  it.each(cases)('shows the disabled service and expanded $capability panel in $locale', async ({ locale, capability }) => {
    const e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('The global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    server = await startWeb(e2e)
    app = await openApp(server.url, { locale, colorScheme: 'light', viewport: { width: 1280, height: 1100 } })
    const { page } = app
    const searchCopy = locale === 'zh-CN' ? searchZh : searchEn
    const fetchCopy = locale === 'zh-CN' ? fetchZh : fetchEn
    const copy = capability === 'search' ? searchCopy : fetchCopy
    const rowId = capability === 'search' ? SEARCH : FETCH
    let settings
    if (locale === 'en-US') {
      settings = capability === 'search' ? await openSearchSettings(page) : await openFetchSettings(page, false)
    } else {
      // DSH owns the navigation labels; our plugin metadata supplies the row title.
      await openPluginsPanel(page, 'zh')
      const bundle = page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]')
      await page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]').getByRole('button', { name: /^查看/ }).click()
      const title = capability === 'search' ? searchMeta.meta.title : fetchMeta.meta.title
      await bundle.getByRole('button', { name: new RegExp(title + '$') }).click()
      settings = page.locator('[data-plugin-row-detail="' + rowConfigKey(rowId) + '"]')
    }
    const row = settings.getByRole('listitem').filter({
      has: page.getByRole('switch', { name: copy['services.enable'].replace('{name}', 'AnySearch'), exact: true }),
    })
    const toggle = row.getByRole('switch', { name: copy['services.enable'].replace('{name}', 'AnySearch'), exact: true })
    const configure = row.getByRole('button', { name: copy['services.configureLabel'].replace('{name}', 'AnySearch'), exact: true })
    await configure.click()
    const id = await configure.getAttribute('aria-controls')
    if (id === null) throw new Error('The AnySearch disclosure did not identify its panel')
    const panel = row.locator('[id="' + id + '"]')
    await panel.getByText(copy['services.remoteNotice'].replace('{name}', 'AnySearch'), { exact: true }).waitFor()
    await panel.getByLabel(copy['credential.label'], { exact: true }).waitFor()
    if (capability === 'search') {
      await panel.getByRole('button', { name: searchCopy['option.anysearch.zone'], exact: true }).waitFor()
      await panel.getByRole('textbox', { name: searchCopy['option.anysearch.language'], exact: true }).waitFor()
    } else {
      await panel.getByText(fetchCopy['services.note.anysearch'], { exact: true }).waitFor()
    }
    await row.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
    await reviewScreenshot(app, 'm7-anysearch-' + capability + '-settings-' + locale)
    expect(await toggle.isChecked()).toBe(false)
    expect(await configure.getAttribute('aria-expanded')).toBe('true')
    expect(await panel.getByRole('tab', { name: copy['services.accessKeyless'], exact: true }).count()).toBe(0)
    if (capability === 'search') {
      expect(await panel.getByRole('textbox', { name: searchCopy['option.anysearch.language'], exact: true }).getAttribute('placeholder')).toBe(searchCopy['option.anysearch.language.placeholder'])
    } else {
      expect(await panel.getByText(fetchCopy['services.note.anysearch'], { exact: true }).innerText()).toBe(fetchCopy['services.note.anysearch'])
    }
    expect(app.errors).toEqual([])
  })
})
