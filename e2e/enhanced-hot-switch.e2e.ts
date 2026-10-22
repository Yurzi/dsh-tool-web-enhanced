import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FETCH, PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { en as text } from '../packages/search-enhanced/src/client/locales.ts'
import type { MessagesRequest } from './fixtures/enhanced-flow.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows, enterIsolatedEnvironment, profilePatchPath } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startTextModelApi } from './harness/model-api.ts'
import { newSession, openSearchSettings } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const require = createRequire(join(base.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const answer = 'M5 hot-switch loopback answer.'
const inputLabel = /^(?:Message or run a task|Describe what you want to build), \/ commands, @ files or sessions$/

describe.skipIf(chromiumPath === undefined && !browserRequired)('Enhanced tools switch in the running GUI', () => {
  let app: App | undefined
  let server: WebServer | undefined
  let api: Awaited<ReturnType<typeof startTextModelApi>> | undefined
  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'enhanced-hot-switch-failure')
    } finally {
      if (app !== undefined) { await app.close(); app = undefined }
      if (server !== undefined) { await server.stop(); server = undefined }
      if (api !== undefined) {
        writeFileSync(join(artifacts, 'enhanced-hot-switch-wire.json'), JSON.stringify(api.requests, null, 2))
        await api.close()
        api = undefined
      }
    }
  })

  it('shows both pairs after GUI opt-in and removes only search from the next request after GUI opt-out without restarting', async () => {
    const e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    api = await startTextModelApi(answer)
    e2e.env.DEEPSEEK_BASE_URL = api.url
    writeFileSync(profilePatchPath(e2e), stringify([{ id: FETCH.rowId, config: { enhancedTools: true } }]))
    enterIsolatedEnvironment(e2e.env)
    const host = await bootHost(e2e)
    try { await host.ctx.credentials.set(ref('DEEPSEEK_API_KEY'), 'm5-hot-switch-loopback-only') }
    finally { await host.dispose() }
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const { page } = app
    const settings = await openSearchSettings(page)
    const enabled = settings.getByRole('switch', { name: text['enhanced.title'], exact: true })
    expect(await enabled.isChecked()).toBe(false)
    await enabled.click()
    await expect.poll(() => composedRows(e2e).find(row => row.id === SEARCH.rowId)!.config).toMatchObject({ enhancedTools: true })
    const sessionId = await newSession(page)
    const conversation = page.locator('[data-conversation-session="' + sessionId + '"]')
    const before = api.requests.length
    await conversation.getByRole('textbox', { name: inputLabel, exact: true }).fill('M5 enabled turn')
    await conversation.getByRole('button', { name: 'Send message', exact: true }).click()
    await conversation.getByText(answer, { exact: true }).waitFor()
    const requests = () => api!.requests.map(request => JSON.parse(request.body) as MessagesRequest)
      .filter(request => 'tools' in request && request.tools.some(tool => tool.name === 'web_fetch'))
    await expect.poll(() => api!.requests.length).toBeGreaterThan(before)
    const first = requests().at(-1)!
    expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      SEARCH.tools.action, SEARCH.tools.list, FETCH.tools.action, FETCH.tools.list,
    ]))
    const offSettings = await openSearchSettings(page)
    await offSettings.getByRole('switch', { name: text['enhanced.title'], exact: true }).click()
    await expect.poll(() => composedRows(e2e).find(row => row.id === SEARCH.rowId)!.config).not.toHaveProperty('enhancedTools')
    // This dedicated home contains exactly one conversation, after the workspace row.
    await page.getByRole('treeitem').last().click()
    await conversation.getByRole('textbox', { name: inputLabel, exact: true }).fill('M5 disabled next turn')
    await conversation.getByRole('button', { name: 'Send message', exact: true }).click()
    await expect.poll(() => conversation.getByText(answer, { exact: true }).count()).toBe(2)
    const second = requests().at(-1)!
    const names = second.tools.map(tool => tool.name)
    expect(names).not.toContain(SEARCH.tools.action)
    expect(names).not.toContain(SEARCH.tools.list)
    expect(names).toEqual(expect.arrayContaining([FETCH.tools.action, FETCH.tools.list]))
    await reviewScreenshot(app, 'm5-hot-switch-next-request')
    expect(app.errors).toEqual([])
  })
})
