import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './environment.ts'
import { FETCH, PROFILE_PACKAGE, SEARCH, rowConfigKey } from 'dsh-tool-web-enhanced-core/shared'
import type { Locator, Page } from 'playwright-core'
import { expect } from 'vitest'
import { en as uiText } from '../../packages/ui/src/client/locales.ts'
import { en as fetchText } from '../../packages/fetch-enhanced/src/client/locales.ts'

/** Navigate through the public Plugins UI, including its existing back controls. */
export async function openBundle(page: Page): Promise<Locator> {
  await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins', exact: true }).click()
  const back = page.getByRole('button', { name: 'Back to Web Tools Enhanced', exact: true })
  if (await back.isVisible()) await back.click()
  const detail = page.locator('[data-plugin-detail="' + PROFILE_PACKAGE + '"]')
  if (!await detail.isVisible()) {
    const card = page.locator('[data-plugin-package="' + PROFILE_PACKAGE + '"]')
    await card.getByRole('button', { name: /^View / }).click()
  }
  await detail.getByRole('heading', { name: 'Web Tools Enhanced', exact: true }).waitFor()
  return detail
}

/** Open the search row's settings page, not the bundle configuration slot. */
export async function openSearchSettings(page: Page): Promise<Locator> {
  const detail = await openBundle(page)
  await detail.getByRole('button', { name: 'Configure Web Search Enhanced', exact: true }).click()
  const settings = page.locator('[data-plugin-row-detail="' + rowConfigKey(SEARCH) + '"]')
  await settings.waitFor()
  return settings
}

/** Open fetch settings and optionally expose the local allowlist editor. */
export async function openFetchSettings(page: Page, local = true): Promise<Locator> {
  const detail = await openBundle(page)
  await detail.getByRole('button', { name: 'Configure Web Fetch Enhanced', exact: true }).click()
  const settings = page.locator('[data-plugin-row-detail="' + rowConfigKey(FETCH) + '"]')
  await settings.waitFor()
  if (local) {
    await settings.getByRole('button', { name: fetchText['services.configureLabel'].replace('{name}', 'Local HTTP'), exact: true }).click()
    await settings.getByRole('textbox', { name: fetchText['allowlist.allowCidrs'], exact: true }).waitFor()
  }
  return settings
}

/** Create through DSH's sidebar; read its existing conversation identity attribute. */
export async function newSession(page: Page): Promise<string> {
  const conversation = page.locator('[data-conversation-session]:visible')
  const previous = await conversation.count() === 0 ? null : await conversation.getAttribute('data-conversation-session')
  await page.getByRole('button', { name: 'New session', exact: true }).last().click()
  const chooseWorkspace = page.getByRole('textbox', { name: 'Choose workspace', exact: true })
  await conversation.or(chooseWorkspace).first().waitFor()
  if (await chooseWorkspace.isVisible()) {
    const directory = join(run, 'browser-workspace')
    mkdirSync(directory, { recursive: true })
    // The recent-workspace query may replace the placeholder while we click.
    // The sidebar action stays mounted and always opens the directory flow.
    await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Select Workspace Directory', exact: true })
    // Initial directory scans commit the breadcrumb editor state. Wait for the
    // public Open action to become ready before entering a path.
    await expect.poll(() => picker.getByRole('button', { name: 'Open', exact: true }).isEnabled()).toBe(true)
    await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
    const path = picker.getByRole('textbox', { name: 'Edit path', exact: true })
    await path.fill(directory)
    await path.press('Enter')
    await picker.getByRole('button', { name: 'Edit path', exact: true }).waitFor()
    await picker.getByRole('button', { name: 'Open', exact: true }).click()
    await picker.waitFor({ state: 'hidden' })
  }
  await conversation.waitFor()
  await expect.poll(() => conversation.getAttribute('data-conversation-session')).not.toBe(previous)
  const id = await conversation.getAttribute('data-conversation-session')
  if (!id) throw new Error('DSH rendered no conversation identity')
  return id
}

/** Expand a capability's public accordion before interacting with its rows. */
export async function expandConnectionSection(menu: Locator, title: string): Promise<Locator> {
  const section = menu.getByRole('group', { name: title, exact: true })
  const heading = section.getByRole('button', { name: new RegExp('^' + title + ' ·') })
  if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click()
  await expect.poll(() => heading.getAttribute('aria-expanded')).toBe('true')
  return section
}

export async function openConnections(page: Page): Promise<Locator> {
  const button = page.getByRole('button', { name: uiText['button.aria'], exact: true })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  const menu = page.getByRole('menu', { name: uiText['menu.aria'], exact: true })
  await menu.waitFor()
  return menu
}
