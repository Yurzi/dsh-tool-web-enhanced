import { describe, expect, it } from 'vitest'
import { SEARCH, FETCH } from 'dsh-tool-web-enhanced-core/shared'
import { checkDisabledCapabilities, isCapabilityRowDisabled } from '../src/client/disabled.ts'
import {
  checkUpgradePreflight,
  buildUnsetOps,
  NATIVE_SEARCH_ROW,
} from '../src/client/preflight.ts'

describe('checkDisabledCapabilities', () => {
  it('reports healthy when search plugin is served and configured', () => {
    const res = checkDisabledCapabilities({
      searchServed: true,
      fetchServed: true,
      webConfig: {
        searchProvider: SEARCH.providerId,
        fetchProvider: FETCH.providerId,
      },
    })
    expect(res.searchDisabled).toBe(false)
    expect(res.fetchDisabled).toBe(false)
    expect(res.allDisabled).toBe(false)
  })

  it('detects when search plugin is not served but configured in web row', () => {
    const res = checkDisabledCapabilities({
      searchServed: false,
      fetchServed: true,
      webConfig: {
        searchProvider: SEARCH.providerId,
        fetchProvider: FETCH.providerId,
      },
    })
    expect(res.searchDisabled).toBe(true)
    expect(res.fetchDisabled).toBe(false)
    expect(res.allDisabled).toBe(false)
  })

  it('detects when fetch plugin is not served but configured in web row', () => {
    const res = checkDisabledCapabilities({
      searchServed: true,
      fetchServed: false,
      webConfig: {
        searchProvider: SEARCH.providerId,
        fetchProvider: FETCH.providerId,
      },
    })
    expect(res.searchDisabled).toBe(false)
    expect(res.fetchDisabled).toBe(true)
    expect(res.allDisabled).toBe(false)
  })

  it('does not report disabled if web row points to another provider', () => {
    const res = checkDisabledCapabilities({
      searchServed: false,
      fetchServed: false,
      webConfig: {
        searchProvider: 'deepseek-official',
        fetchProvider: 'http',
      },
    })
    expect(res.searchDisabled).toBe(false)
    expect(res.fetchDisabled).toBe(false)
    expect(res.allDisabled).toBe(false)
  })
})

describe('isCapabilityRowDisabled', () => {
  it('returns false when capability row is enabled in bundle rows even with no settings form', () => {
    const rows = [
      { rowId: FETCH.rowId, moduleName: 'dsh-web-fetch-enhanced', enabled: true },
      { rowId: SEARCH.rowId, moduleName: 'dsh-web-search-enhanced', enabled: true },
    ]
    expect(isCapabilityRowDisabled({ rowId: FETCH.rowId, rows })).toBe(false)
    expect(isCapabilityRowDisabled({ rowId: SEARCH.rowId, rows })).toBe(false)
  })

  it('returns true when capability row is enabled=false in bundle rows', () => {
    const rows = [
      { rowId: FETCH.rowId, moduleName: 'dsh-web-fetch-enhanced', enabled: false },
      { rowId: SEARCH.rowId, moduleName: 'dsh-web-search-enhanced', enabled: true },
    ]
    expect(isCapabilityRowDisabled({ rowId: FETCH.rowId, rows })).toBe(true)
    expect(isCapabilityRowDisabled({ rowId: SEARCH.rowId, rows })).toBe(false)
  })

  it('returns false when capability row is not in bundle rows', () => {
    expect(isCapabilityRowDisabled({ rowId: FETCH.rowId, rows: [] })).toBe(false)
  })
})

describe('checkUpgradePreflight', () => {
  it('reports healthy when there are no user overrides and native search is off', () => {
    const res = checkUpgradePreflight({
      user: undefined,
      nativeSearchServed: false,
    })
    expect(res.issues).toHaveLength(0)
    expect(res.fieldsToUnset).toHaveLength(0)
  })

  it('detects (a) user-tier override pointing to native search provider', () => {
    const res = checkUpgradePreflight({
      user: { searchProvider: 'deepseek-official' },
      nativeSearchServed: false,
    })
    expect(res.fieldsToUnset).toEqual(['searchProvider'])
    expect(res.issues).toEqual([
      {
        kind: 'user-override',
        field: 'searchProvider',
        value: 'deepseek-official',
      },
    ])
    const ops = buildUnsetOps(res.fieldsToUnset)
    expect(ops).toEqual([{ op: 'unset', path: ['searchProvider'] }])
  })

  it('detects (a) user-tier override pointing to native fetch provider', () => {
    const res = checkUpgradePreflight({
      user: { fetchProvider: 'http' },
      nativeSearchServed: false,
    })
    expect(res.fieldsToUnset).toEqual(['fetchProvider'])
    expect(res.issues).toEqual([
      {
        kind: 'user-override',
        field: 'fetchProvider',
        value: 'http',
      },
    ])
  })

  it('detects (b) legacy coexistence mode remnant (custom provider id)', () => {
    const res = checkUpgradePreflight({
      user: { searchProvider: 'custom-search-backend', fetchProvider: 'custom-fetch' },
      nativeSearchServed: false,
    })
    expect(res.fieldsToUnset).toEqual(['searchProvider', 'fetchProvider'])
    expect(res.issues).toEqual([
      {
        kind: 'legacy-remnant',
        field: 'searchProvider',
        value: 'custom-search-backend',
      },
      {
        kind: 'legacy-remnant',
        field: 'fetchProvider',
        value: 'custom-fetch',
      },
    ])
  })

  it('detects (c) re-enabled native search row web-search-deepseek', () => {
    const res = checkUpgradePreflight({
      user: undefined,
      nativeSearchServed: true,
    })
    expect(res.fieldsToUnset).toHaveLength(0)
    expect(res.issues).toEqual([
      {
        kind: 'native-search-conflict',
        rowId: NATIVE_SEARCH_ROW,
      },
    ])
  })

  it('handles combined (a) user override and (c) native search conflict', () => {
    const res = checkUpgradePreflight({
      user: { searchProvider: 'deepseek-search-api' },
      nativeSearchServed: true,
    })
    expect(res.fieldsToUnset).toEqual(['searchProvider'])
    expect(res.issues).toHaveLength(2)
  })
})
