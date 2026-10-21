/**
 * Headless Chromium through Playwright, pointed at the isolated GUI.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type BrowserContextOptions, type Page, chromium } from 'playwright-core'
import { artifacts, isolatedEnvironment } from './environment.ts'
import { en as uiText, zh as uiZh } from '../../packages/ui/src/client/locales.ts'

/**
 * A Chromium or Chrome binary: `DSH_E2E_CHROMIUM`, else the usual system paths.
 * Under CI (`CI` set) a missing browser fails the GUI suite instead of skipping it.
 */
export const chromiumPath = [process.env.DSH_E2E_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((path): path is string => path !== undefined && existsSync(path))

export const browserRequired = process.env.CI !== undefined

/** Retain accessible DOM and console evidence when a browser assertion fails. */
export async function recordBrowserFailure(app: App, name: string): Promise<void> {
  const accessibility = await app.page.locator('body').ariaSnapshot()
  writeFileSync(join(artifacts, name + '.json'), JSON.stringify({
    url: app.page.url(), errors: app.errors, accessibility,
  }, null, 2))
  writeFileSync(join(artifacts, name + '.aria.txt'), accessibility)
  await app.screenshot(name)
}

/** An open app page and what it logged. */
export interface App {
  readonly browser: Browser
  readonly page: Page
  /** Console errors and uncaught page errors, in order. */
  readonly errors: string[]
  screenshot(name: string): Promise<void>
  close(): Promise<void>
}

/**
 * Launch Chromium, open the launch URL, and dismiss the dialogs a fresh home shows.
 * @param url - the one-time launch URL from `startWeb`.
 */
export async function openApp(url: string, contextOptions: BrowserContextOptions = {}): Promise<App> {
  if (chromiumPath === undefined) throw new Error('no Chromium found; set DSH_E2E_CHROMIUM')
  // Chromium's SingletonSocket must fit Linux's 108-byte Unix-socket path limit, which
  // any directory of a checkout under a long path (GitHub's /home/runner/work/<repo>/<repo>)
  // exceeds. Chrome's scratch is therefore a fresh short directory under /tmp, removed
  // when the browser closes; it never falls back to a developer home or OS cache.
  const scratch = mkdtempSync('/tmp/dsh-e2e-')
  const browser = await chromium.launch({
    executablePath: chromiumPath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...isolatedEnvironment(), TMPDIR: scratch },
  })
  const close = async () => {
    await browser.close()
    rmSync(scratch, { recursive: true, force: true })
  }
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US', ...contextOptions })).newPage()
    const copy = contextOptions.locale === 'zh-CN' ? uiZh : uiText
    page.setDefaultTimeout(30_000)
    const errors: string[] = []
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', (error) => { errors.push(error.message) })
    await page.addLocatorHandler(page.getByRole('dialog', { name: 'Preview Notice' }), async (dialog) => {
      await dialog.getByRole('button', { name: 'Continue' }).click()
    })
    await page.addLocatorHandler(page.getByRole('button', { name: 'Configure later' }), async (button) => { await button.click() })
    const welcome = contextOptions.locale === 'zh-CN' ? { title: '开始使用', close: '关闭' } : { title: 'Get started', close: 'Close' }
    // DSH may open its sign-in dialog late, under an open connections menu: dismiss it without a pointer hit test.
    await page.addLocatorHandler(page.getByRole('dialog', { name: welcome.title, exact: true }), async (dialog) => {
      await dialog.getByRole('button', { name: welcome.close, exact: true }).dispatchEvent('click')
    })
    await page.addLocatorHandler(page.getByRole('dialog', { name: copy['activation.title'] }), async (dialog) => {
      await dialog.getByRole('button', { name: copy['activation.later'], exact: true }).click()
    })
    await page.goto(url)
    return {
      browser,
      page,
      errors,
      screenshot: async (name) => { await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true }) },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}
