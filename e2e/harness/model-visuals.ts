import { join } from 'node:path'
import type { Locator, Page } from 'playwright-core'
import { expect } from 'vitest'
import { artifacts } from './environment.ts'

/** Wait for the responsive sidebar's actual width, not a fixed animation delay. */
export async function modelViewport(page: Page, width: number, navigation = 'Global panels') {
  await page.setViewportSize({ width, height: 1100 })
  if (width <= 768) {
    await expect.poll(async () => {
      const box = await page.getByRole('navigation', { name: navigation, exact: true }).boundingBox()
      return box === null ? Number.POSITIVE_INFINITY : box.width
    }).toBeLessThanOrEqual(64)
  }
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
