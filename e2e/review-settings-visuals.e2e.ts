import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { FETCH, PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import { parse, stringify } from 'yaml'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest'
import { en as fetchText, zh as fetchZh } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { zh as uiZh } from '../packages/ui/src/client/locales.ts'
import { firecrawlResponse } from './fixtures/remote-fetch.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, composedRows, profilePatchPath } from './harness/environment.ts'
import { openConnectionTab, newSession, openBundle, openConnections, openFetchSettings } from './harness/navigation.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'
import { expectTheme, setTheme, type ThemePreference } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const views = ['custom-list', 'custom-editor', 'firecrawl-personal', 'tavily', 'tinyfish', 'zh-settings', 'zh-menu', 'search-freshness'] as const
const schemes = ['light', 'dark'] as const
const matrix = [
  ...schemes.flatMap(scheme => views.map(view => ({ width: 1280, scheme, view }))),
  ...(['custom-editor', 'firecrawl-personal', 'zh-menu'] as const).map(view => ({ width: 390, scheme: 'light' as const, view })),
]
const viewport = { width: 1280, height: 1100 }
const draftRef = 'REVIEW_DRAFT_FETCH_KEY'

describe.skipIf(chromiumPath === undefined && !browserRequired)('UI review settings and Chinese screenshots', () => {
  let e2e: ReturnType<typeof isolatedContext>
  let app: App | undefined
  let server: WebServer | undefined
  let api: Awaited<ReturnType<typeof startRemoteFetchApi>>
  let visualPatch: string
  let originalTheme: ThemePreference | undefined
  let language: 'en-US' | 'zh-CN' = 'en-US'
  let savedPatch: { path: string; content: string } | undefined

  beforeAll(async () => { api = await startRemoteFetchApi(firecrawlResponse()) })

  beforeEach(() => {
    // Native workspace/draft restoration is outside this visual matrix. Give
    // every restart its own home, matching the model screenshot specifications.
    e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    const path = profilePatchPath(e2e)
    savedPatch = { path, content: existsSync(path) ? readFileSync(path, 'utf8') : '' }
    const original: unknown = savedPatch.content.trim() === '' ? [] : parse(savedPatch.content)
    if (!Array.isArray(original)) throw new Error('The public profile user patch must be a YAML list')
    visualPatch = stringify([...original,
      { id: SEARCH.rowId, config: { connections: { 'builtin:firecrawl': { disabled: false } } } },
      { id: FETCH.rowId, config: {
        version: 2,
        defaultConnection: 'builtin:local',
        connections: {
          'builtin:firecrawl': { disabled: false },
          'custom:review-firecrawl': {
            kind: 'adapter', adapter: 'firecrawl', label: 'Review Firecrawl',
            endpoint: new URL('v2/scrape', api.url).href,
            credentialRef: 'REVIEW_FIRECRAWL_KEY', trustedEndpoint: true,
          },
          'custom:review-tavily': {
            kind: 'adapter', adapter: 'tavily', label: 'Review Tavily',
            endpoint: new URL('extract', api.url).href,
            credentialRef: 'REVIEW_TAVILY_KEY', trustedEndpoint: true,
          },
        },
      } }])
  })

  async function reopenWithLocale(locale: 'en-US' | 'zh-CN') {
    const current = app!
    const url = current.page.url()
    const storageState = await current.page.context().storageState()
    const errors = [...current.errors]
    await current.close()
    app = undefined
    // Public browser locale fallback; no durable DSH locale.preference is written.
    app = await openApp(url, { locale, storageState, viewport })
    app.errors.unshift(...errors)
    language = locale
  }

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) {
        await recordBrowserFailure(app, 'review-settings-' + task.name.replace(/[^a-z0-9-]+/gi, '-') + '-failure')
      }
    } finally {
      try {
        if (app !== undefined && originalTheme !== undefined) {
          if (language === 'zh-CN') await reopenWithLocale('en-US')
          await app.page.setViewportSize(viewport)
          await app.page.keyboard.press('Escape')
          // A new browser context reopens DSH's native welcome; settle it before the account menu.
          await openBundle(app.page)
          await setTheme(app.page, originalTheme)
        }
      } finally {
        try {
          if (app !== undefined) await app.close()
          app = undefined
        } finally {
          try {
            if (server !== undefined) await server.stop()
            server = undefined
          } finally {
            // Only restore after the GUI Host stopped: never race its settings writer.
            if (savedPatch !== undefined) writeFileSync(savedPatch.path, savedPatch.content)
            originalTheme = undefined
            language = 'en-US'
          }
        }
      }
    }
  })

  afterAll(async () => {
    if (api !== undefined) {
      try {
        expect(api.requests).toEqual([])
      } finally {
        await api.close()
      }
    }
  })

  it.each(matrix)('$view at $width px in $scheme', async ({ width, scheme, view }) => {
    if (savedPatch === undefined) throw new Error('The original profile patch was not captured')
    // Settings edits must start from a real writable layer, not a CLI-only --patch.
    writeFileSync(savedPatch.path, visualPatch)
    server = await startWeb(e2e)
    app = await openApp(server.url, { viewport })
    await newSession(app.page)
    originalTheme = await setTheme(app.page, scheme)
    const name = 'review-fetch-' + view + '-' + width + '-' + scheme

    if (view === 'search-freshness') {
      const menu = await openConnections(app.page)
      const search = await openConnectionTab(menu, searchText['section.title'])
      const firecrawl = search.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ })
      const handoff = searchText['status.remoteReady'].replace('{access}', searchText['access.keyless']).replace('{name}', 'Firecrawl')
      await firecrawl.getByText(handoff, { exact: true }).waitFor()
      await firecrawl.click()
      await menu.waitFor({ state: 'hidden' })
      await openConnections(app.page)
      await openConnectionTab(menu, searchText['section.title'])
      const freshness = search.getByRole('tablist', { name: searchText['selector.freshness'], exact: true })
      const fresh = freshness.getByRole('tab', { name: searchText['freshness.fresh'], exact: true })
      await fresh.click()
      await expect.poll(() => fresh.getAttribute('aria-selected')).toBe('true')
      await app.page.setViewportSize({ width, height: viewport.height })
      await freshness.scrollIntoViewIfNeeded()
      await expectTheme(app.page, scheme)
      await app.screenshot(name)
      expect(app.errors).toEqual([])
      return
    }

    if (view === 'zh-menu') {
      const conversation = app.page.locator('[data-conversation-session]:visible')
      const id = await conversation.getAttribute('data-conversation-session')
      if (id === null) throw new Error('No session was rendered before the locale change')
      await reopenWithLocale('zh-CN')
      await app.page.locator('[data-conversation-session="' + id + '"]').waitFor()
      await app.page.setViewportSize({ width, height: viewport.height })
      const menu = await openConnections(app.page, uiZh)
      const fetch = await openConnectionTab(menu, fetchZh['section.title'])
      await fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).scrollIntoViewIfNeeded()
      await fetch.getByText(fetchZh['status.remoteReady'].replace('{access}', fetchZh['access.keyless']).replace('{name}', 'Firecrawl'), { exact: true }).waitFor()
      await expectTheme(app.page, scheme)
      await app.screenshot(name)
      expect(app.errors).toEqual([])
      return
    }

    let settings = await openFetchSettings(app.page, false)
    if (view === 'zh-settings') {
      await reopenWithLocale('zh-CN')
      await app.page.getByRole('navigation', { name: '全局面板', exact: true }).getByRole('button', { name: '插件', exact: true }).click()
      const card = app.page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]')
      await card.getByRole('button', { name: /^查看/ }).click()
      const bundle = app.page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]')
      await bundle.getByRole('button', { name: /^配置.*增强网页获取$/ }).click()
      settings = app.page.locator('[data-plugin-row-detail="' + rowConfigKey(FETCH) + '"]')
      await settings.getByRole('heading', { name: fetchZh['defaults.title'], exact: true }).waitFor()
      const configure = settings.getByRole('button', { name: fetchZh['services.configureLabel'].replace('{name}', 'Firecrawl'), exact: true })
      await configure.click()
      await app.page.setViewportSize({ width, height: viewport.height })
      await configure.scrollIntoViewIfNeeded()
      await settings.getByText(fetchZh['services.remoteNotice'].replace('{name}', 'Firecrawl'), { exact: true }).waitFor()
    } else if (view === 'custom-list') {
      const title = settings.getByRole('heading', { name: fetchText['custom.title'], exact: true })
      await title.scrollIntoViewIfNeeded()
      await settings.getByRole('switch', { name: fetchText['services.enable'].replace('{name}', 'Review Firecrawl'), exact: true }).waitFor()
      await settings.getByRole('switch', { name: fetchText['services.enable'].replace('{name}', 'Review Tavily'), exact: true }).waitFor()
    } else if (view === 'custom-editor') {
      await settings.getByRole('button', { name: fetchText['custom.addStructured'], exact: true }).click()
      const editor = settings.getByRole('form', { name: fetchText['editor.titleNew'], exact: true })
      await editor.getByRole('textbox', { name: fetchText['editor.label'], exact: true }).fill('Draft Firecrawl')
      await editor.getByRole('textbox', { name: fetchText['editor.id'], exact: true }).fill('review-draft')
      await editor.getByRole('button', { name: fetchText['editor.adapter'], exact: true }).click()
      await app.page.getByRole('menuitem', { name: 'Firecrawl', exact: true }).click()
      await editor.getByRole('textbox', { name: fetchText['editor.endpoint'], exact: true }).fill(new URL('draft/scrape', api.url).href)
      await editor.getByRole('textbox', { name: fetchText['editor.credentialRef'], exact: true }).fill(draftRef)
      const consent = editor.getByRole('checkbox', { name: fetchText['editor.trust'].replace('{ref}', draftRef), exact: true })
      await consent.waitFor()
      expect(await consent.isChecked()).toBe(false)
      expect(await editor.getByRole('button', { name: fetchText['editor.save'], exact: true }).isDisabled()).toBe(true)
      await app.page.setViewportSize({ width, height: viewport.height })
      await editor.scrollIntoViewIfNeeded()
      await expectTheme(app.page, scheme)
      await app.screenshot(name)
      await consent.scrollIntoViewIfNeeded()
      await app.screenshot(name + '-trust')
      await editor.getByRole('button', { name: fetchText['editor.cancel'], exact: true }).click()
      await editor.waitFor({ state: 'hidden' })
      const row = composedRows(e2e).find(candidate => candidate.id === FETCH.rowId)
      if (row === undefined) throw new Error('The fetch row disappeared after cancelling the draft')
      expect(JSON.stringify(row.config)).not.toContain('review-draft')
      expect(app.errors).toEqual([])
      return
    } else {
      const service = view === 'firecrawl-personal' ? 'Firecrawl' : view === 'tavily' ? 'Tavily' : 'Tinyfish'
      const configure = settings.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', service), exact: true })
      await configure.click()
      const row = settings.getByRole('listitem').filter({ has: app.page.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', service), exact: true }) })
      if (view === 'firecrawl-personal') {
        await row.getByRole('tab', { name: fetchText['services.accessPersonal'], exact: true }).click()
        await row.getByRole('textbox', { name: fetchText['credential.reference'], exact: true }).waitFor()
        await row.getByLabel(fetchText['credential.label'], { exact: true }).waitFor()
        const option = row.getByRole('button', { name: fetchText['option.firecrawl.onlyMainContent'], exact: true })
        await option.click()
        await app.page.getByRole('menuitem', { name: fetchText['options.on'], exact: true }).click()
        await expect.poll(() => option.innerText()).toBe(fetchText['options.on'])
        await expect.poll(() => option.isEnabled()).toBe(true)
        await expect.poll(() => row.getByRole('tab', { name: fetchText['services.accessPersonal'], exact: true }).isEnabled()).toBe(true)
        await expect.poll(() => composedRows(e2e).find(candidate => candidate.id === FETCH.rowId)!.config).toMatchObject({
          connections: { 'builtin:firecrawl': { access: 'api-key', options: { onlyMainContent: true } } },
        })
      }
      await app.page.setViewportSize({ width, height: viewport.height })
      await configure.scrollIntoViewIfNeeded()
      await row.getByText(fetchText['services.remoteNotice'].replace('{name}', service), { exact: true }).waitFor()
    }
    await expectTheme(app.page, scheme)
    await app.screenshot(name)
    if (view === 'firecrawl-personal') {
      await settings.getByRole('button', { name: fetchText['option.firecrawl.onlyMainContent'], exact: true }).scrollIntoViewIfNeeded()
      await app.screenshot(name + '-options')
    }
    expect(app.errors).toEqual([])
    expect(api.requests).toEqual([])
  })
})
