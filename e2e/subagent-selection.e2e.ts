import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionCreateRequest } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { stringify } from 'yaml'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { selectionRows, startSelectionBackend, startSubagentModel, subagentSelection as fixture } from './fixtures/subagent-selection.ts'
import { toolResults, type MessagesRequest } from './fixtures/enhanced-flow.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, enterIsolatedEnvironment, profilePatchPath } from './harness/environment.ts'
import { bootHost, type Host } from './harness/host.ts'
import { openConnectionTab, openConnections, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { reviewScreenshot } from './harness/review.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const e2e = isolatedContext(inject('e2e'))
const require = createRequire(join(e2e.install, 'node_modules/@deepseek-ai/dsh/package.json'))
const { credentialRef: ref } = require('@deepseek-ai/dsh-credentials') as { credentialRef: typeof credentialRef }
const { createUserMessage: userMessage } = require('@deepseek-ai/dsh-llm') as { createUserMessage: typeof createUserMessage }
const inputLabel = /^(?:Message or run a task|Describe what you want to build), \/ commands, @ files or sessions$/
type Kind = typeof fixture.kinds[number]

/** Join the real descendant lifecycle, including completion notifications queued on the parent. */
async function settle(host: Host, parent: Agent) {
  const subagents = host.ctx.get('subagents') as { waitForChildren(agent: Agent): Promise<boolean> }
  do { await parent.whenIdle() } while (await subagents.waitForChildren(parent))
  await parent.whenIdle()
}

async function resolveParent(host: Host, id: SessionId) {
  const result = await host.ctx.sessionController.resolveAgent(id)
  if ('error' in result) throw result.error
  return result.agent
}

describe.skipIf(chromiumPath === undefined && !browserRequired)('Subagent connection selection in the real DSH', () => {
  let model: Awaited<ReturnType<typeof startSubagentModel>>
  let backendA: Awaited<ReturnType<typeof startSelectionBackend>>
  let backendB: Awaited<ReturnType<typeof startSelectionBackend>>
  let app: App | undefined
  let server: WebServer | undefined
  let parentId: SessionId
  let userForkId: string
  const children = new Map<Kind, SessionId>()
  const diagnostics: string[] = []

  beforeAll(async () => {
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    model = await startSubagentModel()
    backendA = await startSelectionBackend()
    backendB = await startSelectionBackend()
    e2e.env.DEEPSEEK_BASE_URL = model.url
    writeFileSync(profilePatchPath(e2e), stringify(selectionRows(backendA.url, backendB.url)))
    enterIsolatedEnvironment(e2e.env)
  })

  async function closeGui() {
    if (app !== undefined) { await app.close(); app = undefined }
    if (server !== undefined) { await server.stop(); server = undefined }
  }

  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'm55-subagent-selection-' + task.name.replace(/[^a-z0-9-]+/gi, '-') + '-failure')
    } finally { await closeGui() }
  })

  afterAll(async () => {
    await closeGui()
    writeFileSync(join(artifacts, 'm55-subagent-host.log'), diagnostics.join('\n'))
    if (model !== undefined) {
      const summary = model.requests.map(request => {
        const body = JSON.parse(request.body) as MessagesRequest
        return { session: request.headers['x-deepseek-harness-session-id'], messages: body.messages.slice(-3).map(message => ({
          role: message.role, content: typeof message.content === 'string' ? message.content.slice(0,160)
            : message.content.map(block => block.type === 'text' ? { text: block.text.slice(0,160) }
              : block.type === 'tool_result' ? { result: block.tool_use_id } : { tool: block.name }),
        })) }
      })
      writeFileSync(join(artifacts, 'm55-subagent-model-summary.json'), JSON.stringify(summary, null, 2))
    }
    for (const [name, api] of [['model', model], ['backend-a', backendA], ['backend-b', backendB]] as const) {
      if (api !== undefined) {
        writeFileSync(join(artifacts, 'm55-subagent-' + name + '-wire.json'), JSON.stringify(api.requests, null, 2))
        await api.close()
      }
    }
  })

  async function openParent() {
    const page = app!.page
    const search = page.getByRole('button', { name: 'Search sessions', exact: true })
    if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
    await page.getByRole('textbox', { name: 'Search session names', exact: true }).fill(fixture.title)
    const row = page.getByRole('treeitem').filter({ has: page.getByText(fixture.title, { exact: true }) })
    await row.click()
    await page.locator('[data-conversation-session="' + parentId + '"]').waitFor()
    // Search results intentionally omit the ordinary sidebar row-action slots.
    await search.click()
  }

  async function chooseBoth(suffix: 'A' | 'B') {
    for (const [copy, label] of [[searchText, 'M55 Search '], [fetchText, 'M55 Fetch ']] as const) {
      const menu = await openConnections(app!.page)
      const panel = await openConnectionTab(menu, copy['section.title'])
      await panel.getByRole('menuitemradio', { name: new RegExp('^' + label + suffix + '(?: |$)') }).click()
      await menu.waitFor({ state: 'hidden' })
      await openConnections(app!.page)
      await openConnectionTab(menu, copy['section.title'])
      await expect.poll(() => panel.getByRole('menuitemradio', { name: new RegExp('^' + label + suffix + '(?: |$)') }).getAttribute('aria-checked')).toBe('true')
      await panel.getByText(copy['source.session'], { exact: true }).waitFor()
      await app!.page.keyboard.press('Escape')
    }
  }

  it('creates spawn and subagent_fork through the preset tools, then switches live and cold children without model memories', async () => {
    const host = await bootHost(e2e, [], root => {
      root.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.name + ': ' + message.args.map(String).join(' ')) } })
      root.on('agent/created', ({ agent }) => {
        if (agent.session.header.origin === 'subagent') {
          const kind = agent.session.header.isSeeded ? 'fork' : 'spawn'
          children.set(kind, agent.session.id)
          diagnostics.push('child created ' + kind + ' ' + agent.session.id)
        }
      })
    })
    try {
      await host.ctx.credentials.set(ref('DEEPSEEK_API_KEY'), fixture.key)
      await host.ctx.credentials.set(ref(fixture.credentialRef), fixture.key)
      const registry = host.ctx.get('workspaceRegistry') as { create(path: string, title: string): Promise<{ id: NonNullable<SessionCreateRequest['workspaceId']> }> }
      const workspace = await registry.create(e2e.env.DSH_HOME!, 'M5.5 loopback workspace')
      const created = await host.ctx.sessionController.create({ workspaceId: workspace.id, agentPreset: 'standard' })
      parentId = created.sessionId
      await host.ctx.sessionController.rename({ sessionId: parentId, title: fixture.title })
      const parent = await resolveParent(host, parentId)
      expect(host.ctx.tools.schemas(parent).map(tool => tool.name)).toEqual(expect.arrayContaining(['subagent', 'subagent_fork', 'send_message']))
      // Give subagent_fork a real completed parent turn to inherit.
      parent.followup(userMessage({ content: [{ type: 'text', text: 'M55 completed parent seed' }], source: { kind: 'user' } }))
      await settle(host, parent)
      model.next(fixture.kinds.map(kind => ({
        id: 'm55_create_' + kind, name: kind === 'spawn' ? 'subagent' : 'subagent_fork',
        input: { description: 'M55 ' + kind + ' child', prompt: 'M55 initial ' + kind + ' child; answer once.' },
      })))
      parent.followup(userMessage({ content: [{ type: 'text', text: 'M55 create both children' }], source: { kind: 'user' } }))
      await settle(host, parent)
      expect([...children.keys()].toSorted()).toEqual(['fork', 'spawn'])
      for (const id of children.values()) {
        await expect.poll(() => host.ctx.agents.get(id)).toBeUndefined()
        expect((await host.ctx.sessionPersistence.stat(id))!.header).toMatchObject({ origin: 'subagent', parentSession: parentId })
      }
      expect((await host.ctx.searchConnections.pairings({})).pairings).toEqual([])
      expect((await host.ctx.fetchConnections.pairings({})).pairings).toEqual([])
    } finally { await host.dispose() }

    server = await startWeb(e2e)
    app = await openApp(server.url)
    for (const kind of fixture.kinds) {
      await openParent()
      await app.page.getByRole('button', { name: '2 subagents', exact: true }).click()
      await app.page.getByRole('tree', { name: 'Subagent sessions', exact: true })
        .getByRole('treeitem', { name: new RegExp('^M55 ' + kind + ' child') }).click()
      const conversation = app.page.locator('[data-conversation-session="' + children.get(kind)! + '"]')
      await conversation.waitFor()
      await chooseBoth('B')
      await reviewScreenshot(app, 'm55-' + kind + '-cold-selected-b')
      const gate = model.blockNextChild()
      const answers = await conversation.getByText(fixture.answer, { exact: true }).count()
      await conversation.getByRole('textbox', { name: inputLabel }).fill('M55_WAIT_WEB_' + kind)
      await conversation.getByRole('button', { name: 'Send message', exact: true }).click()
      try {
        await gate.reached
        const beforeRouting = backendA.requests.length
        await chooseBoth('A')
        expect(backendA.requests).toHaveLength(beforeRouting)
        expect(backendB.requests).toEqual([])
        await reviewScreenshot(app, 'm55-' + kind + '-live-selected-a')
      } finally { gate.release() }
      await expect.poll(() => conversation.getByText(fixture.answer, { exact: true }).count(), { timeout: 30_000 }).toBe(answers + 1)
      await expect.poll(() => backendA.requests.length).toBe((fixture.kinds.indexOf(kind) + 1) * 2)
      expect(backendB.requests).toEqual([])
      await chooseBoth('B')
    }
    const searchSettings = await openSearchSettings(app.page)
    await searchSettings.getByText(searchText['pairings.empty'], { exact: true }).waitFor()
    await reviewScreenshot(app, 'm55-child-search-memory-empty')
    const fetchSettings = await openFetchSettings(app.page, false)
    await fetchSettings.getByText(fetchText['pairings.empty'], { exact: true }).waitFor()
    await reviewScreenshot(app, 'm55-child-fetch-memory-empty')
    expect(app.errors).toEqual([])
    await closeGui()

    const resumed = await bootHost(e2e)
    try {
      const parent = await resolveParent(resumed, parentId)
      for (const kind of fixture.kinds) {
        const sessionId = children.get(kind)!
        expect(resumed.ctx.agents.get(sessionId)).toBeUndefined()
        expect((await resumed.ctx.searchConnections.get({ sessionId })).selection.connectionId).toBe('custom:m55-search-b')
        expect((await resumed.ctx.fetchConnections.get({ sessionId })).selection.connectionId).toBe('custom:m55-fetch-b')
        expect(resumed.ctx.agents.get(sessionId)).toBeUndefined()
        model.next([{ id: 'm55_resume_' + kind, name: 'send_message', input: { agent_id: sessionId, message: 'M55_RUN_WEB_' + kind } }])
        parent.followup(userMessage({ content: [{ type: 'text', text: 'M55 resume ' + kind }], source: { kind: 'user' } }))
        await settle(resumed, parent)
        await expect.poll(() => backendB.requests.length).toBe((fixture.kinds.indexOf(kind) + 1) * 2)
      }
      expect(backendA.requests.map(request => request.path).toSorted()).toEqual(['/v1/messages', '/v1/messages', '/v2/scrape', '/v2/scrape'])
      expect(backendB.requests.map(request => request.path).toSorted()).toEqual(['/v1/messages', '/v1/messages', '/v2/scrape', '/v2/scrape'])
      expect((await resumed.ctx.searchConnections.pairings({})).pairings).toEqual([])
      expect((await resumed.ctx.fetchConnections.pairings({})).pairings).toEqual([])
      const results = model.requests.flatMap(request => toolResults(JSON.parse(request.body) as MessagesRequest))
      for (const result of results.filter(entry => /^(m55_create_|m55_resume_|m55_search|m55_fetch)/.test(entry.id))) expect(result.error, result.text).toBe(false)
    } finally { await resumed.dispose() }
  }, 240_000)

  it('keeps the Web user fork ordinary and writes both model memories from its menu', async () => {
    server = await startWeb(e2e)
    app = await openApp(server.url)
    await openParent()
    const row = app.page.locator('[data-row-key="session:' + parentId + '"]')
    await row.hover()
    await row.getByRole('button', { name: 'Session actions for ' + fixture.title, exact: true }).click()
    await app.page.getByRole('menuitem', { name: 'Fork session', exact: true }).click()
    // Native sidebar fork creates a sibling row; it intentionally does not navigate.
    const forkRow = app.page.locator('[data-row-key^="session:"]:not([data-row-key="session:' + parentId + '"])').filter({ hasText: fixture.title })
    await forkRow.click()
    const conversation = app.page.locator('[data-conversation-session]:visible')
    await expect.poll(() => conversation.getAttribute('data-conversation-session')).not.toBe(parentId)
    userForkId = (await conversation.getAttribute('data-conversation-session'))!
    await chooseBoth('B')
    await reviewScreenshot(app, 'm55-user-fork-selected-b')
    await closeGui()
    const host = await bootHost(e2e)
    try {
      const fork = await host.ctx.sessionPersistence.stat(userForkId as SessionId)
      expect(fork!.header).toMatchObject({ parentSession: parentId, isSeeded: true })
      expect(fork!.header.origin).not.toBe('subagent')
      expect((await host.ctx.searchConnections.pairings({})).pairings).toEqual([expect.objectContaining({ connectionId: 'custom:m55-search-b' })])
      expect((await host.ctx.fetchConnections.pairings({})).pairings).toEqual([expect.objectContaining({ connectionId: 'custom:m55-fetch-b' })])
    } finally { await host.dispose() }
  })
})
