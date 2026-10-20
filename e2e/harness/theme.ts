import type { Page } from 'playwright-core'
import { expect } from 'vitest'

export type Scheme = 'light' | 'dark'
export type ThemePreference = Scheme | 'system'
const themeLabels = { light: 'Light', dark: 'Dark', system: 'System' } as const

/** Use DSH's persisted Appearance setting rather than changing only media queries. */
export async function setTheme(page: Page, preference: ThemePreference): Promise<ThemePreference> {
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

export async function expectTheme(page: Page, scheme: Scheme): Promise<void> {
  await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, scheme === 'dark')
}

