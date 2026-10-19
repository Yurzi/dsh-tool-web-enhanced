/**
 * Headless Chromium through Playwright, pointed at the isolated GUI.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type Browser, type Page, chromium } from 'playwright-core'
import { artifacts } from './environment.ts'

/**
 * A Chromium or Chrome binary: `DSH_E2E_CHROMIUM`, else the usual system paths.
 * Under CI (`CI` set) a missing browser fails the GUI suite instead of skipping it.
 */
export const chromiumPath = [process.env.DSH_E2E_CHROMIUM, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  .find((path): path is string => path !== undefined && existsSync(path))

export const browserRequired = process.env.CI !== undefined

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
export async function openApp(url: string): Promise<App> {
  if (chromiumPath === undefined) throw new Error('no Chromium found; set DSH_E2E_CHROMIUM')
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })).newPage()
  page.setDefaultTimeout(30_000)
  const errors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => { errors.push(error.message) })
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Preview Notice' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Continue' }).click()
  })
  await page.addLocatorHandler(page.getByRole('button', { name: 'Configure later' }), async (button) => { await button.click() })
  await page.addLocatorHandler(page.getByRole('dialog', { name: 'Get started' }), async (dialog) => {
    await dialog.getByRole('button', { name: 'Close' }).click()
  })
  await page.goto(url)
  return {
    browser,
    page,
    errors,
    screenshot: async (name) => { await page.screenshot({ path: join(artifacts, `${name}.png`), fullPage: true }) },
    close: () => browser.close(),
  }
}
