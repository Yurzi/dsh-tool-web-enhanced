import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import { FETCH, PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { expect } from 'vitest'
import { en as fetchEn, zh as fetchZh } from '../../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiEn, zh as uiZh } from '../../packages/ui/src/client/locales.ts'
import { toolResults, type MessagesRequest } from '../fixtures/enhanced-flow.ts'
import { type App, openApp, recordBrowserFailure } from './browser.ts'
import { isolatedContext, addPlugins, artifacts, enterIsolatedEnvironment, profilePatchPath } from './environment.ts'
import { bootHost } from './host.ts'
import { messagesStream, type ModelToolCall } from './model-api.ts'
import { connectionButton, openConnectionTab, openConnections } from './navigation.ts'
import { startRemoteFetchApi } from './remote-fetch-api.ts'
import { reviewDirectory, reviewScreenshot } from './review.ts'
import { expectTheme } from './theme.ts'
import { type WebServer, startWeb } from './web.ts'

/** Real Agent tool presentation, with transport gates controlling the running screenshot. */
export async function captureEnhancedToolReview(base: Parameters<typeof isolatedContext>[0], view: {
  width: number; scheme: 'light' | 'dark'; locale: 'en-US' | 'zh-CN'
}): Promise<void> {
  const e2e = isolatedContext(base)
  const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
  if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
  addPlugins(e2e, [profile], plugins)
  const gate = Promise.withResolvers<void>()
  const arrived = Promise.withResolvers<void>()
  const success = 'M5 review sources and backend failures completed.'
  const offAnswer = 'M5 review closed connection refused.'
  const calls: readonly ModelToolCall[] = [
    { id: 'review_native', name: 'web_search', input: { queries: ['M5 native sources'] } },
    { id: 'review_sources', name: SEARCH.tools.action, input: { queries: ['M5 enhanced sources'], provider: 'custom:m5-exa' } },
    { id: 'review_fetch_error', name: FETCH.tools.action, input: { url: 'https://example.org/failure', provider: 'custom:m5-firecrawl' } },
    { id: 'review_search_error', name: SEARCH.tools.action, input: { queries: ['M5 enhanced failure'], provider: 'custom:m5-tavily' } },
  ]
  const sources = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
    url: 'https://example.org/source-' + index, title: 'Loopback source ' + name,
    text: 'Evidence from source ' + name + '.', publishedDate: '2026-10-20',
  }))
  const upstream = await startRemoteFetchApi(async request => {
    if (request.path === '/tavily') { arrived.resolve(); await gate.promise }
    return { status: request.path === '/exa' ? 200 : 503, headers: { 'content-type': 'application/json' },
      body: request.path === '/exa' ? JSON.stringify({ results: sources }) : JSON.stringify({ error: 'Loopback service deliberately unavailable.' }) }
  })
  let step = 0
  const model = await startRemoteFetchApi(request => {
    const body = JSON.parse(request.body) as { tools?: readonly unknown[] }
    if (body.tools === undefined || body.tools.length === 0) return messagesStream([{ type: 'text', text: 'M5 review tool presentation' }], 'end_turn')
    switch (step++) {
      case 0: return messagesStream(calls.map(call => ({ type: 'tool_use', ...call })), 'tool_use')
      case 1: return messagesStream([{ type: 'text', text: success }], 'end_turn')
      case 2: return messagesStream([{ type: 'tool_use', id: 'review_off', name: FETCH.tools.action,
        input: { url: 'https://example.org/closed', provider: 'custom:m5-firecrawl' } }], 'tool_use')
      default: return messagesStream([{ type: 'text', text: offAnswer }], 'end_turn')
    }
  })
  let app: App | undefined
  let server: WebServer | undefined
  const prefix = 'm5-review-tools-' + view.width + '-' + view.scheme + '-' + view.locale
  try {
    const connection = (adapter: string, label: string) => ({ kind: 'adapter', adapter, label,
      credentialRef: 'M5_REVIEW_KEY', endpoint: new URL(adapter, upstream.url).href, trustedEndpoint: true })
    writeFileSync(profilePatchPath(e2e), stringify([
      { id: SEARCH.rowId, config: { version: 2, enhancedTools: true, defaultConnection: 'custom:m5-exa', connections: {
        'custom:m5-exa': connection('exa', 'Exa loopback sources'),
        'custom:m5-tavily': connection('tavily', 'Tavily loopback failure'),
      } } },
      { id: FETCH.rowId, config: { version: 2, enhancedTools: true, defaultConnection: 'builtin:local', connections: {
        'custom:m5-firecrawl': connection('firecrawl', 'Firecrawl loopback failure'),
      } } },
    ]))
    e2e.env.DEEPSEEK_BASE_URL = model.url
    enterIsolatedEnvironment(e2e.env)
    const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
    const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
    const bootstrap = await bootHost(e2e)
    try {
      await bootstrap.ctx.credentials.set(ref('DEEPSEEK_API_KEY'), 'm5-review-agent-loopback-only')
      await bootstrap.ctx.credentials.set(ref('M5_REVIEW_KEY'), 'm5-review-service-loopback-only')
      const registry = bootstrap.ctx.get('workspaceRegistry') as { create(path: string, title: string): Promise<{ id: NonNullable<SessionCreateRequest['workspaceId']> }> }
      await registry.create(e2e.env.DSH_HOME!, 'M5 review workspace')
    } finally { await bootstrap.dispose() }
    server = await startWeb(e2e)
    app = await openApp(server.url, { colorScheme: view.scheme, viewport: { width: 1280, height: 1100 } })
    await expectTheme(app.page, view.scheme)
    // Native Detailed mode intentionally leaves live turns flat; use its real Compact setting.
    await app.page.getByRole('button', { name: 'Account menu', exact: true }).click()
    await app.page.getByRole('menuitem', { name: 'Settings', exact: true }).click()
    const general = app.page.getByRole('dialog', { name: 'Settings', exact: true })
    await general.getByRole('button', { name: 'General', exact: true }).click()
    const workDetails = general.getByText('Work details', { exact: true }).locator('../..')
    await workDetails.getByRole('button', { name: 'Detailed', exact: true }).click()
    await app.page.getByRole('menuitem', { name: 'Compact', exact: true }).click()
    await workDetails.getByRole('button', { name: 'Compact', exact: true }).waitFor()
    await general.getByRole('button', { name: 'Close', exact: true }).click()
    await general.waitFor({ state: 'hidden' })
    if (view.locale === 'zh-CN') {
      const storageState = await app.page.context().storageState()
      await app.close()
      app = await openApp(server.url, { locale: view.locale, colorScheme: view.scheme, storageState })
    }
    const fetchCopy = view.locale === 'zh-CN' ? fetchZh : fetchEn
    const uiCopy = view.locale === 'zh-CN' ? uiZh : uiEn
    const currentPage = app.page
    // Workspace is already public-registry backed, so native creation needs no directory dialog.
    await currentPage.getByRole('button', { name: view.locale === 'zh-CN' ? '选择工作区' : 'Choose workspace', exact: true })
      .getByText('M5 review workspace', { exact: true }).waitFor()
    const conversation = currentPage.locator('[data-conversation-session]:visible')
    // This fresh private home already has the native empty conversation for its one workspace.
    await conversation.waitFor()
    await currentPage.setViewportSize({ width: view.width, height: 1100 })
    const input = conversation.getByRole('textbox', { name: view.locale === 'zh-CN'
      ? '描述你想要构建的内容, / 调用指令, @ 文件或对话' : 'Describe what you want to build, / commands, @ files or sessions', exact: true })
    await input.fill('M5 review native and enhanced tools')
    await conversation.getByRole('button', { name: view.locale === 'zh-CN' ? '发送消息' : 'Send message', exact: true }).click()
    await arrived.promise
    await conversation.getByRole('button', { name: new RegExp(view.locale === 'zh-CN' ? '^正在调用工具' : '^Calling tools') }).waitFor()
    await reviewScreenshot(app, prefix + '-running')
    gate.resolve()
    await conversation.getByText(success, { exact: true }).waitFor()
    const process = conversation.getByRole('button').and(currentPage.locator('[data-turn-process-tool-calls="4"]'))
    if (await process.getAttribute('aria-expanded') !== 'true') await process.click()
    const row = (id: string) => conversation.locator('[data-chat-call-id="' + id + '"] [data-tool]')
    if (!await row('review_sources').isVisible()) {
      await conversation.getByRole('button', { name: new RegExp(view.locale === 'zh-CN' ? '^已调用工具' : '^Called tools') }).click()
    }
    expect(await row('review_native').getAttribute('data-variant')).toBe('search')
    expect(await row('review_sources').getAttribute('data-variant')).toBe('others')
    await row('review_sources').getByRole('button', { expanded: false }).first().click()
    for (const source of sources) await row('review_sources').getByText(source.title, { exact: false }).first().waitFor()
    await row('review_sources').evaluate(element => { element.scrollIntoView({ block: 'center' }) })
    await reviewScreenshot(app, prefix + '-sources-expanded')
    await row('review_sources').getByRole('button', { expanded: true }).first().click()
    await row('review_native').evaluate(element => { element.scrollIntoView({ block: 'center' }) })
    await reviewScreenshot(app, prefix + '-native-and-enhanced')
    for (const id of ['review_search_error', 'review_fetch_error']) {
      const tool = row(id)
      expect(await tool.getAttribute('data-state')).toBe('error')
      await tool.evaluate(element => { element.scrollIntoView({ block: 'center' }) })
      await reviewScreenshot(app, prefix + '-' + id + '-collapsed')
      await tool.getByRole('button', { expanded: false }).first().click()
      await tool.getByText('Loopback service deliberately unavailable.', { exact: false }).first().waitFor()
      await reviewScreenshot(app, prefix + '-' + id + '-expanded')
      await tool.getByRole('button', { expanded: true }).first().click()
    }
    const menu = await openConnections(currentPage, uiCopy)
    const panel = await openConnectionTab(menu, fetchCopy['section.title'])
    await panel.getByRole('menuitemradio', { name: fetchCopy['selector.offRow'], exact: true }).click()
    await menu.waitFor({ state: 'hidden' })
    await expect.poll(() => connectionButton(currentPage).locator('span[data-capability="fetch"]').textContent())
      .toContain(fetchCopy['selector.offRow'])
    await conversation.getByRole('textbox', { name: view.locale === 'zh-CN'
      ? '发消息或创建任务, / 调用指令, @ 文件或对话' : 'Message or run a task, / commands, @ files or sessions', exact: true }).fill('M5 review closed connection refusal')
    await conversation.getByRole('button', { name: view.locale === 'zh-CN' ? '发送消息' : 'Send message', exact: true }).click()
    await conversation.getByText(offAnswer, { exact: true }).waitFor()
    const offProcess = conversation.getByRole('button').and(currentPage.locator('[data-turn-process-tool-calls="1"]'))
    if (await offProcess.getAttribute('aria-expanded') !== 'true') await offProcess.click()
    if (!await row('review_off').isVisible()) {
      await conversation.getByRole('button', { name: new RegExp(view.locale === 'zh-CN' ? '^已调用工具' : '^Called tools') }).last().click()
    }
    await row('review_off').getByRole('button', { expanded: false }).first().click()
    expect(await row('review_off').getAttribute('data-state')).toBe('error')
    await row('review_off').evaluate(element => { element.scrollIntoView({ block: 'center' }) })
    await reviewScreenshot(app, prefix + '-session-off-refused')
    const results = model.requests.flatMap(request => toolResults(JSON.parse(request.body) as MessagesRequest))
    const refused = results.find(result => result.id === 'review_off')!
    expect(refused.error).toBe(true)
    expect(refused.text).toMatch(/off|unknown tool|not available/i)
    expect(upstream.requests.filter(request => request.path === '/firecrawl')).toHaveLength(1)
    for (const directory of [artifacts, reviewDirectory]) {
      writeFileSync(join(directory, prefix + '-results.json'), JSON.stringify({ results, upstream: upstream.requests }, null, 2))
    }
    expect(app.errors).toEqual([])
  } catch (error) {
    if (app !== undefined) await recordBrowserFailure(app, prefix + '-failure')
    throw error
  } finally {
    gate.resolve()
    if (app !== undefined) await app.close()
    if (server !== undefined) await server.stop()
    await model.close()
    await upstream.close()
  }
}
