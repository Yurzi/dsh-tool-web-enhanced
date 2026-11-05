import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { expect } from 'vitest'
import { artifacts } from './environment.ts'

/** Wait for the public rail/drawer layout and an unobscured mobile opener, not a fixed animation delay. */
export async function modelViewport(page: Page, width: number, navigation = 'Global panels') {
  await page.setViewportSize({ width, height: 1100 })
  expect(await page.evaluate(() => window.innerWidth)).toBe(width)
  if (width <= 768) {
    const nav = page.getByRole('navigation', { name: navigation, exact: true, includeHidden: true })
    await expect.poll(async () => {
      // rc.1 keeps closed drawer content mounted but removes it from accessibility.
      if (await nav.count() === 0 || !await nav.isVisible()) return 0
      return nav.evaluateAll(elements => {
        const element = elements[0]
        if (element === undefined) return 0
        const box = element.getBoundingClientRect()
        return Math.max(0, Math.min(box.right, window.innerWidth) - Math.max(box.left, 0))
      })
    }).toBeLessThanOrEqual(64)
    if (width < 768) {
      const opener = page.getByRole('button', { name: navigation === '全局面板' ? '打开侧边栏' : 'Open sidebar', exact: true })
      await expect.poll(async () => {
        if (!await opener.isVisible()) return false
        return opener.evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        })
      }).toBe(true)
    }
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1)
}

/** Settings scroll inside their own container: capture each complete protocol group. */
export async function modelGroups(row: Locator, name: string) {
  const groups = row.getByRole('group')
  expect(await groups.count()).toBe(5)
  for (let index = 0; index < 5; index++) {
    const group = groups.nth(index)
    await group.scrollIntoViewIfNeeded()
    await group.screenshot({ path: join(artifacts, name + '-group-' + (index + 1) + '.png') })
  }
}
