/** M2 visual matrix against one isolated DSH server and one shared browser. */
import { join } from 'node:path'
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import type { Locator, Page } from 'playwright-core'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { artifacts } from './harness/environment.ts'
import { newSession, openBundle, openConnections, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = inject('e2e')
const desktop = { width: 1280, height: 900 }
const widths = [1280, 768, 390] as const
const schemes = ['light', 'dark'] as const
const views = ['settings-page', 'fetch-settings-page', 'composer-menu', 'bundle-overview'] as const
const matrix = widths.flatMap(width => schemes.flatMap(scheme => views.map(view => ({ width, scheme, view }))))
type Scheme = typeof schemes[number]
type ThemePreference = Scheme | 'system'
const themeLabels = { light: 'Light', dark: 'Dark', system: 'System' } as const

describe.skipIf(chromiumPath === undefined && !browserRequired)('M2 screenshot matrix', () => {
  let server: WebServer | undefined
  let app: App
  let originalTheme: ThemePreference | undefined

  beforeAll(async () => {
    try {
      server = await startWeb(e2e)
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
          // A section title alone can render before its selection has loaded.
          await menu.getByRole('group', { name: new RegExp('^' + searchText['section.title'] + '(?: ·|$)') }).getByRole('menuitemradio', { name: /^Exa\b/ }).waitFor()
          await menu.getByRole('group', { name: fetchText['section.title'], exact: true }).getByRole('button', { name: /^Fetch · Local HTTP ·/ }).waitFor()
          // DSH's first-run workspace warning must not obscure the menu evidence.
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
      // Keep the matrix image as evidence before failing a visual regression.
      if (view === 'bundle-overview') await expectOverviewHealthy(page.getByRole('region', { name: uiText['overview.title'], exact: true }))
      if (view === 'composer-menu') await expectMenuSectionsInView(page.getByRole('menu', { name: uiText['menu.aria'], exact: true }))
      expect(app.errors).toEqual([])
    } finally {
      // Dismiss the connection menu even if its screenshot or assertion failed.
      await page.keyboard.press('Escape')
    }
  })

  it('logs no browser errors across the matrix', () => {
    expect(app.errors).toEqual([])
  })
})

/** Use DSH's persisted Appearance setting rather than changing only media queries. */
async function setTheme(page: Page, preference: ThemePreference): Promise<ThemePreference> {
  await page.getByRole('button', { name: 'Account menu', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'General', exact: true }).click()
  const selected = settings.getByRole('button', { name: /^(Light|Dark|System)$/, pressed: true })
  await selected.waitFor()
  const previous = (await selected.innerText()).trim()
  expect(previous).toMatch(/^(Light|Dark|System)$/)

  try {
    const button = settings.getByRole('button', { name: themeLabels[preference], exact: true })
    await button.click()
    await settings.getByRole('button', { name: themeLabels[preference], exact: true, pressed: true }).waitFor()
    if (preference !== 'system') await expectTheme(page, preference)
  } finally {
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
  }
  return previous.toLowerCase() as ThemePreference
}

async function expectTheme(page: Page, scheme: Scheme): Promise<void> {
  await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, scheme === 'dark')
}

/** Both capability headings must actually appear in the screenshot, not just exist offscreen. */
async function expectMenuSectionsInView(menu: Locator): Promise<void> {
  for (const title of [searchText['section.title'], fetchText['section.title']]) {
    const group = menu.getByRole('group', { name: new RegExp('^' + title + '(?: ·|$)') })
    const visible = await group.getByRole('button', { name: new RegExp('^' + title + ' ·') }).evaluate(element => {
      const heading = element.getBoundingClientRect()
      const panel = element.closest('[role="menu"]')!.getBoundingClientRect()
      return heading.width > 0 && heading.height > 0
        && heading.top >= Math.max(0, panel.top)
        && heading.bottom <= Math.min(window.innerHeight, panel.bottom)
        && heading.left >= Math.max(0, panel.left)
        && heading.right <= Math.min(window.innerWidth, panel.right)
    })
    expect.soft(visible, title + ' heading must be inside the menu viewport').toBe(true)
  }
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
