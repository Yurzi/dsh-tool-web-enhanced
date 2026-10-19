/**
 * The profile bundle over the shipped base profile: the real include patch
 * algorithm applied to the base web rows, then both capabilities resolved
 * through the real WebRuntime. Every row registers stub providers that answer
 * with the row id, and every provider reports available() — as
 * dsh-web-deepseek-api does without a key — so an unpinned selection would be
 * ambiguous and fail loudly.
 */
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { applyEntryPatches, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FETCH, SEARCH, UI } from 'dsh-tool-web-enhanced-core/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface Row { id: string; name?: string; disabled?: boolean | null; config?: Record<string, unknown> }
interface Manifest { name: string; dsh: { bundle: { patch: string } }; dependencies: Record<string, string> }

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest
const PROFILE = parse(readFileSync(new URL(`../${manifest.dsh.bundle.patch}`, import.meta.url), 'utf8')) as PatchOptions[]

/** Web rows of @deepseek-ai/dsh-base 0.2.1-rc.2 (packages/bundle/base/cordis.patch.yml); e2e composes the real one. */
const BASE: Row[] = [
  { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'deepseek-official', fetchProvider: 'http' } },
  { id: 'web-search-deepseek', name: '@deepseek-ai/dsh-web-search-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-deepseek-api', name: '@deepseek-ai/dsh-web-deepseek-api', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
  { id: 'web-fetch-http', name: '@deepseek-ai/dsh-web-fetch-http' },
]
/** Provider ids each row registers. */
const PROVIDERS: Record<string, { search?: string[]; fetch?: string[] }> = {
  'web-search-deepseek': { search: ['deepseek-official'] },
  'web-deepseek-api': { search: ['deepseek-search-api'], fetch: ['deepseek-fetch-api'] },
  'web-fetch-http': { fetch: ['http'] },
  [SEARCH.rowId]: { search: [SEARCH.providerId] },
  [FETCH.rowId]: { fetch: [FETCH.providerId] },
}

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function compose(...layers: PatchOptions[][]) {
  const warnings: string[] = []
  // The patch algorithm adopts inserted row objects, so every composition gets its own copies.
  const rows = applyEntryPatches(structuredClone(BASE) as never, structuredClone(layers.flat()), (message: string) => { warnings.push(message) }) as Row[]
  const row = (id: string) => rows.find(entry => entry.id === id)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(WebRuntime, row('web')?.config ?? {})
  for (const entry of rows) {
    if (entry.disabled) continue
    for (const id of PROVIDERS[entry.id]?.search ?? []) {
      ctx.web.registerSearchProvider({ id, available: () => true, search: async () => ({ sources: [{ url: 'https://example.invalid/', title: entry.id }], truncated: false }) })
    }
    for (const id of PROVIDERS[entry.id]?.fetch ?? []) {
      ctx.web.registerFetchProvider({ id, available: () => true, fetch: async request => ({ url: request.url, statusCode: 200, body: { kind: 'text', content: entry.id }, truncated: false }) })
    }
  }
  return {
    rows,
    row,
    warnings,
    search: async () => (await ctx.web.search({ query: 'q' })).sources[0]?.title,
    fetch: async () => {
      const result = await ctx.web.fetch({ url: 'https://example.invalid/' })
      return result.body.content
    },
  }
}

describe('profile bundle', () => {
  it('depends on exactly the packages it mounts', () => {
    expect(Object.keys(manifest.dependencies).toSorted()).toEqual([FETCH.packageName, SEARCH.packageName, UI.packageName].toSorted())
  })

  it('names every row it inserts after its package, as DSH does', async () => {
    const { rows } = await compose(PROFILE)
    const inserted = rows.filter(entry => !BASE.some(base => base.id === entry.id))
    expect(inserted.map(entry => entry.id)).toEqual([SEARCH, FETCH, UI].map(row => row.rowId))
    for (const entry of inserted) expect(entry.id).toBe(entry.name?.replace(/^dsh-/, ''))
  })

  it('selects both plugins in the web row and mounts them with the menu row', async () => {
    const { row, warnings } = await compose(PROFILE)
    expect(warnings).toEqual([])
    expect(row('web')).toEqual({ id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: SEARCH.providerId, fetchProvider: FETCH.providerId } })
    expect(row(SEARCH.rowId)).toEqual({ id: SEARCH.rowId, name: SEARCH.packageName })
    expect(row(FETCH.rowId)).toEqual({ id: FETCH.rowId, name: FETCH.packageName })
    expect(row(UI.rowId)).toEqual({ id: UI.rowId, name: UI.packageName })
    expect(row('web-search-deepseek')?.disabled).toBe(true)
    expect(row('web-deepseek-api')?.disabled).toBeFalsy()
    expect(row('web-fetch-http')?.disabled).toBeFalsy()
  })

  it('routes web_search and web_fetch to the two plugins', async () => {
    const { search, fetch } = await compose(PROFILE)
    await expect(search()).resolves.toBe(SEARCH.rowId)
    await expect(fetch()).resolves.toBe(FETCH.rowId)
  })

  it.each([
    ['search', [SEARCH]],
    ['fetch', [FETCH]],
    ['both', [SEARCH, FETCH]],
  ] as const)('keeps the menu row and the other capability with the %s plugin row disabled', async (_name, off) => {
    const user: PatchOptions[] = off.map(plugin => ({ id: plugin.rowId, disabled: true }))
    const { row, search, fetch } = await compose(PROFILE, user)
    expect(row(UI.rowId)?.disabled).toBeFalsy()
    // The web row still names the disabled plugin's seat, so that capability fails loudly instead of falling back.
    const outcome = (plugin: typeof SEARCH, call: () => Promise<unknown>) => off.includes(plugin)
      ? expect(call()).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
      : expect(call()).resolves.toBe(plugin.rowId)
    await outcome(SEARCH, search)
    await outcome(FETCH, fetch)
  })

  it('yields to a selection written in a later layer', async () => {
    // What the built-in Web search page stored while its Search API switch was on.
    const user: PatchOptions[] = [{ id: 'web', config: { searchProvider: 'deepseek-search-api', fetchProvider: 'deepseek-fetch-api' } }]
    const { search, fetch } = await compose(PROFILE, user)
    await expect(search()).resolves.toBe('web-deepseek-api')
    await expect(fetch()).resolves.toBe('web-deepseek-api')
  })
})
