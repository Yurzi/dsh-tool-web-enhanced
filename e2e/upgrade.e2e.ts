/** Real 0.1.x bundle removal → profile installation; old config is rejected, session data survives. */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {} from '@deepseek-ai/dsh-settings'
import { FETCH, SEARCH } from 'dsh-tool-web-enhanced-core/shared'
import { describe, expect, inject, it } from 'vitest'
import type {} from '../packages/search-enhanced/src/host/remote.ts'
import type {} from '../packages/fetch-enhanced/src/host/remote.ts'
import { en as uiText } from '../packages/ui/src/client/locales.ts'
import { en as searchText } from '../packages/search-enhanced/src/client/locales.ts'
import { en as fetchText } from '../packages/fetch-enhanced/src/client/locales.ts'
import { type App, browserRequired, chromiumPath, openApp, recordBrowserFailure } from './harness/browser.ts'
import { artifacts, composedRows, enterIsolatedEnvironment } from './harness/environment.ts'
import { bootHost } from './harness/host.ts'
import { openConnectionTab, newSession, openBundle, openConnections, openFetchSettings, openSearchSettings } from './harness/navigation.ts'
import { createLegacyOffSession, installCoexistencePatch, installPredecessors, installUpgradeProfile, upgradeEnvironment } from './harness/upgrade.ts'
import { type WebServer, startWeb } from './harness/web.ts'

const base = inject('e2e')
const legacyRoute = { searchProvider: 'enhanced-search', fetchProvider: 'http' }
const enhancedRoute = { searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId }

