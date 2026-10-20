/**
 * The bundle on the Plugins page of the real DSH Web GUI, in headless
 * Chromium: its own title and icon metadata, and one row per plugin with the
 * plugin's own title. Read-only: nothing here writes the profile.
 *
 * Needs a Chromium or Chrome binary (DSH_E2E_CHROMIUM or a system path). It
 * is skipped without one locally and fails under CI.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { type App, browserRequired, chromiumPath, openApp } from './harness/browser.ts'
import { artifacts } from './harness/environment.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = inject('e2e')

describe.skipIf(chromiumPath === undefined && !browserRequired)('Plugins page', () => {
  let server: WebServer
  let app: App

  beforeAll(async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
  })

  afterAll(async () => {
    await app?.close()
    await server?.stop()
  })

  const detail = () => app.page.locator(`[data-plugin-detail="${PROFILE_PACKAGE}"]`)

  it('lists the bundle with its own title, both plugin rows, and the menu row', async () => {
    const { page } = app
    await page.getByRole('navigation', { name: 'Global panels' }).getByRole('button', { name: 'Plugins' }).click()
    const card = page.locator(`[data-plugin-package="${PROFILE_PACKAGE}"]`)
    await card.getByText('Web Tools Enhanced').waitFor()
    await card.getByRole('button', { name: /^View / }).click()
    await detail().getByRole('heading', { name: 'Web Tools Enhanced' }).waitFor()
    await detail().getByText('Web Search Enhanced', { exact: true }).waitFor()
    await detail().getByText('Web Fetch Enhanced', { exact: true }).waitFor()
    await detail().getByText('Web Connection Menu').waitFor()
    await app.screenshot('plugins-bundle')
  })

  it('logs no browser errors', () => {
    writeFileSync(join(artifacts, 'console-errors.json'), JSON.stringify(app.errors, null, 2))
    expect(app.errors).toEqual([])
  })
})
