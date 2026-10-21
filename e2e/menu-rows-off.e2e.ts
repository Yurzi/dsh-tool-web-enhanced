import { join } from 'node:path'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { connectionButton, connectionTabs, openConnectionTab, newSession, openBundle, openConnections } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = inject('e2e')
const cases = [
  { name: 'search', off: ['search'], remaining: fetchText['section.title'] },
  { name: 'fetch', off: ['fetch'], remaining: searchText['section.title'] },
  { name: 'both', off: ['search', 'fetch'], remaining: null },
] as const

describe.skipIf(chromiumPath === undefined && !browserRequired).each(cases)('$name capability rows disabled', ({ name, off, remaining }) => {
  let server: WebServer
  let app: App
  beforeAll(async () => {
    server = await startWeb(e2e, off.map(capability => join(import.meta.dirname, 'fixtures/disable-' + capability + '.yml')))
    app = await openApp(server.url)
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'menu-' + name + '-disabled-failure')
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      await server?.stop()
    }
  })

  it('keeps only available sections and explains unavailable capabilities', async () => {
    // The overview proves the independent browser face loaded before testing absence.
    const detail = await openBundle(app.page)
    const overview = detail.getByRole('region', { name: uiText['overview.title'], exact: true })
    await overview.waitFor()
    for (const capability of off) {
      await overview.getByText(uiText[capability === 'search' ? 'disabled.search' : 'disabled.fetch'], { exact: true }).waitFor()
    }
    await overview.getByText(uiText['overview.status.effective'].replace('{provider}', 'search-enhanced'), { exact: true }).waitFor()
    await overview.getByText(uiText['overview.status.effective'].replace('{provider}', 'fetch-enhanced'), { exact: true }).waitFor()
    await overview.scrollIntoViewIfNeeded()
    await app.screenshot('menu-' + name + '-disabled-overview')
    await newSession(app.page)
    if (remaining === null) {
      expect(await connectionButton(app.page).count()).toBe(0)
      expect(await app.page.getByRole('dialog', { name: uiText['menu.aria'], exact: true }).count()).toBe(0)
    } else {
      const menu = await openConnections(app.page)
      const section = await openConnectionTab(menu, remaining)
      await section.getByRole('menuitemradio', { name: uiText['menu.offRow'], exact: true }).waitFor()
      expect(await connectionTabs(menu).getByRole('tab').count()).toBe(1)
      const other = remaining === searchText['section.title'] ? fetchText['section.title'] : searchText['section.title']
      expect(await connectionTabs(menu).getByRole('tab', { name: other, exact: true }).count()).toBe(0)
    }
    await app.screenshot('menu-' + name + '-disabled-composer')
    expect(app.errors).toEqual([])
  })
})
