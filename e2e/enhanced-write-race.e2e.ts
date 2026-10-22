import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FETCH, PROFILE_PACKAGE } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, inject, it } from 'vitest'
import { en as text } from '../packages/fetch-enhanced/src/client/locales.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { isolatedContext, addPlugins, artifacts, composedRows } from './harness/environment.ts'
import { openFetchSettings } from './harness/navigation.ts'
import { reviewDirectory, reviewScreenshot } from './harness/review.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const cases = [
  { name: 'enhanced-and-service', first: text['services.enable'].replace('{name}', 'Firecrawl'), second: text['enhanced.title'] },
  { name: 'defaults-and-service', first: text['defaults.showSelector'], second: text['services.enable'].replace('{name}', 'Firecrawl') },
]

describe.skipIf(chromiumPath === undefined && !browserRequired)('Cross-section settings write diagnostics', () => {
  let app: App | undefined
  let server: WebServer | undefined
  let external: App | undefined
  afterEach(async ({ task }) => {
    try {
      if (task.result?.state === 'fail' && app !== undefined) await recordBrowserFailure(app, 'enhanced-write-race-failure')
    } finally {
      if (external !== undefined) { await external.close(); external = undefined }
      if (app !== undefined) { await app.close(); app = undefined }
      if (server !== undefined) { await server.stop(); server = undefined }
    }
  })

  it.each(cases)('persists both same-turn cross-section writes for $name without an alert', async ({ name, first, second }) => {
    const e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const frames: string[] = []
    const responses: { url: string; status: number; body: string }[] = []
    const bodies: Promise<void>[] = []
    app.page.on('response', response => {
      if (response.request().resourceType() !== 'fetch' || !response.headers()['content-type']?.includes('application/json')) return
      bodies.push(response.text().then(body => { responses.push({ url: response.url(), status: response.status(), body }) }))
    })
    app.page.on('websocket', socket => socket.on('framereceived', frame => { frames.push(String(frame.payload)) }))
    // Capture the public transport from connection establishment, not a private client service.
    await app.page.reload()
    const settings = await openFetchSettings(app.page, false)
    const switches = settings.getByRole('switch', { name: first, exact: true })
      .or(settings.getByRole('switch', { name: second, exact: true }))
    const clicks = await switches.evaluateAll((elements, labels) => {
      const records: { label: string; time: number }[] = []
      for (const label of labels) {
        const element = elements.find(candidate => candidate.getAttribute('aria-label') === label)
        if (!(element instanceof HTMLElement)) throw new Error('No switch with accessible label ' + label)
        records.push({ label, time: performance.now() })
        element.click()
      }
      return records
    }, [first, second])
    const expected = name === 'enhanced-and-service'
      ? { enhancedTools: true, connections: { 'builtin:firecrawl': { disabled: false } } }
      : { showSelector: false, connections: { 'builtin:firecrawl': { disabled: false } } }
    await expect.poll(() => composedRows(e2e).find(row => row.id === FETCH.rowId)!.config).toMatchObject(expected)
    const state = composedRows(e2e).find(row => row.id === FETCH.rowId)!.config
    const alerts = await settings.getByRole('alert').allTextContents()
    await Promise.all(bodies)
    const evidence = { clicks, alerts, state, responses, frames: frames.filter(frame => /settings|conflict|revision/i.test(frame)) }
    const file = 'm5-write-race-fixed-' + name
    await reviewScreenshot(app, file)
    writeFileSync(join(artifacts, file + '.json'), JSON.stringify(evidence, null, 2))
    writeFileSync(join(reviewDirectory, file + '.json'), JSON.stringify(evidence, null, 2))
    expect(alerts).toEqual([])
    expect(app.errors).toEqual([])
  })

  it('still refuses a truly external edit made after this page read its revision', async () => {
    const e2e = isolatedContext(base)
    const { [PROFILE_PACKAGE]: profile, ...plugins } = e2e.tarballs
    if (profile === undefined) throw new Error('the global setup did not pack the profile bundle')
    addPlugins(e2e, [profile], plugins)
    server = await startWeb(e2e)
    app = await openApp(server.url)
    const held: (() => void)[] = []
    const targetFrames: string[] = []
    const externalFrames: string[] = []
    const targetRequests: string[] = []
    const externalRequests: string[] = []
    const observeMutations = (page: App['page'], requests: string[]) => {
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/settings/mutate') requests.push(request.postData()!)
      })
    }
    observeMutations(app.page, targetRequests)
    type Description = { result: { ok: true; value: { namespaces: { ns: string; revision: number }[] } } | { ok: false } }
    const observeDescriptions = async (page: App['page'], frames: string[]) => {
      await page.route('**/api/settings/describe', async route => {
        const response = await route.fetch()
        const reply = await response.json() as Description
        if (!reply.result.ok) throw new Error('Public Settings.describe failed')
        const row = reply.result.value.namespaces.find(namespace => namespace.ns === FETCH.rowId)
        if (row === undefined) throw new Error('Public Settings.describe omitted the fetch row')
        frames.push(JSON.stringify({ ns: row.ns, revision: row.revision }))
        await route.fulfill({ response })
      })
    }
    await observeDescriptions(app.page, targetFrames)
    let holdUpdates = false
    const revisions = (frames: readonly string[]) => frames.flatMap(frame =>
      [...frame.matchAll(/"revision":([0-9]+)/g)].map(match => Number(match[1])))
    // Observe only the public Settings transport; delay invalidations, not writes or replies.
    await app.page.routeWebSocket('**', socket => {
      const upstream = socket.connectToServer()
      socket.onMessage(message => { targetRequests.push(String(message)); upstream.send(message) })
      upstream.onMessage(message => {
        const frame = String(message)
        targetFrames.push(frame)
        if (holdUpdates && frame.includes('settings/document-updated')) held.push(() => { socket.send(message) })
        else socket.send(message)
      })
    })
    await app.page.reload()
    const settings = await openFetchSettings(app.page, false)
    const selector = settings.getByRole('switch', { name: text['defaults.showSelector'], exact: true })
    await selector.waitFor()
    expect(await selector.isChecked()).toBe(true)
    await expect.poll(() => revisions(targetFrames).length).toBeGreaterThan(0)
    const targetRead = revisions(targetFrames)
    holdUpdates = true
    external = await openApp(server.url)
    await observeDescriptions(external.page, externalFrames)
    observeMutations(external.page, externalRequests)
    external.page.on('websocket', socket => socket.on('framereceived', frame => { externalFrames.push(String(frame.payload)) }))
    await external.page.reload()
    const elsewhere = await openFetchSettings(external.page, false)
    await expect.poll(() => revisions(externalFrames).length).toBeGreaterThan(0)
    const externalRead = revisions(externalFrames)
    const firecrawlName = text['services.enable'].replace('{name}', 'Firecrawl')
    await elsewhere.getByRole('switch', { name: firecrawlName, exact: true }).click()
    await expect.poll(() => composedRows(e2e).find(row => row.id === FETCH.rowId)!.config).toMatchObject({
      connections: { 'builtin:firecrawl': { disabled: false } },
    })
    await expect.poll(() => Math.max(...revisions(externalFrames))).toBeGreaterThan(Math.max(...externalRead))
    await elsewhere.getByRole('switch', { name: firecrawlName, exact: true }).evaluate(element => { element.scrollIntoView({ block: 'center' }) })
    await reviewScreenshot(external, 'm5-write-external-source-saved')
    await selector.click()
    const alert = settings.getByRole('alert')
    await alert.waitFor()
    expect(await alert.innerText()).toBe(text['settings.refused'])
    expect(await selector.isChecked()).toBe(true)
    const persisted = composedRows(e2e).find(row => row.id === FETCH.rowId)!.config
    expect(persisted).toMatchObject({ connections: { 'builtin:firecrawl': { disabled: false } } })
    expect(persisted).not.toHaveProperty('showSelector')
    await alert.evaluate(element => { element.scrollIntoView({ block: 'center' }) })
    await reviewScreenshot(app, 'm5-write-external-conflict')
    const evidence = {
      sameRow: FETCH.rowId, externalField: 'connections.builtin:firecrawl.disabled', refusedField: 'showSelector',
      targetReadRevision: Math.max(...targetRead), externalReadRevision: Math.max(...externalRead),
      externalSavedRevision: Math.max(...revisions(externalFrames)), targetAfterRefusalRevisions: revisions(targetFrames),
      heldInvalidationCount: held.length, alert: await alert.innerText(), persisted,
      targetMutationFrames: targetRequests.filter(frame => frame.includes('showSelector')),
      externalMutationFrames: externalRequests,
      externalSettingsFrames: externalFrames.filter(frame => frame.includes('"revision"') || frame.includes('settings/document-updated')),
    }
    expect(held.length).toBeGreaterThan(0)
    for (const directory of [artifacts, reviewDirectory]) {
      writeFileSync(join(directory, 'm5-write-external-conflict.json'), JSON.stringify(evidence, null, 2))
    }
    holdUpdates = false
    for (const deliver of held) deliver()
    await expect.poll(() => settings.getByRole('switch', { name: firecrawlName, exact: true }).isChecked()).toBe(true)
    await reviewScreenshot(app, 'm5-write-external-current-preserved')
    await app.page.unrouteAll({ behavior: 'wait' })
    await external.page.unrouteAll({ behavior: 'wait' })
    expect(app.errors).toEqual([])
    expect(external.errors).toEqual([])
  })

})
