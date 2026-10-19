/**
 * The profile bundle inside a real DSH composition: installed by the plugin
 * manager into a fresh `web` profile, composed over the shipped base bundle,
 * and booted through the CLI's own steps. Unit tests cover the parts; these
 * tests cover what only the real composition can show — the bundle layer is
 * selected, its patch lands where it should, its plugin dependencies resolve
 * from the installed tarballs, and `ctx.web` routes both capabilities to them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FETCH, PROFILE_PACKAGE, SEARCH, UI, type PluginIdentity } from 'dsh-tool-web-enhanced-core/shared'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { composedRows, enterIsolatedEnvironment, profileDir } from './harness/environment.ts'
import { type Host, bootHost } from './harness/host.ts'

const e2e = inject('e2e')
const fixture = (name: string) => join(import.meta.dirname, 'fixtures', name)

describe('installation', () => {
  it('selects the bundle layer and installs its plugins beneath it', () => {
    const profile = JSON.parse(readFileSync(join(profileDir(e2e), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
    }
    expect(profile.dsh.profile.bundles).toContain(PROFILE_PACKAGE)
    // Only the bundle is a direct dependency; the plugins arrive as its dependencies.
    expect(Object.keys(profile.dependencies)).toEqual([PROFILE_PACKAGE])
  })
})

describe('composition', () => {
  it('owns the web selection, retires native DeepSeek search, and mounts both plugins and the menu row', () => {
    const rows = composedRows(e2e)
    const row = (id: string) => rows.find(entry => entry.id === id)
    expect(row('web')?.config).toEqual({ searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId })
    expect(row('web-search-deepseek')).toMatchObject({ disabled: true })
    expect(row(SEARCH.rowId)).toMatchObject({ name: SEARCH.packageName })
    expect(row(SEARCH.rowId)?.disabled).toBeFalsy()
    expect(row(FETCH.rowId)).toMatchObject({ name: FETCH.packageName })
    expect(row(FETCH.rowId)?.disabled).toBeFalsy()
    expect(row(UI.rowId)).toMatchObject({ name: UI.packageName })
    expect(row(UI.rowId)?.disabled).toBeFalsy()
    // Unselected natives stay mounted.
    expect(row('web-deepseek-api')?.disabled).toBeFalsy()
    expect(row('web-fetch-http')?.disabled).toBeFalsy()
  })
})

describe('runtime', () => {
  let host: Host

  beforeAll(async () => {
    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e)
  })

  afterAll(async () => {
    await host?.dispose()
  })

  it('routes web_search to the search plugin', async () => {
    // The selected seat is ours, so anything but WEB_PROVIDER_CONFIGURED_* proves it
    // registered. Without a key the parity backend answers as native search does.
    await expect(host.web.search({ query: 'deepseek harness' }, AbortSignal.timeout(15_000)))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('routes web_fetch to the fetch plugin with the native public-only policy', async () => {
    await expect(host.web.fetch({ url: 'http://127.0.0.1:9/' }, AbortSignal.timeout(15_000)))
      .rejects.toMatchObject({ code: 'WEB_BLOCKED_URL' })
  })
})

describe('plugin rows switched off', () => {
  let host: Host | undefined
  afterEach(async () => {
    await host?.dispose()
    host = undefined
  })

  const overlays: Record<string, string> = { [SEARCH.rowId]: fixture('disable-search.yml'), [FETCH.rowId]: fixture('disable-fetch.yml') }
  const cases: [string, PluginIdentity[]][] = [['search', [SEARCH]], ['fetch', [FETCH]], ['both', [SEARCH, FETCH]]]

  it.each(cases)('keeps the menu row and the other capability with the %s row off', async (_name, off) => {
    const files = off.map(plugin => overlays[plugin.rowId]!)
    const rows = composedRows(e2e, files)
    expect(rows.find(entry => entry.id === UI.rowId)?.disabled).toBeFalsy()

    enterIsolatedEnvironment(e2e.env)
    host = await bootHost(e2e, files)
    const { web } = host
    const search = web.search({ query: 'deepseek harness' }, AbortSignal.timeout(15_000))
    const fetch = web.fetch({ url: 'http://127.0.0.1:9/' }, AbortSignal.timeout(15_000))
    // The web row still names a switched-off seat, so that capability fails loudly rather than falling back.
    await expect(search).rejects.toMatchObject({ code: off.includes(SEARCH) ? 'WEB_PROVIDER_CONFIGURED_MISSING' : 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    await expect(fetch).rejects.toMatchObject({ code: off.includes(FETCH) ? 'WEB_PROVIDER_CONFIGURED_MISSING' : 'WEB_BLOCKED_URL' })
  })
})
