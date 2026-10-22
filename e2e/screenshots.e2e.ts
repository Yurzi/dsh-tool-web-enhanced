/** Visual matrix against one isolated DSH server and one shared browser. */
import { join } from 'node:path'
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { Locator } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { artifacts } from './harness/environment.ts'
import { connectionButton, connectionTabs, openConnectionTab, newSession, openBundle, openConnections, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'
import { expectTheme, setTheme, type ThemePreference } from './harness/theme.ts'

const e2e = inject('e2e')
const desktop = { width: 1280, height: 900 }
const widths = [1280, 768, 390] as const
const schemes = ['light', 'dark'] as const
const views = ['settings-page', 'fetch-settings-page', 'composer-menu', 'bundle-overview', 'fetch-remote-settings', 'fetch-remote-menu'] as const
const matrix = widths.flatMap(width => schemes.flatMap(scheme => views.map(view => ({ width, scheme, view }))))


describe.skipIf(chromiumPath === undefined && !browserRequired)('Screenshot matrix', () => {
  let server: WebServer | undefined
  let app: App
  let originalTheme: ThemePreference | undefined

  beforeAll(async () => {
    try {
      server = await startWeb(e2e, [join(import.meta.dirname, 'fixtures/remote-enabled.yml')])
      app = await openApp(server.url)
      // Settle DSH's asynchronous first-run dialogs before opening a transient account menu.
      await openBundle(app.page)
      originalTheme = await setTheme(app.page, 'light')
    } catch (error) {
      if (app !== undefined) await recordBrowserFailure(app, 'screenshots-setup-failure')
      throw error
    }
  })

  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && app !== undefined) {
      const name = task.name.replace(/[^a-z0-9-]+/gi, '-')
      await recordBrowserFailure(app, 'screenshots-' + name + '-failure')
    }
  })

  afterAll(async () => {
    try {
      if (originalTheme !== undefined) {
        await app.page.setViewportSize(desktop)
        await app.page.keyboard.press('Escape')
        await setTheme(app.page, originalTheme)
      }
    } finally {
      try {
        await app?.close()
      } finally {
        await server?.stop()
      }
    }
  })

  it.each(matrix)('$view at $width px in $scheme', async ({ width, scheme, view }) => {
    const { page } = app
    // Navigate with the desktop sidebar, then exercise the actual narrow layout.
    await page.setViewportSize(desktop)
    await setTheme(page, scheme)

    try {
      switch (view) {
        case 'settings-page': {
          const settings = await openSearchSettings(page)
          await page.setViewportSize({ width, height: desktop.height })
          await settings.getByRole('button', { name: searchText['defaults.connection'], exact: true }).waitFor()
          await settings.getByRole('heading', { name: searchText['defaults.title'], exact: true }).scrollIntoViewIfNeeded()
          break
        }
        case 'fetch-settings-page': {
          const settings = await openFetchSettings(page)
          await page.setViewportSize({ width, height: desktop.height })
          await settings.getByRole('region', { name: fetchText['allowlist.title'], exact: true }).scrollIntoViewIfNeeded()
          break
        }
        case 'composer-menu': {
          const sessionId = await newSession(page)
          await page.setViewportSize({ width, height: desktop.height })
          await page.locator('[data-conversation-session="' + sessionId + '"]').waitFor()
          const menu = await openConnections(page)
          // A tab alone can render before its selection has loaded.
          const search = await openConnectionTab(menu, searchText['section.title'])
          await search.getByRole('menuitemradio', { name: /^Exa\b/ }).waitFor()
          await expect.poll(() => connectionButton(page).getAttribute('aria-label')).toContain(fetchText['connection.local'])
          // DSH's first-run workspace warning must not obscure the menu evidence.
          await page.getByRole('alert').filter({ hasText: 'Unable to create default workspace.' }).waitFor({ state: 'hidden' })
          break
        }
        case 'fetch-remote-settings': {
          const settings = await openFetchSettings(page, false)
          const configure = settings.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', 'Firecrawl'), exact: true })
          await configure.click()
          const notice = settings.getByText(fetchText['services.remoteNotice'].replace('{name}', 'Firecrawl'), { exact: true })
          await notice.waitFor()
          await page.setViewportSize({ width, height: desktop.height })
          await configure.scrollIntoViewIfNeeded()
          await settings.getByRole('button', { name: fetchText['option.firecrawl.onlyMainContent'], exact: true }).waitFor()
          break
        }
        case 'fetch-remote-menu': {
          await newSession(page)
          await page.setViewportSize({ width, height: desktop.height })
          const menu = await openConnections(page)
          const fetch = await openConnectionTab(menu, fetchText['section.title'])
          for (const name of ['Exa', 'Firecrawl', 'Tavily']) {
            const row = fetch.getByRole('menuitemradio', { name: new RegExp('^' + name + '(?: |$)') })
            await row.waitFor()
            expect(await row.isEnabled()).toBe(true)
          }
          const tinyfish = fetch.getByRole('menuitemradio', { name: /^Tinyfish(?: |$)/ })
          expect(await tinyfish.getAttribute('aria-checked')).toBe('false')
          await tinyfish.getByText(fetchText['status.needsCredential'].replace('{name}', 'Tinyfish'), { exact: true }).waitFor()
          await fetch.getByRole('menuitemradio', { name: /^Firecrawl(?: |$)/ }).scrollIntoViewIfNeeded()
          await page.getByRole('alert').filter({ hasText: 'Unable to create default workspace.' }).waitFor({ state: 'hidden' })
          break
        }
        case 'bundle-overview': {
          const bundle = await openBundle(page)
          const overview = bundle.getByRole('region', { name: uiText['overview.title'], exact: true })
          await overview.getByText(uiText['overview.status.effective'].replace('{provider}', SEARCH.providerId), { exact: true }).waitFor()
          await overview.getByText(uiText['overview.status.effective'].replace('{provider}', FETCH.providerId), { exact: true }).waitFor()
          await page.setViewportSize({ width, height: desktop.height })
          await overview.getByRole('heading', { level: 3, name: uiText['overview.title'], exact: true }).scrollIntoViewIfNeeded()
          break
        }
      }

      await expectTheme(page, scheme)
      await page.evaluate(async () => { await document.fonts.ready })
      await page.screenshot({
        path: join(artifacts, `${view}-${width}-${scheme}.png`),
        fullPage: true,
        animations: 'disabled',
      })
      if (view === 'composer-menu' && width === 390) {
        const button = connectionButton(page)
        const accessibleName = await button.getAttribute('aria-label')
        await page.setViewportSize({ width: 360, height: desktop.height })
        expect(await button.getAttribute('aria-label')).toBe(accessibleName)
        await app.screenshot('composer-menu-360-' + scheme)
        await page.setViewportSize({ width, height: desktop.height })
      }
      // Keep the matrix image as evidence before failing a visual regression.
      if (view === 'bundle-overview') await expectOverviewHealthy(page.getByRole('region', { name: uiText['overview.title'], exact: true }))
      if (view === 'composer-menu') await expectMenuLayersInView(page.getByRole('dialog', { name: uiText['menu.aria'], exact: true }))
      expect(app.errors).toEqual([])
    } finally {
      // Dismiss the connection menu even if its screenshot or assertion failed.
      await page.keyboard.press('Escape')
    }
  })

  it('collapses the connection button with the model selector instead of wrapping the composer row', async () => {
    const { page } = app
    await page.setViewportSize(desktop)
    const sessionId = await newSession(page)
    const conversation = page.locator('[data-conversation-session="' + sessionId + '"]')
    const button = connectionButton(page)
    await expect.poll(() => button.getAttribute('aria-label')).toContain(fetchText['connection.local'])
    // DSH's own controls at both ends of the composer row.
    const commands = conversation.getByRole('button', { name: 'Add files or run commands', exact: true })
    const send = conversation.getByRole('button', { name: 'Send message', exact: true })
    const middle = async (locator: Locator) => {
      const box = await locator.boundingBox()
      return box === null ? Number.NaN : box.y + box.height / 2
    }
    const compactWidths: number[] = []
    for (const width of [1280, 1024, 900, 820, 768, 700, 640, 600, 560, 520, 480, 440, 400, 390, 360]) {
      await page.setViewportSize({ width, height: desktop.height })
      // The row re-measures on resize and the sidebar animates below 768 px: wait for the settled layout.
      await expect.poll(async () => {
        const { compact, labels } = await button.evaluate(element => ({
          // The documented compact signal the composer row sets for its model seat.
          compact: getComputedStyle(element).getPropertyValue('--dsh-composer-model-text-display').trim() === 'none',
          labels: [...element.querySelectorAll('[data-capability]')].some(side => side.getBoundingClientRect().width > 0),
        }))
        const row = await middle(button)
        const oneLine = Math.abs(row - await middle(commands)) < 6 && Math.abs(row - await middle(send)) < 6
        if (compact) compactWidths.push(width)
        return { width, labelsFollowModel: labels === !compact, oneLine }
      }, { timeout: 5000 }).toEqual({ width, labelsFollowModel: true, oneLine: true })
      if (width === 600) await app.screenshot('composer-compact-600')
    }
    // The sweep must have seen both displays, or it proves nothing.
    expect(compactWidths.length).toBeGreaterThan(0)
    expect(compactWidths).not.toContain(1280)
    expect(app.errors).toEqual([])
  })

  it('logs no browser errors across the matrix', () => {
    expect(app.errors).toEqual([])
  })
})

