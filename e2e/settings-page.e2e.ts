import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { composedRows, installUserFixture, profilePatchPath } from './harness/environment.ts'
import { openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = inject('e2e')

describe.skipIf(chromiumPath === undefined && !browserRequired)('Plugin row settings', () => {
  let server: WebServer
  let app: App
  let savedPatch: { path: string; content: string } | undefined
  beforeAll(async () => {
    const path = profilePatchPath(e2e)
    savedPatch = { path, content: existsSync(path) ? readFileSync(path, 'utf8') : '' }
    installUserFixture(e2e, join(import.meta.dirname, 'fixtures/search-exa-enabled.yml'))
    server = await startWeb(e2e)
    app = await openApp(server.url)
  })
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'settings-page-failure')
  })
  afterAll(async () => {
    try {
      await app?.close()
    } finally {
      try {
        await server?.stop()
      } finally {
        // Do not leave Exa selected for later specs if this test fails. Those
        // specs deliberately exercise the native no-credential error path.
        if (savedPatch !== undefined) writeFileSync(savedPatch.path, savedPatch.content)
      }
    }
  })

  it('diagnoses invalid CIDR lines and saves valid fetch rules only explicitly', async () => {
    const settings = await openFetchSettings(app.page)
    const cidrs = settings.getByRole('textbox', { name: fetchText['allowlist.allowCidrs'], exact: true })
    const save = settings.getByRole('button', { name: fetchText['allowlist.save'], exact: true })
    const config = () => composedRows(e2e).find(row => row.id === FETCH.rowId)?.config
    const original = config()
    await cidrs.fill('127.0.0.1/32\n10.1/16')
    await settings.getByText(fetchText['allowlist.problem.ipv4-form'], { exact: false }).waitFor()
    await settings.getByText('Line 2: 10.1/16', { exact: false }).waitFor()
    expect(await cidrs.getAttribute('aria-invalid')).toBe('true')
    expect(await save.isDisabled()).toBe(true)
    expect(config()).toEqual(original)
    await app.screenshot('fetch-settings-invalid')

    await cidrs.fill('127.0.0.1/32\n10.1.0.0/16')
    expect(await cidrs.getAttribute('aria-invalid')).toBe('false')
    expect(await save.isEnabled()).toBe(true)
    expect(config()).toEqual(original)
    await save.click()
    await expect.poll(config, { timeout: 15_000 }).toMatchObject({
      version: 2, connections: { 'builtin:local': { options: { allowCidrs: ['127.0.0.1/32', '10.1.0.0/16'], allowHostnames: [] } } },
    })
    await app.page.reload()
    const reopened = await openFetchSettings(app.page)
    expect(await reopened.getByRole('textbox', { name: fetchText['allowlist.allowCidrs'], exact: true }).inputValue()).toBe('127.0.0.1/32\n10.1.0.0/16')
    await app.screenshot('fetch-settings-saved')
    expect(app.errors).toEqual([])
  })

  it('sparsely saves and clears the default connection through the row configuration page', async () => {
    const settings = await openSearchSettings(app.page)
    const selected = () => composedRows(e2e).find(row => row.id === SEARCH.rowId)?.config?.defaultConnection
    expect(selected()).toBeUndefined()
    const button = settings.getByRole('button', { name: searchText['defaults.connection'], exact: true })
    await button.click()
    await app.page.getByRole('menuitem', { name: 'Exa', exact: true }).click()
    await expect.poll(selected, { timeout: 15_000 }).toBe('builtin:exa')
    await expect.poll(() => button.textContent()).toBe('Exa')
    await app.screenshot('settings-saved')
    // Reload proves this is accepted Host state, not an optimistic browser value.
    await app.page.reload()
    const reopened = await openSearchSettings(app.page)
    const restoredButton = reopened.getByRole('button', { name: searchText['defaults.connection'], exact: true })
    await expect.poll(() => restoredButton.textContent()).toBe('Exa')
    await restoredButton.click()
    await app.page.getByRole('menuitem', { name: searchText['defaults.connectionUnset'].replace('{name}', 'DeepSeek Messages'), exact: true }).click()
    await expect.poll(selected, { timeout: 15_000 }).toBeUndefined()
    expect(app.errors).toEqual([])
  })
})
