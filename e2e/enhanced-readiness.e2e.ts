import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import { FETCH, PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { en as text } from '../packages/fetch-enhanced/src/client/locales.ts'
import { toolResults, type MessagesRequest } from './fixtures/enhanced-flow.ts'
import { customFetchDocument, firecrawlResponse, remoteFetchFixture } from './fixtures/remote-fetch.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, enterIsolatedEnvironment, profilePatchPath } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startAgentModelApi } from './harness/model-api.ts'
import { newSession, openConnectionTab, openConnections, openFetchSettings } from './harness/navigation.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'
import { reviewDirectory, reviewScreenshot } from './harness/review.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const require = createRequire(join(base.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const answer = 'M5 provider readiness checked in one running Host.'

describe.skipIf(chromiumPath === undefined && !browserRequired)('Menu and enhanced listing credential readiness', () => {
  let app: App | undefined
  let server: WebServer | undefined
  let model: Awaited<ReturnType<typeof startAgentModelApi>> | undefined
  let fetchApi: Awaited<ReturnType<typeof startRemoteFetchApi>> | undefined
  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'enhanced-readiness-failure')
    } finally {
      if (app !== undefined) { await app.close(); app = undefined }
      if (server !== undefined) { await server.stop(); server = undefined }
      if (model !== undefined) {
        writeFileSync(join(artifacts, 'enhanced-readiness-model-wire.json'), JSON.stringify(model.requests, null, 2))
        await model.close()
        model = undefined
      }
      if (fetchApi !== undefined) { await fetchApi.close(); fetchApi = undefined }
    }
  })

  it('agrees after the same GUI Host saves a custom API key and the browser refreshes', async () => {
    const e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    fetchApi = await startRemoteFetchApi(firecrawlResponse())
    model = await startAgentModelApi([{ id: 'm5_readiness_list', name: FETCH.tools.list, input: {} }], answer)
    e2e.env.DEEPSEEK_BASE_URL = model.url
    const document = customFetchDocument(new URL('v2/scrape', fetchApi.url).href)
    writeFileSync(profilePatchPath(e2e), stringify([{ id: FETCH.rowId, config: { ...document, enhancedTools: true } }]))
    enterIsolatedEnvironment(e2e.env)
    const bootstrap = await bootHost(e2e)
    try {
      await bootstrap.ctx.credentials.set(ref('DEEPSEEK_API_KEY'), 'm5-readiness-model-loopback-only')
      expect(await bootstrap.ctx.credentials.describe(ref(remoteFetchFixture.credentialRef))).toMatchObject({ configured: false })
    } finally { await bootstrap.dispose() }

    // All remaining mutations, menu reads and Agent calls use this one running GUI Host.
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const { page } = app
    const settings = await openFetchSettings(page)
    const custom = settings.getByRole('listitem').filter({ has: page.getByText(remoteFetchFixture.connectionId, { exact: true }) })
    await custom.getByRole('button', { name: text['credential.manage'], exact: true }).click()
    await custom.getByLabel(text['credential.label'], { exact: true }).fill(remoteFetchFixture.key)
    await custom.getByRole('button', { name: text['credential.save'], exact: true }).click()
    await custom.getByRole('status').getByText(text['credential.saved'], { exact: true }).waitFor()
    await page.reload()
    const sessionId = await newSession(page)
    const menu = await openConnections(page)
    await openConnectionTab(menu, text['section.title'])
    const row = menu.getByRole('tabpanel').getByRole('menuitemradio', { name: new RegExp('^' + remoteFetchFixture.label + '(?: |$)') })
    const ready = text['status.remoteReady'].replace('{access}', text['access.apiKey']).replace('{name}', remoteFetchFixture.label)
    await row.getByText(ready, { exact: true }).waitFor()
    expect(await row.isEnabled()).toBe(true)
    const menuText = await row.innerText()
    await reviewScreenshot(app, 'm5-readiness-menu-after-key-refresh')
    await page.keyboard.press('Escape')
    const conversation = page.locator('[data-conversation-session="' + sessionId + '"]')
    await conversation.getByRole('textbox', { name: 'Describe what you want to build, / commands, @ files or sessions', exact: true }).fill('List fetch providers after saving the custom credential.')
    await conversation.getByRole('button', { name: 'Send message', exact: true }).click()
    await conversation.getByText(answer, { exact: true }).waitFor()
    const result = model.requests.flatMap(request => toolResults(JSON.parse(request.body) as MessagesRequest))
      .find(entry => entry.id === 'm5_readiness_list')!
    expect(result.error).toBe(false)
    const customLine = result.text.split('\n').find(line => line.includes(remoteFetchFixture.connectionId))!
    expect(customLine).toContain('ready')
    expect(customLine).not.toContain('needs-credential')
    const process = conversation.getByRole('button').and(page.locator('[data-turn-process-tool-calls="1"]'))
    if (await process.getAttribute('aria-expanded') !== 'true') await process.click()
    const tool = conversation.locator('[data-tool="' + FETCH.tools.list + '"]')
    if (!await tool.isVisible()) await conversation.getByRole('button', { name: 'Called tools', exact: true }).click()
    await tool.getByRole('button', { expanded: false }).first().click()
    await reviewScreenshot(app, 'm5-readiness-list-after-key-refresh')
    const evidence = { sameRunningHost: true, pageRefreshed: true, connectionId: remoteFetchFixture.connectionId,
      menuText, listingLine: customLine, listing: result.text, targetRequests: fetchApi.requests.length }
    for (const folder of [artifacts, reviewDirectory]) {
      writeFileSync(join(folder, 'm5-readiness-after-key-refresh.json'), JSON.stringify(evidence, null, 2))
    }
    expect(fetchApi.requests).toEqual([])
    expect(app.errors).toEqual([])
  })
})
