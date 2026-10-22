import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { FETCH, PROFILE_PACKAGE, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { en as searchText, zh as searchZh } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText, zh as fetchZh } from '../packages/fetch-enhanced/src/client/locales.ts'
import { en as uiText, zh as uiZh } from '../packages/ui/src/client/locales.ts'
import { enhancedCalls, enhancedFlow, enhancedRows, toolResults, type MessagesRequest } from './fixtures/enhanced-flow.ts'
import { modelFixture } from './fixtures/search-model.ts'
import { firecrawlResponse, remoteFetchFixture } from './fixtures/remote-fetch.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows, enterIsolatedEnvironment, profilePatchPath } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { startAgentModelApi, startModelApi } from './harness/model-api.ts'
import { connectionButton, openConnectionTab, openConnections } from './harness/navigation.ts'
import { startRemoteFetchApi } from './harness/remote-fetch-api.ts'
import { reviewScreenshot } from './harness/review.ts'
import { modelViewport } from './harness/model-visuals.ts'
import { expectTheme, setTheme } from './harness/theme.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const { createUserMessage: userMessage } = require('@deepseek-ai/dsh-llm') as { createUserMessage: typeof createUserMessage }
const matrix = [1280, 768, 390].flatMap(width => (['light', 'dark'] as const).flatMap(scheme =>
  (['en-US', 'zh-CN'] as const).map(locale => ({ width, scheme, locale }))))