/** Both capability tabs and the shown panel's first rows must actually appear in the screenshot, not just exist offscreen. */
async function expectMenuLayersInView(menu: Locator): Promise<void> {
  const inView = (locator: Locator) => locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    const panel = element.closest('[role="dialog"]')!.getBoundingClientRect()
    return box.width > 0 && box.height > 0
      && box.top >= Math.max(0, panel.top)
      && box.bottom <= Math.min(window.innerHeight, panel.bottom)
      && box.left >= Math.max(0, panel.left)
      && box.right <= Math.min(window.innerWidth, panel.right)
  })
  for (const title of [searchText['section.title'], fetchText['section.title']]) {
    expect.soft(await inView(connectionTabs(menu).getByRole('tab', { name: title, exact: true })), title + ' tab must be inside the menu viewport').toBe(true)
  }
  expect.soft(await inView(menu.getByRole('button', { name: uiText['menu.settings'], exact: true })), 'the panel header must be inside the menu viewport').toBe(true)
  expect.soft(await inView(menu.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true })), 'the panel list must start inside the menu viewport').toBe(true)
}

async function expectOverviewHealthy(overview: Locator): Promise<void> {
  const unavailable = await overview.getByText(uiText['disabled.search'].replace('{rowId}', SEARCH.rowId), { exact: true })
    .or(overview.getByText(uiText['disabled.fetch'].replace('{rowId}', FETCH.rowId), { exact: true })).allTextContents()
  expect.soft(unavailable, 'Running capability rows must not be reported unavailable').toEqual([])

  const foregroundStyle = await overview.getByRole('heading', { level: 3, name: uiText['overview.title'], exact: true }).evaluate(element => getComputedStyle(element).color)
  const backgroundStyles = await overview.evaluate(element => {
    const backgrounds: string[] = []
    for (let current: Element | null = element; current !== null; current = current.parentElement) {
      backgrounds.push(getComputedStyle(current).backgroundColor)
    }
    return backgrounds.toReversed()
  })
  // Composite transparent surfaces over their ancestors, not over black by accident.
  const background = backgroundStyles.reduce<Rgb>((base, color) => composite(parseRgb(color), base), [255, 255, 255])
  const foreground = composite(parseRgb(foregroundStyle), background)
  const first = luminance(foreground)
  const second = luminance(background)
  const contrast = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  expect.soft(contrast, 'Overview title / section background WCAG contrast').toBeGreaterThanOrEqual(4.5)
}

type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]

function parseRgb(color: string): Rgba {
  const match = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/.exec(color)
  if (match === null) throw new Error('Expected computed rgb/rgba color, received ' + color)
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])]
}

function composite([red, green, blue, alpha]: Rgba, background: Rgb): Rgb {
  return [
    red * alpha + background[0] * (1 - alpha),
    green * alpha + background[1] * (1 - alpha),
    blue * alpha + background[2] * (1 - alpha),
  ]
}

function luminance(color: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(color[0]) + 0.7152 * linear(color[1]) + 0.0722 * linear(color[2])
}