describe.skipIf(chromiumPath === undefined && !browserRequired)('search and fetch upgrade from the 0.1.x bundles', () => {
  it('rejects old settings until explicit reset, preserves session Off, and repairs routing only after confirmation', async () => {
    const e2e = upgradeEnvironment(base)
    const originalEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined))
    enterIsolatedEnvironment(e2e.env)
    try {
      installPredecessors(e2e)
      const patchPath = installCoexistencePatch(e2e)
      const originalPatch = readFileSync(patchPath, 'utf8')
      const oldRows = composedRows(e2e)
      expect(oldRows.find(row => row.id === 'web')?.config).toEqual(legacyRoute)
      expect(oldRows.find(row => row.id === 'web-search-deepseek')?.disabled).toBe(false)
      const oldSearch = oldRows.find(row => row.id === SEARCH.rowId)!
      expect(oldSearch).toMatchObject({ name: SEARCH.packageName, config: { providerId: 'enhanced-search', version: 2, defaultConnection: 'builtin:exa' } })
      expect(oldSearch.disabled).not.toBe(true)
      const originalSearchConfig = oldSearch.config!
      const originalFetchConfig = oldRows.find(row => row.id === FETCH.rowId)!.config!
      expect(originalFetchConfig).toEqual({ schemaVersion: 1, providerId: 'enhanced-fetch', allowCidrs: ['127.0.0.1/32'], userAgent: 'wfe-e2e/1.0' })
      const sessionId = await createLegacyOffSession(e2e)

      installUpgradeProfile(e2e)
      const upgradedRows = composedRows(e2e)
      expect(upgradedRows.find(row => row.id === 'web')?.config).toEqual(legacyRoute)
      expect(upgradedRows.find(row => row.id === SEARCH.rowId)?.config).toEqual(originalSearchConfig)
      expect(upgradedRows.find(row => row.id === FETCH.rowId)?.config).toEqual(originalFetchConfig)
      expect(readFileSync(patchPath, 'utf8')).toBe(originalPatch)

      // Only the temporary runtime route changes: persisted leftovers still need explicit repair.
      const diagnostics: string[] = []
      const upgraded = await bootHost(e2e, [join(import.meta.dirname, 'fixtures/upgrade-fetch-route.yml')], root => {
        // Invalid row diagnostics are emitted during installation, before any provider call.
        root.logger.exporter({ levels: { default: 3 }, export: message => { diagnostics.push(message.args.map(String).join(' ')) } })
      })
      try {
        await expect(upgraded.web.search({ query: 'old settings probe' }, AbortSignal.timeout(15_000)))
          .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: SEARCH.packageName + ': search settings are invalid; ask the user to fix them on the settings page' })
        await expect(upgraded.web.fetch({ url: 'http://127.0.0.1:9/' }, AbortSignal.timeout(15_000)))
          .rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', message: FETCH.packageName + ': fetch settings are invalid; ask the user to fix them on the settings page' })
        const logs = diagnostics.join('\n')
        writeFileSync(join(artifacts, 'upgrade-invalid-host.log'), logs)
        expect(logs).toContain('providerId')
        expect(logs).toContain('allowCidrs')
        await expect(upgraded.ctx.searchConnections.get({ sessionId })).rejects.toMatchObject({ code: 'searchConnections/invalid-settings' })
        await expect(upgraded.ctx.fetchConnections.get({ sessionId })).rejects.toMatchObject({ code: 'fetchConnections/invalid-settings' })
        expect(composedRows(e2e).find(row => row.id === FETCH.rowId)?.config).toEqual(originalFetchConfig)
      } finally {
        await upgraded.dispose()
      }

      let server: WebServer | undefined
      let app: App | undefined
      try {
        server = await startWeb(e2e)
        app = await openApp(server.url)
        const { page } = app
        const detail = await openBundle(page)
        const overview = detail.getByRole('region', { name: uiText['overview.title'], exact: true })
        const legacyWarning = overview.getByText(uiText['preflight.legacyRemnant'].replace('{tool}', uiText['overview.search.title']).replace('{action}', uiText['preflight.action.searchAction']), { exact: true })
        const overrideWarning = overview.getByText(uiText['preflight.userOverride'].replace('{tool}', uiText['overview.fetch.title']).replace('{value}', 'http'), { exact: true })
        const nativeWarning = overview.getByText(uiText['preflight.nativeSearchConflict'], { exact: true })
        await legacyWarning.waitFor()
        await overrideWarning.waitFor()
        await nativeWarning.waitFor()
        await overview.getByText(uiText['overview.status.user'].replace('{provider}', 'enhanced-search'), { exact: true }).waitFor()
        await overview.getByText(uiText['overview.status.user'].replace('{provider}', 'http'), { exact: true }).waitFor()
        await overview.scrollIntoViewIfNeeded()
        await app.screenshot('upgrade-preflight')
        // Onboarding can acknowledge its notice in the same patch. Freeze after it settles.
        const beforeCancel = readFileSync(patchPath, 'utf8')
        const repair = overview.getByRole('button', { name: uiText['preflight.action.fix'], exact: true })
        const confirmation = page.getByRole('dialog', { name: uiText['preflight.confirm.title'], exact: true })
        await repair.click()
        await confirmation.getByRole('button', { name: uiText['preflight.confirm.cancel'], exact: true }).click()
        await confirmation.waitFor({ state: 'hidden' })
        expect(readFileSync(patchPath, 'utf8')).toBe(beforeCancel)
        expect(composedRows(e2e).find(row => row.id === 'web')?.config).toEqual(legacyRoute)
        await repair.click()
        await confirmation.getByRole('button', { name: uiText['preflight.confirm.confirm'], exact: true }).click()
        await confirmation.waitFor({ state: 'hidden' })
        await overview.getByText(uiText['overview.status.routed'], { exact: true }).waitFor()
        await overview.getByText(uiText['overview.status.routedFetch'], { exact: true }).waitFor()
        await legacyWarning.waitFor({ state: 'hidden' })
        await overrideWarning.waitFor({ state: 'hidden' })
        // Route repair does not toggle another plugin or implicitly clear either config.
        await nativeWarning.waitFor()
        await repair.waitFor({ state: 'hidden' })
        const repaired = composedRows(e2e)
        expect(repaired.find(row => row.id === 'web')?.config).toEqual(enhancedRoute)
        expect(repaired.find(row => row.id === SEARCH.rowId)?.config).toEqual(originalSearchConfig)
        expect(repaired.find(row => row.id === FETCH.rowId)?.config).toEqual(originalFetchConfig)
        expect(repaired.find(row => row.id === 'web-search-deepseek')?.disabled).toBe(false)
        await overview.scrollIntoViewIfNeeded()
        await app.screenshot('upgrade-repaired')

        await newSession(page)
        const invalidMenu = await openConnections(page)
        for (const capability of [searchText['section.title'], fetchText['section.title']]) {
          const section = await openConnectionTab(invalidMenu, capability)
          await section.getByRole('alert').getByText(uiText['menu.invalidSettings'].replace('{capability}', capability), { exact: true }).waitFor()
          await section.getByRole('button', { name: uiText['menu.settings'], exact: true }).waitFor()
          expect(await section.getByRole('button', { name: uiText['button.readFailed'], exact: true }).count()).toBe(0)
          await app.screenshot('upgrade-menu-' + (capability === searchText['section.title'] ? 'search' : 'fetch') + '-invalid')
        }
        await page.keyboard.press('Escape')
        const searchSettings = await openSearchSettings(page)
        const searchInvalid = searchSettings.getByRole('alert')
        await searchInvalid.waitFor()
        const searchDiagnostic = await searchInvalid.getAttribute('title')
        expect(searchDiagnostic).toContain('providerId')
        expect(searchDiagnostic).toContain('freshness')
        await app.screenshot('upgrade-search-invalid')
        await searchSettings.getByRole('button', { name: searchText['reset.button'], exact: true }).click()
        await page.getByText(searchText['reset.confirm'], { exact: true }).waitFor()
        await page.getByRole('button', { name: searchText['reset.confirmButton'], exact: true }).click()
        await searchSettings.getByRole('heading', { name: searchText['defaults.title'], exact: true }).waitFor()
        await expect.poll(() => composedRows(e2e).find(row => row.id === SEARCH.rowId)?.config ?? {}, { timeout: 15_000 }).toEqual({})

        const fetchSettings = await openFetchSettings(page, false)
        const fetchInvalid = fetchSettings.getByRole('alert')
        await fetchInvalid.waitFor()
        const diagnostic = await fetchInvalid.getAttribute('title')
        expect(diagnostic).toContain('schemaVersion')
        expect(diagnostic).toContain('allowCidrs')
        await app.screenshot('upgrade-fetch-invalid')
        await fetchSettings.getByRole('button', { name: fetchText['reset.button'], exact: true }).click()
        await page.getByText(fetchText['reset.confirm'], { exact: true }).waitFor()
        await page.getByRole('button', { name: fetchText['reset.confirmButton'], exact: true }).click()
        await fetchSettings.getByRole('heading', { name: fetchText['defaults.title'], exact: true }).waitFor()
        await expect.poll(() => composedRows(e2e).find(row => row.id === FETCH.rowId)?.config ?? {}, { timeout: 15_000 }).toEqual({})
        await app.screenshot('upgrade-fetch-reset')
        expect(app.errors).toEqual([])
      } catch (error) {
        if (app !== undefined) await recordBrowserFailure(app, 'upgrade-failure')
        throw error
      } finally {
        try {
          if (app !== undefined) {
            writeFileSync(join(artifacts, 'upgrade-console-errors.json'), JSON.stringify(app.errors, null, 2))
            await app.close()
          }
        } finally {
          await server?.stop()
        }
      }

      // Cold boot: settings were reset, but the old Session's deliberate Off survived.
      const restarted = await bootHost(e2e)
      try {
        const old = await restarted.ctx.searchConnections.get({ sessionId })
        expect(old).toMatchObject({ selection: { connectionId: null, revision: 1 }, source: 'session' })
        const fresh = await restarted.ctx.sessionController.create({ cwd: dirname(e2e.env.DSH_HOME!) })
        expect(await restarted.ctx.searchConnections.get({ sessionId: fresh.sessionId }))
          .toMatchObject({ selection: { connectionId: 'builtin:deepseek-messages' }, source: 'default' })
        expect(await restarted.ctx.fetchConnections.get({ sessionId: fresh.sessionId }))
          .toMatchObject({ selection: { connectionId: 'builtin:local' }, source: 'default' })
        await expect(restarted.web.search({ query: 'restored defaults' }, AbortSignal.timeout(15_000)))
          .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
        await expect(restarted.web.fetch({ url: 'http://127.0.0.1:9/' }, AbortSignal.timeout(15_000)))
          .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
      } finally {
        await restarted.dispose()
      }
    } finally {
      enterIsolatedEnvironment(originalEnv)
    }
  }, 600_000)
})