describe('Enhanced tools driven by a loopback model in the real Host', () => {
  let model: Awaited<ReturnType<typeof startAgentModelApi>>
  let search: Awaited<ReturnType<typeof startModelApi>>
  let fetchApi: Awaited<ReturnType<typeof startRemoteFetchApi>>
  let sessionId: string
  let server: WebServer | undefined
  let app: App | undefined
  const diagnostics: string[] = []

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    model = await startAgentModelApi(enhancedCalls, enhancedFlow.answer)
    search = await startModelApi({ content: [{ type: 'text', text: enhancedFlow.searchContent }] })
    fetchApi = await startRemoteFetchApi(firecrawlResponse())
    e2e.env.DEEPSEEK_BASE_URL = model.url
    writeFileSync(profilePatchPath(e2e), stringify(enhancedRows(search.url, new URL('v2/scrape', fetchApi.url).href)))
    enterIsolatedEnvironment(e2e.env)
  })

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'enhanced-flow-failure')
    } finally {
      if (app !== undefined) { await app.close(); app = undefined }
    }
  })

  afterAll(async () => {
    try {
      if (server !== undefined) await server.stop()
    } finally {
      writeFileSync(join(artifacts, 'enhanced-flow-host.log'), diagnostics.join('\n'))
      for (const [name, api] of [['model', model], ['search', search], ['fetch', fetchApi]] as const) {
        if (api !== undefined) {
          writeFileSync(join(artifacts, 'enhanced-flow-' + name + '-wire.json'), JSON.stringify(api.requests, null, 2))
          await api.close()
        }
      }
    }
  })

  it('executes both lists and both actions on the named providers without changing either session choice', async () => {
    const host = await bootHost(e2e, [], root => {
      root.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.name + ': ' + message.args.map(String).join(' ')) } })
      root.on('agent/created', ({ agent }) => {
        const session = agent.session
        diagnostics.push('agent/created lifecycle: ' + JSON.stringify({
          parentSession: session.header.parentSession, isSeeded: session.header.isSeeded,
          firstLiveSeq: session.firstLiveSeq, firstLifecycleSeq: session.firstLifecycleSeq,
          seq: session.seq, inheritedEventCount: session.inheritedEventCount,
        }))
      })
    })
    const configuration = {
      rows: composedRows(e2e).filter(row => [SEARCH.rowId, FETCH.rowId, 'web'].includes(row.id)),
      settings: host.ctx.settings.describe().filter(record => [SEARCH.rowId, FETCH.rowId, 'web'].includes(record.ns)),
      environment: Object.fromEntries(Object.entries(e2e.env).filter(([name]) => /^DSH_WEB_.*_PROVIDER$/.test(name))),
      globalEnhanced: enhancedCalls.map(call => ({ name: call.name, registered: host.ctx.tools.get(call.name) !== undefined })),
    }
    writeFileSync(join(artifacts, 'enhanced-flow-registration.json'), JSON.stringify(configuration, null, 2))
    const keys = [ref('DEEPSEEK_API_KEY'), ref(modelFixture.credentialRef), ref(remoteFetchFixture.credentialRef)]
    try {
      await host.ctx.credentials.set(keys[0]!, 'm5-loopback-model-only')
      await host.ctx.credentials.set(keys[1]!, modelFixture.key)
      await host.ctx.credentials.set(keys[2]!, remoteFetchFixture.key)
      const registry = host.ctx.get('workspaceRegistry') as { create(path: string, title: string): Promise<{ id: NonNullable<SessionCreateRequest['workspaceId']> }> }
      const workspace = await registry.create(e2e.env.DSH_HOME!, 'M5 loopback workspace')
      const created = await host.ctx.sessionController.create({ workspaceId: workspace.id })
      sessionId = created.sessionId
      await host.ctx.sessionController.rename({ sessionId: created.sessionId, title: enhancedFlow.title })
      const resolved = await host.ctx.sessionController.resolveAgent(created.sessionId)
      if ('error' in resolved) throw resolved.error
      writeFileSync(join(artifacts, 'enhanced-flow-agent-registration.json'), JSON.stringify({
        preset: created.agentPreset,
        session: { seq: resolved.agent.session.seq, firstLiveSeq: resolved.agent.session.firstLiveSeq, firstLifecycleSeq: resolved.agent.session.firstLifecycleSeq, inheritedEventCount: resolved.agent.session.inheritedEventCount, header: resolved.agent.session.header },
        tools: host.ctx.tools.schemas(resolved.agent).map(tool => tool.name),
      }, null, 2))
      const beforeSearch = await host.ctx.searchConnections.get({ sessionId })
      const beforeFetch = await host.ctx.fetchConnections.get({ sessionId })
      resolved.agent.followup(userMessage({ content: [{ type: 'text', text: 'Exercise all four enhanced tools against the fixture providers.' }], source: { kind: 'user' } }))
      await resolved.agent.whenIdle()
      writeFileSync(join(artifacts, 'enhanced-flow-model-wire.json'), JSON.stringify(model.requests, null, 2))
      expect(model.requests).toHaveLength(2)
      const first = JSON.parse(model.requests[0]!.body) as MessagesRequest
      expect(first.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(enhancedCalls.map(call => call.name)))
      const results = toolResults(JSON.parse(model.requests[1]!.body) as MessagesRequest)
      expect(results.map(result => result.id).toSorted()).toEqual(enhancedCalls.map(call => call.id).toSorted())
      for (const result of results) expect(result.error, result.text).toBe(false)
      expect(results.find(result => result.id === 'm5_search')!.text.split('\n')[0]).toBe('Provider: ' + modelFixture.connectionId)
      expect(results.find(result => result.id === 'm5_fetch')!.text.split('\n')[0]).toBe('Provider: ' + remoteFetchFixture.connectionId)
      expect(results.find(result => result.id === 'm5_list_search')!.text).toContain(modelFixture.connectionId)
      expect(results.find(result => result.id === 'm5_list_fetch')!.text).toContain(remoteFetchFixture.connectionId)
      expect(search.requests).toHaveLength(1)
      expect(JSON.parse(search.requests[0]!.body)).toMatchObject({ model: modelFixture.model })
      expect(search.requests[0]).toMatchObject({ path: '/v1/messages', headers: { 'x-api-key': modelFixture.key } })
      expect(fetchApi.requests).toHaveLength(1)
      expect(fetchApi.requests[0]).toMatchObject({ path: '/v2/scrape', headers: { authorization: 'Bearer ' + remoteFetchFixture.key } })
      expect(JSON.parse(fetchApi.requests[0]!.body).url).toBe(remoteFetchFixture.requestedUrl)
      expect((await host.ctx.searchConnections.get({ sessionId })).selection).toEqual(beforeSearch.selection)
      expect((await host.ctx.fetchConnections.get({ sessionId })).selection).toEqual(beforeFetch.selection)
      expect((await host.ctx.searchConnections.pairings({})).pairings).toEqual([])
      expect((await host.ctx.fetchConnections.pairings({})).pairings).toEqual([])
    } finally {
      // Keep fake credentials until the private screenshot home is discarded: historical output and the menu must describe the same state.
      await host.dispose()
    }
  })

  it.skipIf(chromiumPath === undefined && !browserRequired).each(matrix)('shows generic tool rows at $width px in $scheme / $locale', async ({ width, scheme, locale }) => {
    if (server === undefined) server = await startWeb(e2e)
    app = await openApp(server.url)
    async function openConversation(current: App, language: 'en-US' | 'zh-CN') {
      // Public session search waits for the native workspace source and ignores persisted group expansion.
      const searchButton = current.page.getByRole('button', { name: language === 'zh-CN' ? '搜索会话' : 'Search sessions', exact: true })
      if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
      const input = current.page.getByRole('textbox', { name: language === 'zh-CN' ? '搜索会话名称' : 'Search session names', exact: true })
      await input.fill(enhancedFlow.title)
      const item = current.page.getByRole('treeitem').filter({ has: current.page.getByText(enhancedFlow.title, { exact: true }) })
      if (await item.getAttribute('aria-selected') !== 'true') await item.click()
      await current.page.locator('[data-conversation-session="' + sessionId + '"]').getByText(enhancedFlow.answer, { exact: true }).waitFor()
    }
    await openConversation(app, 'en-US')
    await setTheme(app.page, scheme)
    if (locale === 'zh-CN') {
      const url = app.page.url()
      const storageState = await app.page.context().storageState()
      await app.close()
      app = await openApp(url, { locale, storageState })
      await openConversation(app, locale)
    }
    const { page } = app
    const searchCopy = locale === 'zh-CN' ? searchZh : searchText
    const fetchCopy = locale === 'zh-CN' ? fetchZh : fetchText
    const uiCopy = locale === 'zh-CN' ? uiZh : uiText
    const conversation = page.locator('[data-conversation-session="' + sessionId + '"]')
    await conversation.getByText(enhancedFlow.answer, { exact: true }).waitFor()
    const process = conversation.getByRole('button').and(page.locator('[data-turn-process-tool-calls="4"]'))
    if (await process.getAttribute('aria-expanded') !== 'true') await process.click()
    const firstRow = conversation.locator('[data-tool="' + enhancedCalls[0]!.name + '"]')
    if (!await firstRow.isVisible()) {
      await conversation.getByRole('button', { name: locale === 'zh-CN' ? '已调用工具' : 'Called tools', exact: true }).click()
    }
    await firstRow.waitFor()
    await modelViewport(page, width, locale === 'zh-CN' ? '全局面板' : 'Global panels')
    await expectTheme(page, scheme)
    const name = 'm5-tools-' + width + '-' + scheme + '-' + locale
    async function capture(suffix: string) {
      await reviewScreenshot(app!, name + '-' + suffix)
    }
    for (const call of enhancedCalls) {
      const row = conversation.locator('[data-tool="' + call.name + '"]')
      const toggle = row.getByRole('button', { expanded: false }).first()
      const expanded = row.getByRole('button', { expanded: true }).first()
      if (await expanded.count() > 0) await expanded.click()
      await row.scrollIntoViewIfNeeded()
      await capture(call.name + '-collapsed')
      expect(await row.getAttribute('data-variant')).toBe('others')
      await toggle.click()
      await capture(call.name + '-expanded')
      if (call.name === SEARCH.tools.action) await row.getByText('Provider: ' + modelFixture.connectionId, { exact: false }).waitFor()
      if (call.name === FETCH.tools.action) await row.getByText('Provider: ' + remoteFetchFixture.connectionId, { exact: false }).waitFor()
      await expanded.click()
    }
    const menu = await openConnections(page, uiCopy)
    const searchPanel = await openConnectionTab(menu, searchCopy['section.title'])
    expect(await searchPanel.getByRole('menuitemradio', { checked: true }).innerText()).toContain('DeepSeek Messages')
    const fetchPanel = await openConnectionTab(menu, fetchCopy['section.title'])
    expect(await fetchPanel.getByRole('menuitemradio', { checked: true }).innerText()).toContain(fetchCopy['connection.local'])
    expect(await connectionButton(page).getAttribute('aria-label')).not.toContain(remoteFetchFixture.label)
    await capture('session-selection-unchanged')
    await page.keyboard.press('Escape')
    expect(app.errors).toEqual([])
  })
})
